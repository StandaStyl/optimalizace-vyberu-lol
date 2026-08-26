/**
 * Statistical primitives for the model.
 *
 * Every empirical quantity is a Beta posterior over a win probability:
 *   Beta(alpha0 + wins, beta0 + losses), prior centred on `priorMean` with strength `priorN`.
 * This replaces the thesis' Z-test + Šidák threshold: effect size is kept, and sparse data
 * shrinks towards the prior instead of flipping between "significant" and "nothing".
 */

export interface BetaPosterior {
  alpha: number;
  beta: number;
}

export function posterior(wins: number, losses: number, priorMean: number, priorN: number): BetaPosterior {
  const m = clamp(priorMean, 1e-4, 1 - 1e-4);
  return { alpha: m * priorN + wins, beta: (1 - m) * priorN + losses };
}

export function mean(b: BetaPosterior): number {
  return b.alpha / (b.alpha + b.beta);
}

export function logit(p: number): number {
  const q = clamp(p, 1e-6, 1 - 1e-6);
  return Math.log(q / (1 - q));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Empirical-Bayes shrinkage across candidates (winner's-curse correction).
 * Model: true values x_c ~ N(mu, tau2), estimates xHat_c with known variance vars_c.
 * Posterior mean of x_c is mu + lambda_c (xHat_c - mu), lambda_c = tau2 / (tau2 + vars_c).
 * tau2 is estimated by method of moments (observed spread minus average noise), with two
 * precision-weighted refinement iterations; tau2 = 0 means the spread is all noise and
 * every candidate collapses to the field mean.
 */
export function ebShrink(xs: number[], vars: number[]): { mu: number; lambda: number[] } {
  const n = xs.length;
  let mu = xs.reduce((a, x) => a + x, 0) / n;
  let tau2 = Math.max(0, xs.reduce((a, x) => a + (x - mu) ** 2, 0) / n - vars.reduce((a, v) => a + v, 0) / n);
  for (let it = 0; it < 2; it++) {
    const w = vars.map((v) => 1 / (v + tau2 + 1e-9));
    const W = w.reduce((a, b) => a + b, 0);
    mu = xs.reduce((a, x, i) => a + w[i]! * x, 0) / W;
    tau2 = Math.max(0, xs.reduce((a, x, i) => a + w[i]! * ((x - mu) ** 2 - vars[i]!), 0) / W);
  }
  return { mu, lambda: vars.map((v) => tau2 / (tau2 + v)) };
}

/**
 * Deterministic PRNG (mulberry32) so Monte-Carlo intervals are reproducible for a given seed.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Marsaglia–Tsang gamma sampler (shape >= 1 via boost for shape < 1). */
function sampleGamma(shape: number, u: () => number): number {
  if (shape < 1) return sampleGamma(shape + 1, u) * Math.pow(u(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(u);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const r = u();
    if (r < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(r) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function normal(u: () => number): number {
  let a = 0;
  while (a === 0) a = u();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u());
}

export function sampleBeta(b: BetaPosterior, u: () => number): number {
  const x = sampleGamma(b.alpha, u);
  const y = sampleGamma(b.beta, u);
  return x / (x + y);
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = clamp(q * (sorted.length - 1), 0, sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}
