import type pg from "pg";
import type { Position } from "@da/core";
import { DEFAULT_PARAMS, indifferenceClasses, inferEnemyPositions, scoreDraft, type ModelParams, type Slot, type StatsSource } from "./score.ts";
import { loadTestGames, loadTrainSource, type EvalScope, type TestGame } from "./eval.ts";
import { evaluate, type EvalMetrics } from "./metrics.ts";
import { rng } from "./stats.ts";
import type { TeamSlot } from "./team.ts";

/**
 * Retrospective "reality check" (SPEC-05 §1).
 * Match-V5 has no pick order, so each game gets one simulated draft in the standard
 * 1-2-2-2-2-1 order with a seeded random assignment of players to pick slots.
 * At every pick the scorer sees only what a real player would: earlier allies (positions known
 * from the lobby) and earlier enemies (positions inferred). Bans are not stored yet → not applied.
 */

export interface PickObservation {
  matchId: string;
  puuid: string;
  pos: Position;
  chosen: number;
  win: boolean;
  /** 1-based rank of the chosen champion among candidates; null when not a candidate (off-position / unseen). */
  rank: number | null;
  cls: number | null;
  candidates: number;
  pChosen: number | null;
  pTop: number;
  knownAllies: number;
  knownEnemies: number;
  /** Enemy position inference at this moment: (correct, total) over known enemies. */
  posCorrect: number;
  posTotal: number;
}

export interface ReplayReport {
  games: number;
  picks: number;
  /** Share of picks where the chosen champion was a candidate at all. */
  coverage: number;
  /** WR of picks from class 1 vs the rest (observational lift). */
  lift: { class1: { n: number; wr: number }; other: { n: number; wr: number }; diff: number };
  /** WR by rank bucket of the chosen champion. */
  byRank: Array<{ bucket: string; n: number; wr: number; meanP: number }>;
  /** Calibration of P(chosen champion) against the actual outcome. */
  calibration: EvalMetrics;
  /** H4: inferred-position accuracy by number of enemies known at the time. */
  positionAccuracy: Array<{ knownEnemies: number; n: number; accuracy: number }>;
}

const BLUE_ORDER = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1]; // 0 = blue picks, 1 = red picks

export function replayGame(game: TestGame, src: StatsSource, params: ModelParams, u: () => number): PickObservation[] {
  const shuffle = <T>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(u() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  const order: Array<{ team: 0 | 1; slot: TeamSlot }> = [];
  const queues = [shuffle(game.blue), shuffle(game.red)];
  for (const t of BLUE_ORDER) order.push({ team: t as 0 | 1, slot: queues[t]!.shift()! });

  const picked: Array<{ team: 0 | 1; slot: TeamSlot }> = [];
  const out: PickObservation[] = [];
  for (const cur of order) {
    const allies: Slot[] = picked.filter((p) => p.team === cur.team).map((p) => ({ champ: p.slot.champ, pos: p.slot.pos }));
    const enemies: Slot[] = picked.filter((p) => p.team !== cur.team).map((p) => ({ champ: p.slot.champ }));
    const enemyTruth = new Map(picked.filter((p) => p.team !== cur.team).map((p) => [p.slot.champ, p.slot.pos]));
    const state = { myPos: cur.slot.pos, allies, enemies, bans: [], ...(cur.slot.puuid ? { myPuuid: cur.slot.puuid } : {}) };
    const recs = scoreDraft(state, src, params, Math.floor(u() * 1e9));
    const classes = indifferenceClasses(recs);
    const idx = recs.findIndex((r) => r.champ === cur.slot.champ);
    const clsOf = idx >= 0 ? classes.findIndex((c) => c.includes(cur.slot.champ)) + 1 : null;

    let posCorrect = 0;
    if (enemies.length) {
      const inf = inferEnemyPositions(enemies, src);
      for (const [champ, dist] of inf) {
        const best = (Object.entries(dist) as Array<[Position, number]>).sort((a, b) => b[1] - a[1])[0];
        if (best && best[0] === enemyTruth.get(champ)) posCorrect++;
      }
    }
    const win = cur.team === 0 ? game.blueWon : !game.blueWon;
    out.push({
      matchId: game.matchId, puuid: cur.slot.puuid ?? "", pos: cur.slot.pos, chosen: cur.slot.champ, win,
      rank: idx >= 0 ? idx + 1 : null, cls: clsOf, candidates: recs.length,
      pChosen: idx >= 0 ? recs[idx]!.p : null, pTop: recs[0]?.p ?? 0.5,
      knownAllies: allies.length, knownEnemies: enemies.length, posCorrect, posTotal: enemies.length,
    });
    picked.push(cur);
  }
  return out;
}

export function summarise(obs: PickObservation[], games: number): ReplayReport {
  const covered = obs.filter((o) => o.rank !== null);
  const wr = (xs: PickObservation[]) => (xs.length ? xs.filter((o) => o.win).length / xs.length : NaN);
  const c1 = covered.filter((o) => o.cls === 1), rest = covered.filter((o) => o.cls !== 1);
  const buckets: Array<[string, (r: number, n: number) => boolean]> = [
    ["1", (r) => r === 1], ["2-3", (r) => r >= 2 && r <= 3], ["4-10", (r) => r >= 4 && r <= 10],
    ["11-25", (r) => r >= 11 && r <= 25], ["26+", (r) => r >= 26],
  ];
  const byRank = buckets.map(([bucket, f]) => {
    const xs = covered.filter((o) => f(o.rank!, o.candidates));
    return { bucket, n: xs.length, wr: wr(xs), meanP: xs.length ? xs.reduce((a, o) => a + o.pChosen!, 0) / xs.length : NaN };
  });
  const calibration = evaluate(covered.map((o) => o.pChosen!), covered.map((o) => (o.win ? 1 : 0)));
  const posAcc: ReplayReport["positionAccuracy"] = [];
  for (let k = 1; k <= 5; k++) {
    const xs = obs.filter((o) => o.knownEnemies === k);
    const tot = xs.reduce((a, o) => a + o.posTotal, 0);
    posAcc.push({ knownEnemies: k, n: tot, accuracy: tot ? xs.reduce((a, o) => a + o.posCorrect, 0) / tot : NaN });
  }
  return {
    games, picks: obs.length, coverage: obs.length ? covered.length / obs.length : NaN,
    lift: { class1: { n: c1.length, wr: wr(c1) }, other: { n: rest.length, wr: wr(rest) }, diff: wr(c1) - wr(rest) },
    byRank, calibration, positionAccuracy: posAcc,
  };
}

export async function runReplay(pool: pg.Pool, scope: EvalScope, params: ModelParams = DEFAULT_PARAMS, opts: { maxGames?: number; seed?: number; mcSamples?: number; log?: (s: string) => void } = {}): Promise<{ report: ReplayReport; observations: PickObservation[] }> {
  const log = opts.log ?? console.log;
  const src = await loadTrainSource(pool, scope);
  let games = await loadTestGames(pool, scope);
  if (opts.maxGames && games.length > opts.maxGames) games = games.slice(0, opts.maxGames);
  const p = { ...params, mcSamples: opts.mcSamples ?? 200 };
  const u = rng(opts.seed ?? 7);
  const obs: PickObservation[] = [];
  const t0 = Date.now();
  games.forEach((g, i) => {
    obs.push(...replayGame(g, src, p, u));
    if ((i + 1) % 50 === 0) log(`replayed ${i + 1}/${games.length} games (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  });
  return { report: summarise(obs, games.length), observations: obs };
}
