import { clamp } from "./stats.ts";

export interface CalibrationBin {
  lo: number;
  hi: number;
  n: number;
  pred: number;
  obs: number;
}
export interface EvalMetrics {
  n: number;
  logloss: number;
  brier: number;
  auc: number;
  ece: number;
  accuracy: number;
  calibration: CalibrationBin[];
}

/** p = predicted P(y=1), y ∈ {0,1}. */
export function evaluate(p: number[], y: number[], bins = 10): EvalMetrics {
  if (p.length !== y.length) throw new Error("length mismatch");
  const n = p.length;
  let ll = 0, br = 0, acc = 0;
  for (let i = 0; i < n; i++) {
    const q = clamp(p[i]!, 1e-6, 1 - 1e-6);
    ll += y[i] ? -Math.log(q) : -Math.log(1 - q);
    br += (q - y[i]!) ** 2;
    acc += (q >= 0.5 ? 1 : 0) === y[i] ? 1 : 0;
  }
  const calibration: CalibrationBin[] = Array.from({ length: bins }, (_, k) => ({ lo: k / bins, hi: (k + 1) / bins, n: 0, pred: 0, obs: 0 }));
  for (let i = 0; i < n; i++) {
    const k = Math.min(bins - 1, Math.floor(p[i]! * bins));
    const b = calibration[k]!;
    b.n++; b.pred += p[i]!; b.obs += y[i]!;
  }
  let ece = 0;
  for (const b of calibration) {
    if (b.n) { b.pred /= b.n; b.obs /= b.n; ece += (b.n / n) * Math.abs(b.pred - b.obs); }
  }
  return { n, logloss: n ? ll / n : NaN, brier: n ? br / n : NaN, auc: auc(p, y), ece, accuracy: n ? acc / n : NaN, calibration };
}

/** Rank-based AUC (Mann–Whitney), ties count half. */
export function auc(p: number[], y: number[]): number {
  const idx = p.map((_, i) => i).sort((a, b) => p[a]! - p[b]!);
  const ranks = new Array<number>(p.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && p[idx[j + 1]!] === p[idx[i]!]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]!] = r;
    i = j + 1;
  }
  let pos = 0, sumPos = 0;
  for (let i = 0; i < y.length; i++) if (y[i]) { pos++; sumPos += ranks[i]!; }
  const neg = y.length - pos;
  if (!pos || !neg) return NaN;
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}
