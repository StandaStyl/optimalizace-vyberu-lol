import type { Position } from "@da/core";
import type { WinLoss } from "./score.ts";

/** One champion-vs-attribute cell: A on posA against enemies on posB with dim = value. */
export interface AttrRow {
  champ: number;
  posA: Position;
  posB: Position;
  dim: string;
  value: string;
  games: number;
  wins: number;
  expWins: number;
}
export type AttrCell = WinLoss & { expWins: number };

/**
 * SPEC-08: lookup tables for the attribute prior, built once per StatsSource.
 *  - champion level: (A, posA, posB, dim, value) and the pooled "*" over all values of dim;
 *  - group level: the same keyed by A's class (champion_attr dim "class") — champions of one class
 *    pooled, which is where attribute effects are actually measurable (tens of thousands of games
 *    vs hundreds for one champion). attrPrior reads group first, champion as a shrunk residual.
 */
export function buildAttrIndex(rows: AttrRow[], attrs: Map<number, Record<string, string>>) {
  const champ = new Map<string, AttrCell>();
  const group = new Map<string, AttrCell>();
  const add = (m: Map<string, AttrCell>, k: string, r: AttrRow) => {
    const p = m.get(k) ?? { games: 0, wins: 0, expWins: 0 };
    m.set(k, { games: p.games + r.games, wins: p.wins + r.wins, expWins: p.expWins + r.expWins });
  };
  for (const r of rows) {
    add(champ, `${r.champ}:${r.posA}|${r.posB}|${r.dim}=${r.value}`, r);
    add(champ, `${r.champ}:${r.posA}|${r.posB}|${r.dim}=*`, r);
    const cls = attrs.get(r.champ)?.class;
    if (cls) {
      add(group, `${cls}:${r.posA}|${r.posB}|${r.dim}=${r.value}`, r);
      add(group, `${cls}:${r.posA}|${r.posB}|${r.dim}=*`, r);
    }
  }
  return {
    vsAttr: (a: number, pa: Position, pb: Position, dim: string, v: string) => champ.get(`${a}:${pa}|${pb}|${dim}=${v}`),
    vsAttrGroup: (cls: string, pa: Position, pb: Position, dim: string, v: string) => group.get(`${cls}:${pa}|${pb}|${dim}=${v}`),
  };
}
