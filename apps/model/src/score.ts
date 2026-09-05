import { POSITIONS, type Position } from "@da/core";
import { ebShrink, logit, mean, posterior, quantile, rng, sampleBeta, sigmoid, type BetaPosterior } from "./stats.ts";

/** Model parameters (defaults from plan §9.2; tuned in phase 3). */
export interface ModelParams {
  priorNStrength: number;
  priorNMatchup: number;
  priorNSynergy: number;
  priorNPlayer: number;
  recencyTauDays: number;
  intervalLevel: number;
  mcSamples: number;
  /** Weight of expected-future-pick terms (SPEC-06 §2); 0 disables them. Tuned by validation. */
  futureWeight: number;
  /** Future-pick distribution: ignore champions below this pick share on a position (noise cut). */
  futureMinShare: number;
  /**
   * Decision rule (SPEC-07 B). "lower" ranks by the lower end of the credible interval, so a
   * champion with 70 games at 76 % cannot outrank one with 1 100 games at 54 % on the strength
   * of noise — the classic winner's curse, handled as a decision rule rather than by re-shrinking
   * the estimates. "mean" is the posterior mean (the old behaviour).
   */
  rankBy: "lower" | "mean";
  /** Post-hoc empirical-Bayes shrinkage of the field (the 26. 8. correction). Kept for evaluation; off by default. */
  selectionCorrection: boolean;
  /**
   * Pilot experience (SPEC-07 C). A player with at least this many games on a champion (in our data)
   * is "experienced"; measured 2026-09-05: experienced pilots win 54–58 % vs 49.9 % for the rest
   * (+4.5 p.b. pooled). Strength is estimated within the user's own stratum. 0 disables the split.
   */
  pilotExpGames: number;
}
export const DEFAULT_PARAMS: ModelParams = {
  priorNStrength: 500,
  priorNMatchup: 300,
  priorNSynergy: 150,
  priorNPlayer: 30,
  recencyTauDays: 60,
  intervalLevel: 0.8,
  mcSamples: 1000,
  futureWeight: 1,
  futureMinShare: 0.01,
  rankBy: "lower",
  selectionCorrection: false,
  pilotExpGames: 10,
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
  /**
   * Strength split by pilot experience (SPEC-07 C): games/wins on this champion×position by
   * players who already had ≥ pilotExpGames games on the champion ("exp") vs the rest ("new").
   */
  pilot?(champ: number, pos: Position): { exp: WinLoss; new: WinLoss } | undefined;
  /** Pooled logit gap experienced − new across all cells (estimated once from the whole table). */
  pilotGapLogit?(): number;
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
  kind: "strength" | "matchup" | "synergy" | "player" | "future_matchup" | "future_synergy";
  vs?: number;
  vsPos?: Position;
  /** Log-odds contribution (posterior mean). */
  logOdds: number;
  games: number;
  /** For the strength term: which pilot stratum the estimate comes from (SPEC-07 C). */
  stratum?: "new" | "exp";
}

export interface Threat {
  champ: number;
  pos: Position;
  /** Probability the enemy still picks this champion on this position. */
  pPick: number;
  /** Counter log-odds if it happens (negative = threat). */
  logOdds: number;
}

export interface Recommendation {
  champ: number;
  p: number;
  lo: number;
  hi: number;
  contributions: Contribution[];
  /** Most harmful not-yet-picked, not-banned enemy champions for this candidate. */
  threats: Threat[];
}

/**
 * Posterior over the *deviation* of a pairwise stat from what independence predicts.
 * Prior mean for a matchup A vs B is the independence expectation P = s_A(1-s_B)/(s_A(1-s_B)+(1-s_A)s_B).
 * Returned term = logit(posterior mean) - logit(expected), i.e. 0 when nothing is learned.
 */
