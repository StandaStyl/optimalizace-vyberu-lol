import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type pg from "pg";
import { POSITIONS, type Platform, type Position, type TierBand } from "@da/core";
import { DEFAULT_PARAMS, indifferenceClasses, inferEnemyPositions, loadStatsSource, recommendBans, scoreDraft, teamWinProb, VARIANTS, type DbStatsSource, type Slot, type TeamSlot } from "@da/model";

export interface ApiOptions {
  pool: pg.Pool;
  platforms: Platform[];
  staticDir: string;
  /** Reload aggregates from DB this often. */
  reloadMs?: number;
}

interface Cached {
  patch: string;
  byBand: Map<string, DbStatsSource>;
  names: Map<number, { name: string; key: string }>;
  ddragon: string;
  loadedAt: number;
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

export function createApi(opts: ApiOptions) {
  const reloadMs = opts.reloadMs ?? 30 * 60_000;
  let cache: Cached | undefined;
  let loading: Promise<Cached> | undefined;

  async function load(): Promise<Cached> {
    const patchRow = (await opts.pool.query<{ patch: string; ddragon_ver: string }>(
      `select m.patch, p.ddragon_ver from match m join patch p using (patch) group by 1,2 order by count(*) desc limit 1`)).rows[0];
    if (!patchRow) throw new Error("no match data yet");
    const byBand = new Map<string, DbStatsSource>();
    for (const band of [null, "low", "mid", "high"] as Array<TierBand | null>) {
      byBand.set(band ?? "all", await loadStatsSource(opts.pool, { patch: patchRow.patch, platforms: opts.platforms, tierBand: band }));
    }
    const names = new Map((await opts.pool.query<{ champion_id: number; name: string; key: string }>(`select champion_id, name, key from champion`)).rows.map((r) => [r.champion_id, { name: r.name, key: r.key }]));
    return { patch: patchRow.patch, byBand, names, ddragon: patchRow.ddragon_ver, loadedAt: Date.now() };
  }
  async function get(): Promise<Cached> {
    if (cache && Date.now() - cache.loadedAt < reloadMs) return cache;
    loading ??= load().then((c) => { cache = c; loading = undefined; return c; }, (e) => { loading = undefined; throw e; });
    return cache ?? loading;
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
    let s = ""; req.on("data", (c) => { s += c; if (s.length > 1e6) req.destroy(); }); req.on("end", () => resolve(s)); req.on("error", reject);
  });
  const isPos = (p: unknown): p is Position => typeof p === "string" && (POSITIONS as readonly string[]).includes(p);
  const parseSlots = (xs: unknown): Slot[] => Array.isArray(xs) ? xs.filter((x) => x && Number.isInteger(x.champ)).map((x) => ({ champ: Number(x.champ), ...(isPos(x.pos) ? { pos: x.pos } : {}), ...(typeof x.puuid === "string" ? { puuid: x.puuid } : {}) })) : [];

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST" }); return res.end(); }

      if (url.pathname === "/api/health") return json(res, 200, { ok: true, patch: cache?.patch ?? null, loadedAt: cache?.loadedAt ?? null });

      if (url.pathname === "/api/champions") {
        const c = await get();
        const src = c.byBand.get("all")!;
        return json(res, 200, { patch: c.patch, ddragon: c.ddragon, champions: [...c.names].map(([id, n]) => ({ id, ...n, positions: src.positionPrior(id) ?? {} })) });
      }

