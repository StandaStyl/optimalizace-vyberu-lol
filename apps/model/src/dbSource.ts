import type pg from "pg";
import type { Platform, Position, TierBand } from "@da/core";
import type { StatsSource, WinLoss } from "./score.ts";

export interface LoadScope {
  patch: string;
  /** Platforms pooled together (EUNE + EUW share a model). */
  platforms: Platform[];
  /** null = all bands pooled. */
  tierBand: TierBand | null;
}

/**
 * Loads the materialised aggregates for one scope into memory maps.
 * Sizes: ~170 champs × 5 pos strength; matchups/synergies only for observed pairs.
 */
export interface DbStatsSource extends StatsSource {
  loadedAt: Date;
  scope: LoadScope;
  /** Load a player's history before scoring with `myPuuid`. */
  preloadPlayer(puuid: string): Promise<void>;
}

export async function loadStatsSource(pool: pg.Pool, scope: LoadScope): Promise<DbStatsSource> {
  const bandSql = scope.tierBand ? "and tier_band = $3" : "";
  const params: unknown[] = [scope.patch, scope.platforms];
  if (scope.tierBand) params.push(scope.tierBand);

  const strength = new Map<string, WinLoss>();
  for (const r of (await pool.query<{ champion_id: number; position: Position; games: number; wins: number }>(
    `select champion_id, position, sum(games)::int games, sum(wins)::int wins from mat_champ_pos
     where patch = $1 and platform = any($2) ${bandSql} and position is not null group by 1,2`, params)).rows)
    strength.set(`${r.champion_id}:${r.position}`, { games: r.games, wins: r.wins });

  const matchup = new Map<string, WinLoss>();
  for (const r of (await pool.query<{ champ_a: number; pos_a: Position; champ_b: number; pos_b: Position; games: number; wins_a: number }>(
    `select champ_a, pos_a, champ_b, pos_b, sum(games)::int games, sum(wins_a)::int wins_a from mat_matchup
     where patch = $1 and platform = any($2) ${bandSql} group by 1,2,3,4`, params)).rows)
    matchup.set(`${r.champ_a}:${r.pos_a}|${r.champ_b}:${r.pos_b}`, { games: r.games, wins: r.wins_a });

  const synergy = new Map<string, WinLoss>();
  for (const r of (await pool.query<{ champ_a: number; pos_a: Position; champ_b: number; pos_b: Position; games: number; wins: number }>(
    `select champ_a, pos_a, champ_b, pos_b, sum(games)::int games, sum(wins)::int wins from mat_synergy
     where patch = $1 and platform = any($2) ${bandSql} group by 1,2,3,4`, params)).rows)
    synergy.set(`${r.champ_a}:${r.pos_a}|${r.champ_b}:${r.pos_b}`, { games: r.games, wins: r.wins });

  const prior = new Map<number, Partial<Record<Position, number>>>();
  for (const r of (await pool.query<{ champion_id: number; position: Position; games: number }>(
    `select champion_id, position, sum(games)::int games from mat_position_prior
     where patch = $1 and platform = any($2) and position is not null group by 1,2`, [scope.patch, scope.platforms])).rows) {
    const m = prior.get(r.champion_id) ?? {};
    m[r.position] = r.games;
    prior.set(r.champion_id, m);
  }

  const champions = (await pool.query<{ champion_id: number }>(`select champion_id from champion order by 1`)).rows.map((r) => r.champion_id);

  // Player history is queried lazily (one player per request) and cached for the life of this source.
  const playerCache = new Map<string, Map<number, WinLoss & { lastPlayedDaysAgo: number }>>();
  const loadPlayer = async (puuid: string) => {
    if (playerCache.has(puuid)) return;
    const rows = (await pool.query<{ champion_id: number; games: number; wins: number; days: number }>(
      `select champion_id, sum(games)::int games, sum(wins)::int wins,
              extract(epoch from now() - max(last_played))/86400 as days
       from agg_player_champ where puuid = $1 group by 1`, [puuid])).rows;
    const m = new Map<number, WinLoss & { lastPlayedDaysAgo: number }>();
    for (const r of rows) m.set(r.champion_id, { games: r.games, wins: r.wins, lastPlayedDaysAgo: Number(r.days) });
    playerCache.set(puuid, m);
  };

  return {
    loadedAt: new Date(),
    scope,
    strength: (c, p) => strength.get(`${c}:${p}`),
    matchup: (a, pa, b, pb) => matchup.get(`${a}:${pa}|${b}:${pb}`),
    synergy: (a, pa, b, pb) => synergy.get(`${a}:${pa}|${b}:${pb}`),
    positionPrior: (c) => prior.get(c),
    player: (puuid, c) => playerCache.get(puuid)?.get(c),
    champions: () => champions,
    preloadPlayer: loadPlayer,
  };
}
