import { getPool, loadConfig, type Position } from "@da/core";
import { loadStatsSource } from "./dbSource.ts";
import { DEFAULT_PARAMS, indifferenceClasses, scoreDraft, type Slot } from "./score.ts";

const USAGE = `usage: model/cli.ts <command>
  refresh                          recompute materialised aggregates (refresh_aggregates())
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
