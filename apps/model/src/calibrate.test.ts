import { describe, it, expect } from "vitest";
import { fitCalibration, logloss, type CalibrationObs } from "./calibrate.ts";
import { DEFAULT_PARAMS, scoreDraft, type StatsSource, type WinLoss } from "./score.ts";
import { teamLogit, VARIANTS } from "./team.ts";
import { rng, sigmoid } from "./stats.ts";

/** Synthetic games whose true log-odds are a + s + 0.4·d: the raw model (τ = 1) is 2.5× over-confident. */
function synth(n: number, aTrue: number, tauTrue: number): CalibrationObs[] {
  const u = rng(7);
  const gauss = () => { let x = 0; for (let i = 0; i < 12; i++) x += u(); return x - 6; };
  const out: CalibrationObs[] = [];
  for (let i = 0; i < n; i++) {
    const s = 0.3 * gauss(), d = 0.8 * gauss();
    out.push({ s, d, y: u() < sigmoid(aTrue + s + tauTrue * d) ? 1 : 0 });
  }
  return out;
}

describe("SPEC-09: calibration layer", () => {
  it("recovers the deviation scale and the side term from data", () => {
    const obs = synth(40000, 0.1, 0.4);
    const f = fitCalibration(obs);
    expect(f.termScale).toBeGreaterThan(0.33);
    expect(f.termScale).toBeLessThan(0.47);
    expect(f.sideLogit).toBeGreaterThan(0.05);
    expect(f.sideLogit).toBeLessThan(0.15);
    expect(f.logloss).toBeLessThan(logloss(obs, 0, 1));           // better than the raw model
    expect(f.logloss).toBeLessThanOrEqual(logloss(obs, 0.1, 0.4) + 1e-3); // and as good as the truth
  });

  it("leaves a well-calibrated model alone (τ ≈ 1, a ≈ 0)", () => {
    const f = fitCalibration(synth(40000, 0, 1));
    expect(Math.abs(f.termScale - 1)).toBeLessThan(0.08);
    expect(Math.abs(f.sideLogit)).toBeLessThan(0.05);
  });

  it("scales every deviation term in scoreDraft and teamLogit, never the strength baseline", () => {
    const wl = (games: number, wr: number): WinLoss => ({ games, wins: Math.round(games * wr) });
    const strength: Record<string, WinLoss> = { "1:BOTTOM": wl(2000, 0.55), "4:BOTTOM": wl(2000, 0.5), "5:UTILITY": wl(2000, 0.5) };
    const src: StatsSource = {
      strength: (c, p) => strength[`${c}:${p}`],
      matchup: (a, _pa, b) => (a === 1 && b === 4 ? wl(3000, 0.6) : undefined),
      synergy: (a, pa, b) => (a === 1 && b === 5 ? wl(3000, 0.6) : undefined),
      positionPrior: (c) => (c === 4 ? { BOTTOM: 1000 } : c === 5 ? { UTILITY: 1000 } : undefined),
      champions: () => [1, 4, 5],
    };
    const base = { ...DEFAULT_PARAMS, mcSamples: 200, futureWeight: 0, pilotExpGames: 0, selectionCorrection: false };
    const state = { myPos: "BOTTOM" as const, allies: [{ champ: 5, pos: "UTILITY" as const }], enemies: [{ champ: 4, pos: "BOTTOM" as const }], bans: [] };
    const raw = scoreDraft(state, src, base).find((r) => r.champ === 1)!;
    const half = scoreDraft(state, src, { ...base, termScale: 0.5 }).find((r) => r.champ === 1)!;
    const term = (r: typeof raw, k: string) => r.contributions.find((c) => c.kind === k)!.logOdds;
    expect(term(half, "strength")).toBeCloseTo(term(raw, "strength"), 9);
    expect(term(half, "matchup")).toBeCloseTo(term(raw, "matchup") / 2, 9);
    expect(term(half, "synergy")).toBeCloseTo(term(raw, "synergy") / 2, 9);
    expect(half.p).toBeLessThan(raw.p);
    expect(half.hi - half.lo).toBeLessThan(raw.hi - raw.lo);  // narrower interval: the deviation samples are scaled too

    const blue = [{ champ: 1, pos: "BOTTOM" as const }, { champ: 5, pos: "UTILITY" as const }];
    const red = [{ champ: 4, pos: "BOTTOM" as const }];
    const xRaw = teamLogit(blue, red, src, base, VARIANTS.full);
    const xS = teamLogit(blue, red, src, base, VARIANTS.strength);
    const xHalf = teamLogit(blue, red, src, { ...base, termScale: 0.5, sideLogit: 0.07 }, VARIANTS.full);
    expect(xHalf).toBeCloseTo(0.07 + xS + (xRaw - xS) / 2, 9);
  });
});
