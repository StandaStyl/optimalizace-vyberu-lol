import type pg from "pg";
import { RiotClient, tierBand, type Platform, type Tier } from "@da/core";

/** Tiers seeded evenly so all three bands get data (League-EXP-V4 paging, 205 entries/page). */
const SEED_TIERS: Array<{ tier: Tier; divisions: Array<"I" | "II" | "III" | "IV"> }> = [
  { tier: "SILVER", divisions: ["II"] },
  { tier: "GOLD", divisions: ["II"] },
  { tier: "PLATINUM", divisions: ["II"] },
  { tier: "EMERALD", divisions: ["II"] },
  { tier: "DIAMOND", divisions: ["II"] },
];

export interface SeedOptions {
  platforms: Platform[];
  pagesPerTier?: number;
  log?: (s: string) => void;
}

/** Fills seed_player from the ranked ladder. Idempotent (upsert). */
export async function seedPlayers(pool: pg.Pool, riot: RiotClient, opts: SeedOptions): Promise<number> {
  const log = opts.log ?? console.log;
  const pages = opts.pagesPerTier ?? 2;
  let inserted = 0;
  for (const platform of opts.platforms) {
    for (const { tier, divisions } of SEED_TIERS) {
      for (const division of divisions) {
        for (let page = 1; page <= pages; page++) {
          const entries = await riot.leagueEntries(platform, tier, division, page);
          if (!entries.length) break;
          const res = await pool.query(
            `insert into seed_player(puuid, platform, tier, division, tier_band)
             select * from unnest($1::text[], $2::text[], $3::tier_t[], $4::text[], $5::tier_band_t[])
             on conflict (puuid) do update set tier = excluded.tier, division = excluded.division, tier_band = excluded.tier_band`,
            [
              entries.map((e) => e.puuid),
              entries.map(() => platform),
              entries.map((e) => e.tier),
              entries.map((e) => e.rank),
              entries.map((e) => tierBand(e.tier)),
            ],
          );
          inserted += res.rowCount ?? 0;
          log(`seed ${platform} ${tier} ${division} p${page}: ${entries.length} players`);
        }
      }
    }
  }
  return inserted;
}
