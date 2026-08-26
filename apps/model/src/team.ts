import type { Position } from "@da/core";
import { logit, mean, posterior, sigmoid } from "./stats.ts";
import type { ModelParams, StatsSource, WinLoss } from "./score.ts";

/** Which terms a model variant uses — the evaluation baselines are subsets of the full model. */
export interface TermWeights {
  strength: number;
  matchup: number;
  synergy: number;
  player: number;
}
export const VARIANTS: Record<"const" | "strength" | "pairwise" | "full", TermWeights> = {
  const: { strength: 0, matchup: 0, synergy: 0, player: 0 },
  strength: { strength: 1, matchup: 0, synergy: 0, player: 0 },
  pairwise: { strength: 1, matchup: 1, synergy: 1, player: 0 },
  full: { strength: 1, matchup: 1, synergy: 1, player: 1 },
};

export interface TeamSlot {
  champ: number;
  pos: Position;
  puuid?: string;
}

function dev(observed: WinLoss | undefined, expected: number, priorN: number): number {
  const wins = observed?.wins ?? 0;
  const losses = (observed?.games ?? 0) - wins;
  return logit(mean(posterior(wins, losses, expected, priorN))) - logit(expected);
}
function independence(sA: number, sB: number): number {
  const num = sA * (1 - sB);
  return num / (num + (1 - sA) * sB);
}

/**
 * Log-odds that `blue` beats `red`, given full drafts with known positions.
 * Same terms as scoreDraft, applied symmetrically to both teams:
 *   Σ S(blue) − Σ S(red) + Σ_{b,r} C(b vs r) + Σ_{b,b'} Y(b,b') − Σ_{r,r'} Y(r,r') + Σ H(blue) − Σ H(red)
 * Matchup deviations are directional (A vs B = −(B vs A)), so the 25 cross pairs are counted once.
 */
export function teamLogit(blue: TeamSlot[], red: TeamSlot[], src: StatsSource, params: ModelParams, w: TermWeights): number {
  const s = (t: TeamSlot) => {
    const x = src.strength(t.champ, t.pos);
    return mean(posterior(x?.wins ?? 0, (x?.games ?? 0) - (x?.wins ?? 0), 0.5, params.priorNStrength));
  };
  const sb = blue.map(s);
  const sr = red.map(s);
  let x = 0;
  if (w.strength) x += w.strength * (sb.reduce((a, p) => a + logit(p), 0) - sr.reduce((a, p) => a + logit(p), 0));
  if (w.matchup) {
    for (let i = 0; i < blue.length; i++)
      for (let j = 0; j < red.length; j++) {
        const b = blue[i]!, r = red[j]!;
        const obs = src.matchup(b.champ, b.pos, r.champ, r.pos);
        const rev = src.matchup(r.champ, r.pos, b.champ, b.pos);
        // pool both directions when stored one way only
        const pooled: WinLoss | undefined = obs ?? (rev ? { games: rev.games, wins: rev.games - rev.wins } : undefined);
        x += w.matchup * dev(pooled, independence(sb[i]!, sr[j]!), params.priorNMatchup);
      }
  }
  if (w.synergy) {
    const syn = (team: TeamSlot[], st: number[]) => {
      let y = 0;
      for (let i = 0; i < team.length; i++)
        for (let j = i + 1; j < team.length; j++) {
          const a = team[i]!, b = team[j]!;
          const obs = src.synergy(a.champ, a.pos, b.champ, b.pos) ?? src.synergy(b.champ, b.pos, a.champ, a.pos);
          y += dev(obs, sigmoid(logit(st[i]!) + logit(st[j]!)), params.priorNSynergy);
        }
      return y;
    };
    x += w.synergy * (syn(blue, sb) - syn(red, sr));
  }
  if (w.player && src.player) {
    const h = (team: TeamSlot[], st: number[]) => {
      let y = 0;
      team.forEach((t, i) => {
        if (!t.puuid) return;
        const hist = src.player!(t.puuid, t.champ);
        if (!hist || hist.games === 0) return;
        const rec = hist.lastPlayedDaysAgo === undefined ? 1 : Math.exp(-hist.lastPlayedDaysAgo / params.recencyTauDays);
        y += rec * dev(hist, st[i]!, params.priorNPlayer);
      });
      return y;
    };
    x += w.player * (h(blue, sb) - h(red, sr));
  }
  return x;
}

export function teamWinProb(blue: TeamSlot[], red: TeamSlot[], src: StatsSource, params: ModelParams, w: TermWeights = VARIANTS.full): number {
  return sigmoid(teamLogit(blue, red, src, params, w));
}
