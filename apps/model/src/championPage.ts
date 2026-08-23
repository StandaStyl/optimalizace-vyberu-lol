import { POSITIONS, type Position } from "@da/core";
import { DEFAULT_PARAMS, type ModelParams, type StatsSource, type WinLoss } from "./score.ts";
import { logit, mean, posterior, sigmoid, type BetaPosterior } from "./stats.ts";

/** Approximate central interval of a Beta posterior (normal approximation; fine for the sizes we show). */
function interval(b: BetaPosterior, level = 0.8): { lo: number; hi: number } {
  const m = mean(b);
  const v = (b.alpha * b.beta) / ((b.alpha + b.beta) ** 2 * (b.alpha + b.beta + 1));
  const z = level === 0.8 ? 1.2816 : 1.96;
  const sd = Math.sqrt(v);
  return { lo: Math.max(0, m - z * sd), hi: Math.min(1, m + z * sd) };
}

export interface PositionRow {
  pos: Position;
  games: number;
  /** Share of the champion's games on this position. */
  share: number;
  wr: number;
  lo: number;
  hi: number;
}

export interface PairRow {
  champ: number;
  pos: Position;
  games: number;
  /** Observed win rate of the page champion in this pair. */
  wr: number;
  /** Posterior deviation from independence in log-odds (what the model actually uses). */
  delta: number;
  lo: number;
  hi: number;
}

export interface ChampionPage {
  champ: number;
  positions: PositionRow[];
  /** Per position the page champion is played on: best and worst matchups / synergies by posterior delta. */
  byPosition: Array<{ pos: Position; counters: PairRow[]; countered: PairRow[]; synergies: PairRow[]; antiSynergies: PairRow[] }>;
}

function strengthPost(src: StatsSource, champ: number, pos: Position, params: ModelParams): BetaPosterior {
  const s = src.strength(champ, pos);
  return posterior(s?.wins ?? 0, (s?.games ?? 0) - (s?.wins ?? 0), 0.5, params.priorNStrength);
}
function independence(sA: number, sB: number): number {
  const num = sA * (1 - sB);
  return num / (num + (1 - sA) * sB);
}

/**
 * Build the champion page from the same posteriors the scorer uses, so the numbers shown
 * are the numbers that drive recommendations (SPEC-03 transparency).
 */
export function championPage(champ: number, src: StatsSource, params: ModelParams = DEFAULT_PARAMS, minGames = 5, top = 8): ChampionPage {
  const total = POSITIONS.reduce((a, p) => a + (src.strength(champ, p)?.games ?? 0), 0);
  const positions: PositionRow[] = POSITIONS.map((pos) => {
    const s = src.strength(champ, pos);
    const b = strengthPost(src, champ, pos, params);
    const iv = interval(b);
    return { pos, games: s?.games ?? 0, share: total ? (s?.games ?? 0) / total : 0, wr: mean(b), ...iv };
  }).filter((r) => r.games > 0);

  const byPosition: ChampionPage["byPosition"] = [];
  for (const pos of positions.filter((r) => r.share >= 0.03 || r.games >= 20).map((r) => r.pos)) {
    const sMe = mean(strengthPost(src, champ, pos, params));
    const pairRows = (kind: "matchup" | "synergy"): PairRow[] => {
      const rows: PairRow[] = [];
      for (const other of src.champions()) {
        if (other === champ) continue;
        for (const opos of POSITIONS) {
          const obs: WinLoss | undefined = kind === "matchup" ? src.matchup(champ, pos, other, opos) : src.synergy(champ, pos, other, opos);
          if (!obs || obs.games < minGames) continue;
          const sB = mean(strengthPost(src, other, opos, params));
          const expected = kind === "matchup" ? independence(sMe, sB) : sigmoid((logit(sMe) + logit(sB)) / 2);
          const post = posterior(obs.wins, obs.games - obs.wins, expected, kind === "matchup" ? params.priorNMatchup : params.priorNSynergy);
          const iv = interval(post);
          rows.push({ champ: other, pos: opos, games: obs.games, wr: obs.wins / obs.games, delta: logit(mean(post)) - logit(expected), lo: logit(iv.lo) - logit(expected), hi: logit(iv.hi) - logit(expected) });
        }
      }
      return rows.sort((a, b) => b.delta - a.delta);
    };
    const m = pairRows("matchup"), s = pairRows("synergy");
    byPosition.push({ pos, counters: m.slice(0, top), countered: m.slice(-top).reverse(), synergies: s.slice(0, top), antiSynergies: s.slice(-top).reverse() });
  }
  return { champ, positions, byPosition };
}
