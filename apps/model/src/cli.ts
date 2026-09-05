import { getPool, loadConfig, type Position } from "@da/core";
import { loadStatsSource } from "./dbSource.ts";
import { DEFAULT_PARAMS, indifferenceClasses, scoreDraft, type Slot } from "./score.ts";
import { gridSearch, persistEval, runEval } from "./eval.ts";
import { runReplay } from "./replay.ts";

const USAGE = `usage: model/cli.ts <command>
  refresh                          recompute materialised aggregates (refresh_aggregates())
  eval [--patch P] [--band B] [--cutoff-days N|--cutoff ISO] [--grid] [--persist]   holdout evaluation
  replay [--patch P] [--band B] [--cutoff-days N] [--games N] [--priors S,M,Y,H] [--rank lower|mean] [--eb] [--pilot N] [--persist]   retrospective draft replay (reality check)
  score --pos BOTTOM [--patch 16.16] [--band low|mid|high] [--allies id:POS,...] [--enemies id[:POS],...] [--bans id,...] [--puuid X] [--top 10]`;

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
function slots(s: string | undefined): Slot[] {
  if (!s) return [];
  return s.split(",").filter(Boolean).map((t) => {
    const [c, p] = t.split(":");
    return p ? { champ: Number(c), pos: p as Position } : { champ: Number(c) };
  });
}

