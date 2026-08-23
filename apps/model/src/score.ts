import { POSITIONS, type Position } from "@da/core";
import { logit, mean, posterior, quantile, rng, sampleBeta, sigmoid, type BetaPosterior } from "./stats.ts";

/** Model parameters (defaults from plan §9.2; tuned in phase 3). */
export interface ModelParams {
  priorNStrength: number;
  priorNMatchup: number;
  priorNSynergy: number;
  priorNPlayer: number;
  recencyTauDays: number;
  intervalLevel: number;
  mcSamples: number;
}
export const DEFAULT_PARAMS: ModelParams = {
  priorNStrength: 500,
  priorNMatchup: 300,
  priorNSynergy: 150,
  priorNPlayer: 30,
  recencyTauDays: 60,
  intervalLevel: 0.8,
  mcSamples: 1000,
};

export interface WinLoss {
  games: number;
  wins: number;
}

/** Everything the scorer needs, already loaded for one (patch, platform, tierBand). */
export interface StatsSource {
  /** Champion strength on a position. */
  strength(champ: number, pos: Position): WinLoss | undefined;
  /** Games where champ A (pos_a) faced enemy champ B (pos_b); wins are A's. */
  matchup(champA: number, posA: Position, champB: number, posB: Position): WinLoss | undefined;
  /** Games where champ A (pos_a) had ally champ B (pos_b); wins are shared. */
  synergy(champA: number, posA: Position, champB: number, posB: Position): WinLoss | undefined;
  /** P(position | champion) as games per position. */
  positionPrior(champ: number): Partial<Record<Position, number>> | undefined;
  /** Player × champion history on the scored position (any position if unavailable). */
  player?(puuid: string, champ: number): (WinLoss & { lastPlayedDaysAgo?: number }) | undefined;
  /** Champions that exist on this patch. */
  champions(): number[];
}

export interface Slot {
  champ: number;
  /** Known position (our team from LCU) or undefined (enemy: inferred). */
  pos?: Position;
  puuid?: string;
}

export interface DraftState {
  myPos: Position;
  myPuuid?: string;
  allies: Slot[];
  enemies: Slot[];
  bans: number[];
}

export interface Contribution {
  kind: "strength" | "matchup" | "synergy" | "player";
  vs?: number;
  vsPos?: Position;
  /** Log-odds contribution (posterior mean). */
  logOdds: number;
  games: number;
}

export interface Recommendation {
  champ: number;
  p: number;
  lo: number;
  hi: number;
  contributions: Contribution[];
}

/**
 * Posterior over the *deviation* of a pairwise stat from what independence predicts.
 * Prior mean for a matchup A vs B is the independence expectation P = s_A(1-s_B)/(s_A(1-s_B)+(1-s_A)s_B).
 * Returned term = logit(posterior mean) - logit(expected), i.e. 0 when nothing is learned.
 */
function deviationTerm(observed: WinLoss | undefined, expected: number, priorN: number): { logOdds: number; post: BetaPosterior; expectedLogit: number } {
  const wins = observed?.wins ?? 0;
  const losses = (observed?.games ?? 0) - wins;
  const post = posterior(wins, losses, expected, priorN);
  const expectedLogit = logit(expected);
  return { logOdds: logit(mean(post)) - expectedLogit, post, expectedLogit };
}

function independence(sA: number, sB: number): number {
  const num = sA * (1 - sB);
  return num / (num + (1 - sA) * sB);
}

/**
 * Enemy position assignment: enumerate the 5! assignments consistent with position priors,
 * weight by product of priors, return per-enemy distribution over positions.
 * Enemies with known pos are fixed; slots not yet picked are free.
 */
export function inferEnemyPositions(enemies: Slot[], src: StatsSource): Map<number, Partial<Record<Position, number>>> {
  const result = new Map<number, Partial<Record<Position, number>>>();
  const n = enemies.length;
  if (n === 0) return result;
  const priors = enemies.map((e) => {
    if (e.pos) return { [e.pos]: 1 } as Partial<Record<Position, number>>;
    const pr = src.positionPrior(e.champ) ?? {};
    const total = Object.values(pr).reduce((a, b) => a + (b ?? 0), 0);
    const out: Partial<Record<Position, number>> = {};
    for (const p of POSITIONS) out[p] = total > 0 ? ((pr[p] ?? 0) + 0.5) / (total + 2.5) : 0.2; // Laplace-smoothed
    return out;
  });
  const weights = new Map<number, Map<Position, number>>();
  enemies.forEach((e) => weights.set(e.champ, new Map()));
  const used = new Set<Position>();
  const assign: Position[] = [];
  const rec = (i: number, w: number) => {
    if (i === n) {
      enemies.forEach((e, k) => {
        const m = weights.get(e.champ)!;
        m.set(assign[k]!, (m.get(assign[k]!) ?? 0) + w);
      });
      return;
    }
    for (const p of POSITIONS) {
      if (used.has(p)) continue;
      const pw = priors[i]![p] ?? 0;
      if (pw <= 0) continue;
      used.add(p);
      assign.push(p);
      rec(i + 1, w * pw);
      assign.pop();
      used.delete(p);
    }
  };
  rec(0, 1);
  for (const e of enemies) {
    const m = weights.get(e.champ)!;
    const z = [...m.values()].reduce((a, b) => a + b, 0) || 1;
    const out: Partial<Record<Position, number>> = {};
    for (const [p, w] of m) out[p] = w / z;
    result.set(e.champ, out);
  }
  return result;
}