function deviationTerm(observed: WinLoss | undefined, expected: number, priorN: number): { logOdds: number; post: BetaPosterior; expectedLogit: number; sVar: number } {
  const wins = observed?.wins ?? 0;
  const losses = (observed?.games ?? 0) - wins;
  const post = posterior(wins, losses, expected, priorN);
  const expectedLogit = logit(expected);
  return { logOdds: logit(mean(post)) - expectedLogit, post, expectedLogit, sVar: samplingVar(wins + losses, mean(post), priorN) };
}

/**
 * Sampling variance of the posterior-mean *estimator* in logit space — the selection noise
 * the winner's-curse correction shrinks against. This is NOT the posterior width: with no
 * data the estimate equals the prior deterministically (variance 0), with a strong prior
 * the estimator barely moves with the data. Var[m] = n·m(1−m)/(N0+n)²; divided by (m(1−m))²
 * for the delta-method transfer to logit scale.
 */
function samplingVar(n: number, m: number, priorN: number): number {
  if (n <= 0) return 0;
  const mq = Math.max(1e-6, m * (1 - m));
  return n / ((priorN + n) ** 2 * mq);
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

/** A champion counts as "played on this position" when it has ≥3 % of its games there or ≥20 games there. */
export function playedOnPosition(champ: number, pos: Position, src: StatsSource): boolean {
  const games = src.strength(champ, pos)?.games ?? 0;
  if (games >= 20) return true;
  const pr = src.positionPrior(champ);
  if (!pr) return games > 0;
  const total = Object.values(pr).reduce((a, b) => a + (b ?? 0), 0);
  return total > 0 && (pr[pos] ?? 0) / total >= 0.03;
}

/** P(champion | position) from pick counts, excluding `excluded` champions; empty map when nothing is known. */
export function pickDistribution(pos: Position, src: StatsSource, excluded: Set<number>, minShare: number): Map<number, number> {
  const out = new Map<number, number>();
  let total = 0;
  for (const ch of src.champions()) {
    if (excluded.has(ch)) continue;
    const g = src.strength(ch, pos)?.games ?? 0;
    if (g > 0) { out.set(ch, g); total += g; }
  }
  if (!total) return out;
  for (const [ch, g] of out) { const s = g / total; if (s < minShare) out.delete(ch); else out.set(ch, s); }
  const z = [...out.values()].reduce((a, b) => a + b, 0) || 1;
  for (const [ch, s] of out) out.set(ch, s / z);
  return out;
}

/** How much of each enemy position is already occupied (sum of inferred position probabilities). */
export function enemyOccupancy(enemyPos: Map<number, Partial<Record<Position, number>>>): Record<Position, number> {
  const occ = { TOP: 0, JUNGLE: 0, MIDDLE: 0, BOTTOM: 0, UTILITY: 0 } as Record<Position, number>;
  for (const dist of enemyPos.values()) for (const p of POSITIONS) occ[p] = Math.min(1, occ[p] + (dist[p] ?? 0));
  return occ;
}

/** Score every eligible champion for `state.myPos`. */
export function scoreDraft(state: DraftState, src: StatsSource, params: ModelParams = DEFAULT_PARAMS, seed = 42): Recommendation[] {
  const taken = new Set([...state.bans, ...state.allies.map((a) => a.champ), ...state.enemies.map((e) => e.champ)]);
  const enemyPos = inferEnemyPositions(state.enemies, src);
  const occupancy = enemyOccupancy(enemyPos);
  const u = rng(seed);
  const out: Recommendation[] = [];
  const estVar: number[] = []; // per-candidate sampling variance of the summed logit, for ebShrink below

  const strengthOf = (champ: number, pos: Position) => {
    const s = src.strength(champ, pos);
    return posterior(s?.wins ?? 0, (s?.games ?? 0) - (s?.wins ?? 0), 0.5, params.priorNStrength);
  };

  /**
   * Strength of a candidate for THIS user (SPEC-07 C): estimated within the user's pilot stratum.
   * Population win rate is dominated by non-specialists, so an anonymous or inexperienced user gets
   * the "new" cell. An experienced user gets the sparse "exp" cell with its prior centred on the
   * new-pilot rate shifted by the pooled gap — the pooled +4.5 p.b. speaks before the champion's
   * own experienced-pilot games do (hierarchical prior), and the player term H then deviates from
   * this stratum base rather than from the population average.
   */
  const candidateStrength = (champ: number, pos: Position): { post: BetaPosterior; games: number; stratum: "all" | "new" | "exp" } => {
    const split = params.pilotExpGames > 0 ? src.pilot?.(champ, pos) : undefined;
    if (!split) {
      return { post: strengthOf(champ, pos), games: src.strength(champ, pos)?.games ?? 0, stratum: "all" };
    }
    const newPost = posterior(split.new.wins, split.new.games - split.new.wins, 0.5, params.priorNStrength);
    const myGames = state.myPuuid && src.player ? (src.player(state.myPuuid, champ)?.games ?? 0) : 0;
    if (myGames < params.pilotExpGames) return { post: newPost, games: split.new.games, stratum: "new" };
    const priorMean = sigmoid(logit(mean(newPost)) + (src.pilotGapLogit?.() ?? 0));
    return { post: posterior(split.exp.wins, split.exp.games - split.exp.wins, priorMean, params.priorNStrength), games: split.exp.games, stratum: "exp" };
  };

  for (const champ of src.champions()) {
    if (taken.has(champ)) continue;
    if (!playedOnPosition(champ, state.myPos, src)) continue; // thesis rule, tightened: a real pick on this position, not a one-off
    const cs = candidateStrength(champ, state.myPos);
    const sMe = cs.post;

    const terms: Array<{ c: Contribution; post: BetaPosterior | null; expectedLogit: number; weight: number; sVar: number }> = [];
    const sGames = cs.games;
    terms.push({ c: { kind: "strength", logOdds: logit(mean(sMe)), games: sGames, ...(cs.stratum === "all" ? {} : { stratum: cs.stratum }) }, post: sMe, expectedLogit: 0, weight: 1, sVar: samplingVar(sGames, mean(sMe), params.priorNStrength) });

    // Counters vs each enemy: expectation over their inferred positions.
    for (const e of state.enemies) {
      const dist = enemyPos.get(e.champ) ?? {};
      for (const pos of POSITIONS) {
        const w = dist[pos] ?? 0;
        if (w < 0.02) continue;
        const sB = mean(strengthOf(e.champ, pos));
        const obs = src.matchup(champ, state.myPos, e.champ, pos);
        const t = deviationTerm(obs, independence(mean(sMe), sB), params.priorNMatchup);
        terms.push({ c: { kind: "matchup", vs: e.champ, vsPos: pos, logOdds: t.logOdds * w, games: obs?.games ?? 0 }, post: t.post, expectedLogit: t.expectedLogit, weight: w, sVar: t.sVar });
      }
    }

    // Synergy with each ally (known positions).
    for (const a of state.allies) {
      if (!a.pos) continue;
      const sB = mean(strengthOf(a.champ, a.pos));
      const obs = src.synergy(champ, state.myPos, a.champ, a.pos);
      // Expected shared win-rate under independence: log-odds add, consistently with the
      // team strength term (Σ logit s) and the matchup baseline (logit sA − logit sB).
      // The former average (…/2) let half of each pair's strength leak into "synergy";
      // summed over 10 pairs (each champ in 4) that re-counted team strength ~2× extra.
      const expected = sigmoid(logit(mean(sMe)) + logit(sB));
      const t = deviationTerm(obs, expected, params.priorNSynergy);
      terms.push({ c: { kind: "synergy", vs: a.champ, vsPos: a.pos, logOdds: t.logOdds, games: obs?.games ?? 0 }, post: t.post, expectedLogit: t.expectedLogit, weight: 1, sVar: t.sVar });
    }

    // Player term: shrink player's own rate on this champ towards the champion's rate, decayed by recency.
    if (state.myPuuid && src.player) {
      const h = src.player(state.myPuuid, champ);
      if (h && h.games > 0) {
        const rec = h.lastPlayedDaysAgo === undefined ? 1 : Math.exp(-h.lastPlayedDaysAgo / params.recencyTauDays);
        const t = deviationTerm(h, mean(sMe), params.priorNPlayer);
        terms.push({ c: { kind: "player", logOdds: t.logOdds * rec, games: h.games }, post: t.post, expectedLogit: t.expectedLogit, weight: rec, sVar: t.sVar });
      }
    }

    // Expected future picks (SPEC-06 §2): enemies on unfilled positions and allies on unfilled positions,
    // drawn from pick rates with bans and already-picked champions excluded. Deterministic expectation (no MC).
    const threats: Threat[] = [];
    if (params.futureWeight > 0) {
      const excl = new Set([...taken, champ]);
      let fm = 0, fmGames = 0;
      for (const pos of POSITIONS) {
        const free = 1 - occupancy[pos];
        if (free < 0.02) continue;
        const dist = pickDistribution(pos, src, excl, params.futureMinShare);
        for (const [y, py] of dist) {
          const sB = mean(strengthOf(y, pos));
          const obs = src.matchup(champ, state.myPos, y, pos);
          const t = deviationTerm(obs, independence(mean(sMe), sB), params.priorNMatchup);
          fm += free * py * t.logOdds; fmGames += obs?.games ?? 0;
          if (t.logOdds < 0) threats.push({ champ: y, pos, pPick: free * py, logOdds: t.logOdds });
        }
      }
      terms.push({ c: { kind: "future_matchup", logOdds: params.futureWeight * fm, games: fmGames }, post: null, expectedLogit: 0, weight: 0, sVar: 0 });

      let fs = 0, fsGames = 0;
      const allyFilled = new Set<Position>([state.myPos, ...state.allies.flatMap((a) => (a.pos ? [a.pos] : []))]);
      for (const pos of POSITIONS) {
        if (allyFilled.has(pos)) continue;
        const dist = pickDistribution(pos, src, excl, params.futureMinShare);
        for (const [y, py] of dist) {
          const sB = mean(strengthOf(y, pos));
          const obs = src.synergy(champ, state.myPos, y, pos);
          const t = deviationTerm(obs, sigmoid(logit(mean(sMe)) + logit(sB)), params.priorNSynergy);
          fs += py * t.logOdds; fsGames += obs?.games ?? 0;
        }
      }
      terms.push({ c: { kind: "future_synergy", logOdds: params.futureWeight * fs, games: fsGames }, post: null, expectedLogit: 0, weight: 0, sVar: 0 });
    }
    threats.sort((a, b) => a.pPick * a.logOdds - b.pPick * b.logOdds);

    const point = terms.reduce((acc, t) => acc + t.c.logOdds, 0);
    // Monte-Carlo interval: sample each term's posterior independently.
    const samples: number[] = new Array(params.mcSamples);
    for (let i = 0; i < params.mcSamples; i++) {
      let x = 0;
      for (const t of terms) x += t.post ? (logit(sampleBeta(t.post, u)) - t.expectedLogit) * t.weight : t.c.logOdds;
      samples[i] = sigmoid(x);
    }
    samples.sort((a, b) => a - b);
    const tail = (1 - params.intervalLevel) / 2;
    // Selection noise of this candidate's point estimate: independent terms add in weight².
    // (Future terms are probability-weighted averages of many devs — their noise is small; left out.)
    estVar.push(Math.max(1e-9, terms.reduce((a, t) => a + t.weight * t.weight * t.sVar, 0)));
    out.push({ champ, p: sigmoid(point), lo: quantile(samples, tail), hi: quantile(samples, 1 - tail), contributions: terms.map((t) => t.c), threats: threats.slice(0, 5) });
  }

  // Optional post-hoc empirical-Bayes shrinkage of the field (the 26. 8. correction, v2).
  // Kept selectable for evaluation. Its noise model is the sampling variance of the *shrunk*
  // estimator, which is smallest exactly for few-game candidates — so it under-corrects the
  // small-sample outlier at the top (Tryndamere mid: 71 games at 76 % ranked above Lux with
  // 1 109 games). SPEC-07 B handles that case as a decision rule instead: see the sort below.
  if (params.selectionCorrection && out.length >= 5) {
    const { mu, lambda } = ebShrink(out.map((r) => logit(r.p)), estVar);
    out.forEach((r, i) => {
      const x = logit(r.p);
      const xNew = mu + lambda[i]! * (x - mu);
      r.lo = sigmoid(logit(r.lo) + (xNew - x));
      r.hi = sigmoid(logit(r.hi) + (xNew - x));
      r.p = sigmoid(xNew);
    });
  }
  // Decision rule (SPEC-07 B): rank by the lower credible bound — "how good is this pick at
  // worst, given what we know" — so a wide-interval candidate needs a genuinely higher point
  // estimate to lead. The point estimate p is still reported; only the order changes.
  if (params.rankBy === "lower") return out.sort((a, b) => b.lo - a.lo || b.p - a.p);
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

export interface BanRecommendation {
  champ: number;
  /** Expected loss (log-odds) to our top candidates if this champion stays available. */
  expectedLoss: number;
  /** Probability the enemy picks it somewhere. */
  pPick: number;
}

/**
 * Ban = champion whose availability costs our best candidates the most (SPEC-06 §3):
 * loss(Y) = Σ_k w_k · Σ_pos free(pos)·P(Y|pos)·C(X_k vs Y at pos), over the top-K candidates weighted by rank.
 */
export function recommendBans(state: DraftState, recs: Recommendation[], src: StatsSource, params: ModelParams = DEFAULT_PARAMS, topK = 5): BanRecommendation[] {
  const taken = new Set([...state.bans, ...state.allies.map((a) => a.champ), ...state.enemies.map((e) => e.champ)]);
  const occupancy = enemyOccupancy(inferEnemyPositions(state.enemies, src));
  const top = recs.slice(0, topK);
  const weights = top.map((_, i) => 1 / (i + 1));
  const wz = weights.reduce((a, b) => a + b, 0);
  const strengthOf = (ch: number, pos: Position) => { const s = src.strength(ch, pos); return posterior(s?.wins ?? 0, (s?.games ?? 0) - (s?.wins ?? 0), 0.5, params.priorNStrength); };
  const loss = new Map<number, { loss: number; pPick: number }>();
  top.forEach((r, k) => {
    const sMe = mean(strengthOf(r.champ, state.myPos));
    for (const pos of POSITIONS) {
      const free = 1 - occupancy[pos];
      if (free < 0.02) continue;
      const dist = pickDistribution(pos, src, new Set([...taken, r.champ]), params.futureMinShare);
      for (const [y, py] of dist) {
        const t = deviationTerm(src.matchup(r.champ, state.myPos, y, pos), independence(sMe, mean(strengthOf(y, pos))), params.priorNMatchup);
        const cur = loss.get(y) ?? { loss: 0, pPick: 0 };
        cur.loss += (weights[k]! / wz) * free * py * t.logOdds;
        if (k === 0) cur.pPick += free * py;
        loss.set(y, cur);
      }
    }
  });
  return [...loss].map(([champ, v]) => ({ champ, expectedLoss: v.loss, pPick: Math.min(1, v.pPick) }))
    .filter((b) => b.expectedLoss < 0).sort((a, b) => a.expectedLoss - b.expectedLoss).slice(0, 10);
}
