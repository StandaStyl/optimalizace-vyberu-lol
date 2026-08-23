import type pg from "pg";
import type { Platform, Position, TierBand } from "@da/core";
import type { ModelParams, StatsSource, WinLoss } from "./score.ts";
import { DEFAULT_PARAMS } from "./score.ts";
import { teamWinProb, VARIANTS, type TeamSlot, type TermWeights } from "./team.ts";
import { evaluate, type EvalMetrics } from "./metrics.ts";

export interface EvalScope {
  patch: string;
  platforms: Platform[];
  tierBand: TierBand | null;
  /** Games starting before this instant form the training set; at/after it the test set. */
  cutoff: Date;
}

/**
 * Stats computed from training games only (game_start < cutoff). Player history is
 * likewise restricted, so the test set never leaks into the features.
 */
export async function loadTrainSource(pool: pg.Pool, scope: EvalScope): Promise<StatsSource> {
  const bandSql = scope.tierBand ? "and p.tier_band = $4" : "";
  const params: unknown[] = [scope.patch, scope.platforms, scope.cutoff];
  if (scope.tierBand) params.push(scope.tierBand);

  const strength = new Map<string, WinLoss>();
  for (const r of (await pool.query<{ champion_id: number; position: Position; games: number; wins: number }>(
    `select p.champion_id, p.position, count(*)::int games, sum(case when p.win then 1 else 0 end)::int wins
     from participant p join match m using (match_id)
     where m.patch = $1 and m.platform = any($2) and m.game_start < $3 ${bandSql} and p.position is not null
     group by 1,2`, params)).rows)
    strength.set(`${r.champion_id}:${r.position}`, { games: r.games, wins: r.wins });

  const matchup = new Map<string, WinLoss>();
  for (const r of (await pool.query<{ champ_a: number; pos_a: Position; champ_b: number; pos_b: Position; games: number; wins: number }>(
    `select a.champion_id champ_a, a.position pos_a, b.champion_id champ_b, b.position pos_b,
            count(*)::int games, sum(case when a.win then 1 else 0 end)::int wins
     from participant a join participant b on b.match_id = a.match_id and b.team_id <> a.team_id
     join match m on m.match_id = a.match_id
     where m.patch = $1 and m.platform = any($2) and m.game_start < $3 ${bandSql.replace("p.tier_band", "a.tier_band")}
     group by 1,2,3,4`, params)).rows)
    matchup.set(`${r.champ_a}:${r.pos_a}|${r.champ_b}:${r.pos_b}`, { games: r.games, wins: r.wins });

  const synergy = new Map<string, WinLoss>();
  for (const r of (await pool.query<{ champ_a: number; pos_a: Position; champ_b: number; pos_b: Position; games: number; wins: number }>(
    `select a.champion_id champ_a, a.position pos_a, b.champion_id champ_b, b.position pos_b,
            count(*)::int games, sum(case when a.win then 1 else 0 end)::int wins
     from participant a join participant b on b.match_id = a.match_id and b.team_id = a.team_id and b.puuid <> a.puuid
     join match m on m.match_id = a.match_id
     where m.patch = $1 and m.platform = any($2) and m.game_start < $3 ${bandSql.replace("p.tier_band", "a.tier_band")}
     group by 1,2,3,4`, params)).rows)
    synergy.set(`${r.champ_a}:${r.pos_a}|${r.champ_b}:${r.pos_b}`, { games: r.games, wins: r.wins });

  // Player history before cutoff, any patch (form carries across patches), with recency relative to cutoff.
  const player = new Map<string, WinLoss & { lastPlayedDaysAgo: number }>();
  for (const r of (await pool.query<{ puuid: string; champion_id: number; games: number; wins: number; days: number }>(
    `select p.puuid, p.champion_id, count(*)::int games, sum(case when p.win then 1 else 0 end)::int wins,
            extract(epoch from $2::timestamptz - max(m.game_start))/86400 as days
     from participant p join match m using (match_id)
     where m.platform = any($1) and m.game_start < $2
     group by 1,2`, [scope.platforms, scope.cutoff])).rows)
    player.set(`${r.puuid}:${r.champion_id}`, { games: r.games, wins: r.wins, lastPlayedDaysAgo: Number(r.days) });

  // Position priors from training games (all bands — position choice is not band-specific enough to split).
  const prior = new Map<number, Partial<Record<Position, number>>>();
  for (const r of (await pool.query<{ champion_id: number; position: Position; games: number }>(
    `select p.champion_id, p.position, count(*)::int games from participant p join match m using (match_id)
     where m.patch = $1 and m.platform = any($2) and m.game_start < $3 and p.position is not null group by 1,2`,
    [scope.patch, scope.platforms, scope.cutoff])).rows) {
    const m = prior.get(r.champion_id) ?? {};
    m[r.position] = r.games;
    prior.set(r.champion_id, m);
  }

  const champions = [...new Set([...strength.keys()].map((k) => Number(k.split(":")[0])))];
  return {
    strength: (c, p) => strength.get(`${c}:${p}`),
    matchup: (a, pa, b, pb) => matchup.get(`${a}:${pa}|${b}:${pb}`),
    synergy: (a, pa, b, pb) => synergy.get(`${a}:${pa}|${b}:${pb}`),
    positionPrior: (c) => prior.get(c),
    player: (puuid, c) => player.get(`${puuid}:${c}`),
    champions: () => champions,
  };
}