/** Score every eligible champion for `state.myPos`. */
export function scoreDraft(state: DraftState, src: StatsSource, params: ModelParams = DEFAULT_PARAMS, seed = 42): Recommendation[] {
  const taken = new Set([...state.bans, ...state.allies.map((a) => a.champ), ...state.enemies.map((e) => e.champ)]);
  const enemyPos = inferEnemyPositions(state.enemies, src);
  const u = rng(seed);
  const out: Recommendation[] = [];

  const strengthOf = (champ: number, pos: Position) => {
    const s = src.strength(champ, pos);
    return posterior(s?.wins ?? 0, (s?.games ?? 0) - (s?.wins ?? 0), 0.5, params.priorNStrength);
  };

  for (const champ of src.champions()) {
    if (taken.has(champ)) continue;
    const sMe = strengthOf(champ, state.myPos);
    const playedHere = (src.strength(champ, state.myPos)?.games ?? 0) > 0;
    if (!playedHere) continue; // thesis rule: recommend only champions actually played on this position

    const terms: Array<{ c: Contribution; post: BetaPosterior; expectedLogit: number; weight: number }> = [];
    terms.push({ c: { kind: "strength", logOdds: logit(mean(sMe)), games: src.strength(champ, state.myPos)?.games ?? 0 }, post: sMe, expectedLogit: 0, weight: 1 });

    // Counters vs each enemy: expectation over their inferred positions.
    for (const e of state.enemies) {
      const dist = enemyPos.get(e.champ) ?? {};
      for (const pos of POSITIONS) {
        const w = dist[pos] ?? 0;
        if (w < 0.02) continue;
        const sB = mean(strengthOf(e.champ, pos));
        const obs = src.matchup(champ, state.myPos, e.champ, pos);
        const t = deviationTerm(obs, independence(mean(sMe), sB), params.priorNMatchup);
        terms.push({ c: { kind: "matchup", vs: e.champ, vsPos: pos, logOdds: t.logOdds * w, games: obs?.games ?? 0 }, post: t.post, expectedLogit: t.expectedLogit, weight: w });
      }
    }

    // Synergy with each ally (known positions).
    for (const a of state.allies) {
      if (!a.pos) continue;
      const sB = mean(strengthOf(a.champ, a.pos));
      const obs = src.synergy(champ, state.myPos, a.champ, a.pos);
      // Expected shared win-rate under independence of two allies: average of their log-odds.
      const expected = sigmoid((logit(mean(sMe)) + logit(sB)) / 2);
      const t = deviationTerm(obs, expected, params.priorNSynergy);
      terms.push({ c: { kind: "synergy", vs: a.champ, vsPos: a.pos, logOdds: t.logOdds, games: obs?.games ?? 0 }, post: t.post, expectedLogit: t.expectedLogit, weight: 1 });
    }

    // Player term: shrink player's own rate on this champ towards the champion's rate, decayed by recency.
    if (state.myPuuid && src.player) {
      const h = src.player(state.myPuuid, champ);
      if (h && h.games > 0) {
        const rec = h.lastPlayedDaysAgo === undefined ? 1 : Math.exp(-h.lastPlayedDaysAgo / params.recencyTauDays);
        const t = deviationTerm(h, mean(sMe), params.priorNPlayer);
        terms.push({ c: { kind: "player", logOdds: t.logOdds * rec, games: h.games }, post: t.post, expectedLogit: t.expectedLogit, weight: rec });
      }
    }

    const point = terms.reduce((acc, t) => acc + t.c.logOdds, 0);
    // Monte-Carlo interval: sample each term's posterior independently.
    const samples: number[] = new Array(params.mcSamples);
    for (let i = 0; i < params.mcSamples; i++) {
      let x = 0;
      for (const t of terms) x += (logit(sampleBeta(t.post, u)) - t.expectedLogit) * t.weight;
      samples[i] = sigmoid(x);
    }
    samples.sort((a, b) => a - b);
    const tail = (1 - params.intervalLevel) / 2;
    out.push({ champ, p: sigmoid(point), lo: quantile(samples, tail), hi: quantile(samples, 1 - tail), contributions: terms.map((t) => t.c) });
  }
  return out.sort((a, b) => b.p - a.p);
}

/**
 * Indifference classes (the thesis' AGREPREF view): consecutive champions whose intervals overlap
 * the class leader's interval belong to the same class.
 */
export function indifferenceClasses(recs: Recommendation[]): number[][] {
  const classes: number[][] = [];
  let current: Recommendation[] = [];
  for (const r of recs) {
    const leader = current[0];
    if (!leader || r.hi >= leader.lo) current.push(r);
    else {
      classes.push(current.map((x) => x.champ));
      current = [r];
    }
  }
  if (current.length) classes.push(current.map((x) => x.champ));
  return classes;
}