async function main(argv: string[]) {
  const cmd = argv[0];
  const cfg = loadConfig();
  if (!cmd || cmd === "-h") { console.log(USAGE); return; }
  if (!cfg.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pool = getPool(cfg.DATABASE_URL);
  try {
    if (cmd === "refresh") {
      const t0 = Date.now();
      await pool.query("select refresh_aggregates()");
      const r = await pool.query(`select name, rows from mat_refresh order by 1`);
      console.table(r.rows);
      console.log(`refreshed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      return;
    }
    if (cmd === "replay") {
      const patch = arg(argv, "--patch") ?? (await pool.query<{ patch: string }>(`select patch from match group by 1 order by count(*) desc limit 1`)).rows[0]?.patch;
      if (!patch) throw new Error("no data");
      const band = (arg(argv, "--band") ?? null) as "low" | "mid" | "high" | null;
      const days = Number(arg(argv, "--cutoff-days") ?? 3);
      const mx = (await pool.query<{ mx: Date }>(`select max(game_start) mx from match where patch = $1`, [patch])).rows[0]!.mx;
      const cutoff = new Date(mx.getTime() - days * 86400_000);
      const scope = { patch, platforms: cfg.platforms, tierBand: band, cutoff };
      let params = DEFAULT_PARAMS;
      const pr = arg(argv, "--priors");
      if (pr) {
        const ns = pr.split(",").map(Number);
        if (ns.length !== 4 || ns.some((x) => !Number.isFinite(x) || x <= 0)) throw new Error("--priors očekává S,M,Y,H (čtyři kladná čísla, např. 1000,1000,500,100)");
        params = { ...DEFAULT_PARAMS, priorNStrength: ns[0]!, priorNMatchup: ns[1]!, priorNSynergy: ns[2]!, priorNPlayer: ns[3]! };
      }
      // SPEC-07 switches, so the replay can compare decision rules and the pilot stratification.
      const rank = arg(argv, "--rank");
      if (rank) {
        if (rank !== "lower" && rank !== "mean") throw new Error("--rank očekává lower | mean");
        params = { ...params, rankBy: rank };
      }
      if (argv.includes("--eb")) params = { ...params, selectionCorrection: true };
      const pilotArg = arg(argv, "--pilot");
      if (pilotArg !== undefined) params = { ...params, pilotExpGames: Number(pilotArg) };
      const { report } = await runReplay(pool, scope, params, arg(argv, "--games") ? { maxGames: Number(arg(argv, "--games")) } : {});
      console.log(`replay: ${report.games} games, ${report.picks} picks, coverage ${(report.coverage * 100).toFixed(1)} %`);
      console.log(`lift: class 1 WR ${(report.lift.class1.wr * 100).toFixed(1)} % (n=${report.lift.class1.n}) vs other ${(report.lift.other.wr * 100).toFixed(1)} % (n=${report.lift.other.n}) → ${(report.lift.diff * 100).toFixed(1)} p.b.`);
      console.table(report.byRank.map((b) => ({ rank: b.bucket, n: b.n, wr: (b.wr * 100).toFixed(1) + "%", meanP: (b.meanP * 100).toFixed(1) + "%" })));
      const c = report.calibration;
      console.log(`calibration of P(chosen): logloss ${c.logloss.toFixed(5)}, brier ${c.brier.toFixed(5)}, auc ${c.auc.toFixed(4)}, ece ${c.ece.toFixed(4)}`);
      console.table(report.positionAccuracy.map((p) => ({ knownEnemies: p.knownEnemies, n: p.n, accuracy: Number.isNaN(p.accuracy) ? "-" : (p.accuracy * 100).toFixed(1) + "%" })));
      if (argv.includes("--persist")) {
        const run = await pool.query<{ run_id: number }>(`insert into model_run(patch, tier_band, params) values ($1,$2,$3) returning run_id`, [patch, band, { ...params, cutoff: cutoff.toISOString(), kind: "replay" }]);
        await pool.query(`insert into model_replay(run_id, games, picks, report) values ($1,$2,$3,$4)`, [run.rows[0]!.run_id, report.games, report.picks, JSON.stringify(report)]);
        console.log("saved replay run", run.rows[0]!.run_id);
      }
      return;
    }
    if (cmd === "eval") {
      const patch = arg(argv, "--patch") ?? (await pool.query<{ patch: string }>(`select patch from match group by 1 order by count(*) desc limit 1`)).rows[0]?.patch;
      if (!patch) throw new Error("no data");
      const band = (arg(argv, "--band") ?? null) as "low" | "mid" | "high" | null;
      let cutoff: Date;
      if (arg(argv, "--cutoff")) cutoff = new Date(arg(argv, "--cutoff")!);
      else {
        // default: split so that the last --cutoff-days (default 3) days of data are the test set
        const days = Number(arg(argv, "--cutoff-days") ?? 3);
        const mx = (await pool.query<{ mx: Date }>(`select max(game_start) mx from match where patch = $1`, [patch])).rows[0]!.mx;
        cutoff = new Date(mx.getTime() - days * 86400_000);
      }
      const scope = { patch, platforms: cfg.platforms, tierBand: band, cutoff };
      let params = DEFAULT_PARAMS;
      if (argv.includes("--grid")) params = (await gridSearch(pool, scope)).best;
      const rep = await runEval(pool, scope, params);
      console.log(`patch ${patch}, band ${band ?? "all"}, cutoff ${cutoff.toISOString()}, train ${rep.trainGames} games, test ${rep.testGames} games`);
      console.table(Object.entries(rep.results).map(([k, m]) => ({ variant: k, logloss: m.logloss.toFixed(5), brier: m.brier.toFixed(5), auc: m.auc.toFixed(4), ece: m.ece.toFixed(4), acc: (m.accuracy * 100).toFixed(1) + "%" })));
      if (argv.includes("--persist")) console.log("saved run", await persistEval(pool, rep, "holdout_same_patch"));
      return;
    }
    if (cmd === "score") {
      const pos = arg(argv, "--pos") as Position | undefined;
      if (!pos) throw new Error("--pos is required");
      const patch = arg(argv, "--patch") ?? (await pool.query<{ patch: string }>(`select patch from match group by 1 order by count(*) desc limit 1`)).rows[0]?.patch;
      if (!patch) throw new Error("no data");
      const band = (arg(argv, "--band") ?? null) as "low" | "mid" | "high" | null;
      const src = await loadStatsSource(pool, { patch, platforms: cfg.platforms, tierBand: band });
      const puuid = arg(argv, "--puuid");
      if (puuid) await src.preloadPlayer(puuid);
      const names = new Map((await pool.query<{ champion_id: number; name: string }>(`select champion_id, name from champion`)).rows.map((r) => [r.champion_id, r.name]));
      const state = { myPos: pos, allies: slots(arg(argv, "--allies")), enemies: slots(arg(argv, "--enemies")), bans: (arg(argv, "--bans") ?? "").split(",").filter(Boolean).map(Number), ...(puuid ? { myPuuid: puuid } : {}) };
      const recs = scoreDraft(state, src, DEFAULT_PARAMS);
      const top = Number(arg(argv, "--top") ?? 10);
      const classes = indifferenceClasses(recs);
      const classOf = new Map<number, number>();
      classes.forEach((cl, i) => cl.forEach((c) => classOf.set(c, i + 1)));
      console.log(`patch ${patch}, band ${band ?? "all"}, position ${pos}, ${recs.length} candidates`);
      console.table(recs.slice(0, top).map((r) => ({
        class: classOf.get(r.champ),
        champion: names.get(r.champ) ?? r.champ,
        p: (r.p * 100).toFixed(1) + "%",
        interval: `${(r.lo * 100).toFixed(1)}–${(r.hi * 100).toFixed(1)}`,
        games: r.contributions.find((c) => c.kind === "strength")?.games ?? 0,
        terms: r.contributions.filter((c) => c.kind !== "strength").map((c) => `${c.kind[0]}${c.vs ? ":" + (names.get(c.vs) ?? c.vs) : ""}${(c.logOdds >= 0 ? "+" : "") + c.logOdds.toFixed(2)}`).join(" "),
      })));
      return;
    }
    console.error(USAGE);
    process.exit(2);
  } finally {
    await pool.end();
  }
}

main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
