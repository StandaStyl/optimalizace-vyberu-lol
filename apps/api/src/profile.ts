import type pg from "pg";
import { RiotApiError, RiotClient, tierBand, type Platform, type Tier, type TierBand } from "@da/core";

export interface Profile {
  puuid: string;
  gameName: string;
  tagLine: string;
  platform: Platform;
  tier: Tier | null;
  division: string | null;
  band: TierBand | null;
  /** Whether we hold any match history for this player. */
  inDb: boolean;
  lookedUpAt: string;
}

/** Parse "Name#TAG" (also accepts "Name-TAG" and URL-encoded forms). */
export function parseRiotId(s: string): { gameName: string; tagLine: string } | null {
  const m = s.trim().match(/^(.+?)\s*[#-]\s*([A-Za-z0-9]{2,6})$/);
  if (!m) return null;
  return { gameName: m[1]!.trim(), tagLine: m[2]!.toUpperCase() };
}

/**
 * Resolve a Riot ID to a profile. Riot API is used only for identity and rank
 * (Account-V1, Summoner-V4, League-V4); match history comes from our DB (SPEC-02).
 * Identity is cached in player_identity; rank refreshed when older than a day.
 */
export async function resolveProfile(pool: pg.Pool, riot: RiotClient, platforms: Platform[], riotId: string): Promise<Profile> {
  const id = parseRiotId(riotId);
  if (!id) throw new Error("Riot ID must look like Name#TAG");

  const cached = (await pool.query<{ puuid: string; game_name: string; tag_line: string; platform: Platform; looked_up_at: Date }>(
    `select puuid, game_name, tag_line, platform, looked_up_at from player_identity where lower(game_name) = lower($1) and lower(tag_line) = lower($2)`,
    [id.gameName, id.tagLine])).rows[0];

  let puuid: string, platform: Platform, gameName: string, tagLine: string;
  if (cached) {
    ({ puuid, platform } = cached); gameName = cached.game_name; tagLine = cached.tag_line;
  } else {
    const acc = await riot.accountByRiotId("europe", id.gameName, id.tagLine);
    puuid = acc.puuid; gameName = acc.gameName; tagLine = acc.tagLine;
    platform = await findPlatform(riot, platforms, puuid);
    await pool.query(
      `insert into player_identity(puuid, game_name, tag_line, platform) values ($1,$2,$3,$4)
       on conflict (puuid) do update set game_name = excluded.game_name, tag_line = excluded.tag_line, platform = excluded.platform, looked_up_at = now()`,
      [puuid, gameName, tagLine, platform]);
  }

  // Rank: from seed_player if fresh, else League-V4.
  const seed = (await pool.query<{ tier: Tier | null; division: string | null; tier_band: TierBand | null; tier_checked_at: Date | null }>(
    `select tier, division, tier_band, tier_checked_at from seed_player where puuid = $1`, [puuid])).rows[0];
  let tier = seed?.tier ?? null, division = seed?.division ?? null, band = seed?.tier_band ?? null;
  const stale = !seed?.tier_checked_at || Date.now() - seed.tier_checked_at.getTime() > 86400_000;
  if (stale) {
    try {
      const entries = await riot.leagueByPuuid(platform, puuid);
      const solo = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");
      tier = solo?.tier ?? null; division = solo?.rank ?? null; band = solo ? tierBand(solo.tier) : null;
      await pool.query(
        `insert into seed_player(puuid, platform, tier, division, tier_band, tier_checked_at) values ($1,$2,$3,$4,$5,now())
         on conflict (puuid) do update set tier = excluded.tier, division = excluded.division, tier_band = excluded.tier_band, tier_checked_at = now()`,
        [puuid, platform, tier, division, band]);
    } catch (e) {
      if (!(e instanceof RiotApiError)) throw e; // API hiccup: keep whatever we had
    }
  }

  const inDb = (await pool.query(`select 1 from participant where puuid = $1 limit 1`, [puuid])).rowCount === 1;
  return { puuid, gameName, tagLine, platform, tier, division, band, inDb, lookedUpAt: new Date().toISOString() };
}

async function findPlatform(riot: RiotClient, platforms: Platform[], puuid: string): Promise<Platform> {
  for (const p of platforms) {
    try { await riot.summonerByPuuid(p, puuid); return p; }
    catch (e) { if (!(e instanceof RiotApiError && e.status === 404)) throw e; }
  }
  throw new Error(`No summoner on ${platforms.join("/")} for this Riot ID`);
}
