import type pg from "pg";
import { DEFAULT_PARAMS, type ModelParams, type StatsSource } from "./score.ts";
import { loadTestGames, loadTrainSource, type EvalScope, type TestGame } from "./eval.ts";
import { teamTerms, VARIANTS } from "./team.ts";
import { evaluate, type EvalMetrics } from "./metrics.ts";
import { sigmoid } from "./stats.ts";

/**
 * SPEC-09: one calibration layer over the model's deviation terms.
 *
 *   logit P(blue wins) = sideLogit + S + termScale · D
 *
 * S = strength baseline (calibrated on its own), D = sum of all deviation terms (counters,
 * synergies, player form, attribute prior). Two scalars fitted by maximum likelihood on the
 * holdout games — the layer answers "how much of the pairwise signal is real at this data volume"
 * without touching any prior. The fit is reported cross-validated (fit on one half of the test
 * period, scored on the other) so the number quoted is not the in-sample one.
 */
export interface CalibrationObs {
  s: number;
  d: number;
  y: 0 | 1;
}
export interface CalibrationFit {
  termScale: number;
  sideLogit: number;
  logloss: number;
  n: number;
}

/** Newton's method on the (convex) log-loss in (sideLogit, termScale); starts from the raw model. */
export function fitCalibration(obs: CalibrationObs[], maxIter = 50): CalibrationFit {
  let a = 0, tau = 1;
  for (let it = 0; it < maxIter; it++) {
    let ga = 0, gt = 0, haa = 0, hat = 0, htt = 0;
    for (const o of obs) {
      const p = sigmoid(a + o.s + tau * o.d);
      const r = p - o.y;
      const wgt = p * (1 - p);
      ga += r; gt += r * o.d;
      haa += wgt; hat += wgt * o.d; htt += wgt * o.d * o.d;
    }
    const det = haa * htt - hat * hat;
    if (Math.abs(det) < 1e-12) break;
    const da = (htt * ga - hat * gt) / det;
    const dt = (haa * gt - hat * ga) / det;
    a -= da; tau -= dt;
    if (Math.abs(da) < 1e-9 && Math.abs(dt) < 1e-9) break;
  }
  return { termScale: tau, sideLogit: a, logloss: logloss(obs, a, tau), n: obs.length };
}

export function logloss(obs: CalibrationObs[], a: number, tau: number): number {
  let ll = 0;
  for (const o of obs) {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, sigmoid(a + o.s + tau * o.d)));
    ll += o.y ? -Math.log(p) : -Math.log(1 - p);
  }
  return ll / obs.length;
}

export function observations(games: TestGame[], src: StatsSource, params: ModelParams): CalibrationObs[] {
  return games.map((g) => {
    const t = teamTerms(g.blue, g.red, src, params, VARIANTS.full);
    return { s: t.strength, d: t.deviations, y: g.blueWon ? 1 : 0 };
  });
}

export interface CalibrationReport {
  scope: EvalScope;
  params: ModelParams;
  trainGames: number;
  testGames: number;
  /** Fitted on all test games (the values to persist). */
  fit: CalibrationFit;
  /** Cross-validated: each half scored with the fit from the other half. */
  cv: { logloss: number; metrics: EvalMetrics; termScales: [number, number] };
  /** Reference points on the same games. */
  strengthOnly: EvalMetrics;
  raw: EvalMetrics;
}

export async function runCalibration(pool: pg.Pool, scope: EvalScope, params: ModelParams = DEFAULT_PARAMS): Promise<CalibrationReport> {
  const src = await loadTrainSource(pool, scope);
  const games = await loadTestGames(pool, scope);
  const trainGames = Number((await pool.query<{ n: string }>(
    `select count(*)::text n from match where patch = $1 and platform = any($2) and game_start < $3`, [scope.patch, scope.platforms, scope.cutoff])).rows[0]!.n);
  const obs = observations(games, src, params);
  const y = obs.map((o) => o.y);
  const fit = fitCalibration(obs);
  // time-ordered halves (loadTestGames orders by game_start): fit on one, score the other
  const half = Math.floor(obs.length / 2);
  const A = obs.slice(0, half), B = obs.slice(half);
  const fA = fitCalibration(A), fB = fitCalibration(B);
  const pCv = [...A.map((o) => sigmoid(fB.sideLogit + o.s + fB.termScale * o.d)), ...B.map((o) => sigmoid(fA.sideLogit + o.s + fA.termScale * o.d))];
  const cvMetrics = evaluate(pCv, y);
  return {
    scope, params, trainGames, testGames: games.length, fit,
    cv: { logloss: cvMetrics.logloss, metrics: cvMetrics, termScales: [fA.termScale, fB.termScale] },
    strengthOnly: evaluate(obs.map((o) => sigmoid(o.s)), y),
    raw: evaluate(obs.map((o) => sigmoid(o.s + o.d)), y),
  };
}

export interface StoredCalibration {
  termScale: number;
  sideLogit: number;
  attrWeight: number;
  priorNMatchup: number;
  priorNSynergy: number;
  fittedAt: Date;
}

/** Latest persisted calibration for the patch (band-agnostic for now: fitted on all bands pooled). */
export async function loadCalibration(pool: pg.Pool, patch: string): Promise<StoredCalibration | null> {
  const r = (await pool.query<{ term_scale: number; side_logit: number; attr_weight: number; prior_n_matchup: number; prior_n_synergy: number; fitted_at: Date }>(
    `select term_scale, side_logit, attr_weight, prior_n_matchup, prior_n_synergy, fitted_at
     from model_calibration where patch = $1 order by fitted_at desc limit 1`, [patch])).rows[0];
  return r ? { termScale: Number(r.term_scale), sideLogit: Number(r.side_logit), attrWeight: Number(r.attr_weight), priorNMatchup: r.prior_n_matchup, priorNSynergy: r.prior_n_synergy, fittedAt: r.fitted_at } : null;
}

/** Params the app should run with: defaults overlaid with the stored calibration (if the priors still match). */
export function applyCalibration(params: ModelParams, cal: StoredCalibration | null): ModelParams {
  if (!cal) return params;
  if (cal.priorNMatchup !== params.priorNMatchup || cal.priorNSynergy !== params.priorNSynergy) return params; // fitted for a different model
  return { ...params, termScale: cal.termScale, sideLogit: cal.sideLogit, attrWeight: cal.attrWeight };
}

export async function persistCalibration(pool: pg.Pool, rep: CalibrationReport): Promise<number> {
  const r = await pool.query<{ id: number }>(
    `insert into model_calibration(patch, tier_band, term_scale, side_logit, attr_weight, prior_n_matchup, prior_n_synergy, n_fit, train_games,
       logloss_strength, logloss_raw, logloss_cv, ece_cv, params)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
    [rep.scope.patch, rep.scope.tierBand, rep.fit.termScale, rep.fit.sideLogit, rep.params.attrWeight, rep.params.priorNMatchup, rep.params.priorNSynergy,
     rep.fit.n, rep.trainGames, rep.strengthOnly.logloss, rep.raw.logloss, rep.cv.logloss, rep.cv.metrics.ece,
     { ...rep.params, cutoff: rep.scope.cutoff.toISOString(), cvTermScales: rep.cv.termScales }]);
  return r.rows[0]!.id;
}
