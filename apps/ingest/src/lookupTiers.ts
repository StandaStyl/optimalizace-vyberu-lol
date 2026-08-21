import type pg from "pg";
import { RiotClient, tierBand, type Platform, type Tier } from "@da/core";

/** Fills tier/tier_band for snowballed seed players (League-V4 by-puuid). Also stamps participant.tier_band. */
export async function lookupTiers(pool: pg.Pool, riot: RiotClient, platforms: Platform[], limit = 200, log = console.log): Promise<number> {
  const rows = await pool.query<{ puuid: string; platform: Platform }>(
    `select puuid, platform from seed_player where platform = any($1) and tier_band is null and tier_checked_at is null limit $2`,
    [platforms, limit],
  );
  let filled = 0;
  for (const r of rows.rows) {
    try {
      const entries = await riot.leagueByPuuid(r.platform, r.puuid);
      const solo = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");
      if (solo) {
        const band = tierBand(solo.tier as Tier);
        await pool.query(
          `update seed_player set tier = $2, division = $3, tier_band = $4, tier_checked_at = now() where puuid = $1`,
          [r.puuid, solo.tier, solo.rank, band],
        );
        await pool.query(`update participant set tier_band = $2 where puuid = $1 and tier_band is null`, [r.puuid, band]);
        filled++;
      } else {
        await pool.query(`update seed_player set tier_checked_at = now() where puuid = $1`, [r.puuid]);
      }
    } catch (e) {
      log(`tier for ${r.puuid.slice(0, 8)}…: ${(e as Error).message}`);
    }
  }
  log(`tiers filled: ${filled}/${rows.rows.length}`);
  return filled;
}