export interface TestGame {
  matchId: string;
  blue: TeamSlot[];
  red: TeamSlot[];
  blueWon: boolean;
}

export async function loadTestGames(pool: pg.Pool, scope: EvalScope, from: Date = scope.cutoff, to?: Date): Promise<TestGame[]> {
  const bandSql = scope.tierBand ? "and exists (select 1 from participant q where q.match_id = m.match_id and q.tier_band = $5)" : "";
  const params: unknown[] = [scope.patch, scope.platforms, from, to ?? new Date(8640000000000000)];
  if (scope.tierBand) params.push(scope.tierBand);
  const rows = (await pool.query<{ match_id: string; winner_team: number; puuid: string; team_id: number; champion_id: number; position: Position }>(
    `select m.match_id, m.winner_team, p.puuid, p.team_id, p.champion_id, p.position
     from match m join participant p using (match_id)
     where m.patch = $1 and m.platform = any($2) and m.game_start >= $3 and m.game_start < $4 ${bandSql}
     order by m.match_id`, params)).rows;
  const games = new Map<string, TestGame>();
  for (const r of rows) {
    let g = games.get(r.match_id);
    if (!g) { g = { matchId: r.match_id, blue: [], red: [], blueWon: r.winner_team === 100 }; games.set(r.match_id, g); }
    (r.team_id === 100 ? g.blue : g.red).push({ champ: r.champion_id, pos: r.position, puuid: r.puuid });
  }
  return [...games.values()].filter((g) => g.blue.length === 5 && g.red.length === 5);
}

export function evaluateVariant(games: TestGame[], src: StatsSource, params: ModelParams, w: TermWeights): EvalMetrics {
  const p = games.map((g) => teamWinProb(g.blue, g.red, src, params, w));
  const y = games.map((g) => (g.blueWon ? 1 : 0));
  return evaluate(p, y);
}

export interface EvalReport {
  scope: EvalScope;
  trainGames: number;
  testGames: number;
  params: ModelParams;
  results: Record<keyof typeof VARIANTS, EvalMetrics>;
}

export async function runEval(pool: pg.Pool, scope: EvalScope, params: ModelParams = DEFAULT_PARAMS): Promise<EvalReport> {
  const src = await loadTrainSource(pool, scope);
  const games = await loadTestGames(pool, scope);
  const trainGames = Number((await pool.query<{ n: string }>(
    `select count(*)::text n from match where patch = $1 and platform = any($2) and game_start < $3`, [scope.patch, scope.platforms, scope.cutoff])).rows[0]!.n);
  const results = {} as EvalReport["results"];
  for (const k of Object.keys(VARIANTS) as Array<keyof typeof VARIANTS>) results[k] = evaluateVariant(games, src, params, VARIANTS[k]);
  return { scope, trainGames, testGames: games.length, params, results };
}

/** Small grid over prior strengths; returns the params minimising full-model log-loss on the holdout. */
export async function gridSearch(pool: pg.Pool, scope: EvalScope, log = console.log): Promise<{ best: ModelParams; logloss: number; tried: Array<{ params: ModelParams; logloss: number }> }> {
  const src = await loadTrainSource(pool, scope);
  const games = await loadTestGames(pool, scope);
  const grid = {
    priorNStrength: [200, 500, 1000],
    priorNMatchup: [100, 300, 1000],
    priorNSynergy: [50, 150, 500],
    priorNPlayer: [10, 30, 100],
  };
  const tried: Array<{ params: ModelParams; logloss: number }> = [];
  let best = { params: DEFAULT_PARAMS, logloss: Infinity };
  for (const s of grid.priorNStrength) for (const m of grid.priorNMatchup) for (const y of grid.priorNSynergy) for (const h of grid.priorNPlayer) {
    const params: ModelParams = { ...DEFAULT_PARAMS, priorNStrength: s, priorNMatchup: m, priorNSynergy: y, priorNPlayer: h };
    const ll = evaluateVariant(games, src, params, VARIANTS.full).logloss;
    tried.push({ params, logloss: ll });
    if (ll < best.logloss) best = { params, logloss: ll };
  }
  log(`grid: ${tried.length} combos on ${games.length} test games; best logloss ${best.logloss.toFixed(5)} with S=${best.params.priorNStrength} M=${best.params.priorNMatchup} Y=${best.params.priorNSynergy} H=${best.params.priorNPlayer}`);
  return { best: best.params, logloss: best.logloss, tried };
}

export async function persistEval(pool: pg.Pool, report: EvalReport, split: string): Promise<number> {
  const run = await pool.query<{ run_id: number }>(
    `insert into model_run(patch, tier_band, params) values ($1, $2, $3) returning run_id`,
    [report.scope.patch, report.scope.tierBand, { ...report.params, cutoff: report.scope.cutoff.toISOString(), platforms: report.scope.platforms, trainGames: report.trainGames }]);
  const runId = run.rows[0]!.run_id;
  for (const [baseline, m] of Object.entries(report.results)) {
    await pool.query(
      `insert into model_eval(run_id, split, n_games, logloss, brier, auc, ece, calibration, baseline) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [runId, split, m.n, m.logloss, m.brier, Number.isNaN(m.auc) ? 0.5 : m.auc, m.ece, JSON.stringify(m.calibration), baseline]);
  }
  return runId;
}