      if (url.pathname === "/api/score" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!isPos(body.myPos)) return json(res, 400, { error: "myPos must be one of " + POSITIONS.join(",") });
        const c = await get();
        const src = c.byBand.get(typeof body.band === "string" && c.byBand.has(body.band) ? body.band : "all")!;
        const state = { myPos: body.myPos, allies: parseSlots(body.allies), enemies: parseSlots(body.enemies), bans: Array.isArray(body.bans) ? body.bans.map(Number).filter(Number.isInteger) : [], ...(typeof body.myPuuid === "string" ? { myPuuid: body.myPuuid } : {}) };
        if (state.myPuuid) await src.preloadPlayer(state.myPuuid);
        const recs = scoreDraft(state, src, DEFAULT_PARAMS);
        const classes = indifferenceClasses(recs);
        const classOf = new Map<number, number>(); classes.forEach((cl, i) => cl.forEach((ch) => classOf.set(ch, i + 1)));
        const enemyPositions = Object.fromEntries([...inferEnemyPositions(state.enemies, src)].map(([k, v]) => [k, v]));
        const top = Math.min(Number(body.top ?? 20), 60);
        const nm = (id: number) => c.names.get(id)?.name ?? String(id);
        const bans = recommendBans(state, recs, src, DEFAULT_PARAMS).map((b) => ({ ...b, name: nm(b.champ), key: c.names.get(b.champ)?.key }));
        return json(res, 200, {
          patch: c.patch, band: src.scope.tierBand ?? "all", myPos: state.myPos, candidates: recs.length, enemyPositions,
          recommendations: recs.slice(0, top).map((r) => ({ champ: r.champ, name: nm(r.champ), key: c.names.get(r.champ)?.key, class: classOf.get(r.champ), p: r.p, lo: r.lo, hi: r.hi,
            contributions: r.contributions.filter((x) => x.kind === "strength" || Math.abs(x.logOdds) >= 0.005).map((x) => ({ ...x, vsName: x.vs ? nm(x.vs) : undefined })),
            threats: r.threats.map((t) => ({ ...t, name: nm(t.champ) })) })),
          bans,
        });
      }

      if (url.pathname === "/api/winprob" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const c = await get();
        const src = c.byBand.get(typeof body.band === "string" && c.byBand.has(body.band) ? body.band : "all")!;
        const team = (xs: unknown): TeamSlot[] => parseSlots(xs).filter((s): s is TeamSlot => !!s.pos);
        const blue = team(body.blue), red = team(body.red);
        for (const s of [...blue, ...red]) if (s.puuid) await src.preloadPlayer(s.puuid);
        return json(res, 200, { patch: c.patch, blue: blue.length, red: red.length, pBlue: teamWinProb(blue, red, src, DEFAULT_PARAMS, VARIANTS.full), pBluePairwise: teamWinProb(blue, red, src, DEFAULT_PARAMS, VARIANTS.pairwise) });
      }

      // SPEC-02: delete my data — irreversible anonymisation of a puuid across all tables.
      if (url.pathname === "/api/player/delete" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (typeof body.puuid !== "string" || body.puuid.length < 20) return json(res, 400, { error: "puuid required" });
        const r = await opts.pool.query<{ n: number }>(`select anonymise_player($1) as n`, [body.puuid]);
        return json(res, 200, { anonymised: true, rowsTouched: r.rows[0]?.n ?? 0 });
      }

      if (url.pathname.startsWith("/api/player/")) {
        const puuid = decodeURIComponent(url.pathname.slice("/api/player/".length));
        const rows = (await opts.pool.query(`select champion_id, position, games, wins, last_played from agg_player_champ where puuid = $1 order by games desc limit 60`, [puuid])).rows;
        const c = await get();
        return json(res, 200, { puuid, champions: rows.map((r) => ({ ...r, name: c.names.get(r.champion_id)?.name })) });
      }

      if (url.pathname === "/api/model/replay") {
        const rows = (await opts.pool.query(`select r.run_id, r.patch, r.tier_band, r.created_at, p.games, p.picks, p.report
          from model_replay p join model_run r using (run_id) order by r.run_id desc limit 10`)).rows;
        return json(res, 200, { runs: rows });
      }

      if (url.pathname === "/api/model/eval") {
        const rows = (await opts.pool.query(`select r.run_id, r.patch, r.tier_band, r.params, r.created_at, e.split, e.baseline, e.n_games, e.logloss, e.brier, e.auc, e.ece, e.calibration
          from model_run r join model_eval e using (run_id) order by r.run_id desc, e.baseline limit 80`)).rows;
        const data = (await opts.pool.query(`select patch, count(*)::int games, min(game_start) first, max(game_start) last from match group by 1 order by 1 desc`)).rows;
        return json(res, 200, { runs: rows, data });
      }

      // static files
      const rel = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = normalize(join(opts.staticDir, rel));
      if (!file.startsWith(normalize(opts.staticDir))) return json(res, 403, { error: "forbidden" });
      try {
        const st = await stat(file);
        if (st.isFile()) { res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }); return res.end(await readFile(file)); }
      } catch { /* fallthrough */ }
      return json(res, 404, { error: "not found" });
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  const server = createServer((req, res) => { void handle(req, res); });
  return { server, warm: get };
}
