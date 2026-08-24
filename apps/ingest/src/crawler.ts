import type pg from "pg";
import { RiotApiError, RiotClient, patchOf, POSITIONS, type MatchDto, type MatchParticipantDto, type Platform, type Position } from "@da/core";

/** Riot returns 401 (and sometimes 403) for an expired or revoked key — every call then fails. */
export class ExpiredKeyError extends Error {
  constructor() {
    super("Riot API key rejected (401/403) — the development key expires after 24 h. Put a fresh key in .env as RIOT_API_KEY.");
    this.name = "ExpiredKeyError";
  }
}
const AUTH_FAILURE_LIMIT = 5;
function isAuthError(e: unknown): boolean {
  return e instanceof RiotApiError && (e.status === 401 || e.status === 403);
}

export interface CrawlOptions {
  platforms: Platform[];
  queueId: number;
  /** Only matches started after this unix time (s). Defaults to 14 days ago. */
  startTime?: number;
  matchesPerPlayer?: number;
  /** Stop after this many matches were stored (undefined = run until queue and seeds are exhausted). */
  maxMatches?: number;
  log?: (s: string) => void;
}

/**
 * Phase 1 crawler.
 *  1. Take seed players not crawled recently → fetch their recent ranked match ids → enqueue.
 *  2. Drain match_queue → fetch match → store match + 10 participants → snowball new puuids into seed_player.
 * Restart-safe: everything is keyed by match_id / puuid with upserts; queue state survives crashes.
 */
export async function crawl(pool: pg.Pool, riot: RiotClient, opts: CrawlOptions): Promise<{ stored: number; failed: number }> {
  const log = opts.log ?? console.log;
  const startTime = opts.startTime ?? Math.floor(Date.now() / 1000) - 14 * 86400;
  const perPlayer = opts.matchesPerPlayer ?? 20;
  let stored = 0;
  let failed = 0;
  let authFailures = 0;

  // Items left in 'working' by a crashed/killed run go back to the queue.
  const stale = await pool.query(`update match_queue set state = 'pending' where state = 'working'`);
  if (stale.rowCount) log(`re-queued ${stale.rowCount} stale items`);

  for (;;) {
    if (opts.maxMatches !== undefined && stored >= opts.maxMatches) break;

    // Keep the queue topped up from seed players.
    const pending = await pool.query<{ n: string }>(`select count(*)::text as n from match_queue where state = 'pending'`);
    if (Number(pending.rows[0]!.n) < 200) {
      const enqueued = await enqueueFromSeeds(pool, riot, opts.platforms, opts.queueId, startTime, perPlayer, 25, log);
      if (enqueued === 0 && Number(pending.rows[0]!.n) === 0) {
        log("queue empty and no uncrawled seeds left");
        break;
      }
    }

    const batch = await pool.query<{ match_id: string; platform: Platform }>(
      `update match_queue set state = 'working', attempts = attempts + 1
       where match_id in (select match_id from match_queue where state = 'pending' order by enqueued_at limit 50 for update skip locked)
       returning match_id, platform`,
    );
    if (!batch.rows.length) continue;

    for (const row of batch.rows) {
      try {
        const dto = await riot.match(riot.regionOf(row.platform), row.match_id);
        const ok = await storeMatch(pool, dto, row.platform, opts.queueId);
        await pool.query(`update match_queue set state = $2, done_at = now() where match_id = $1`, [row.match_id, ok ? "done" : "skipped"]);
        if (ok) stored++;
        authFailures = 0;
      } catch (e) {
        failed++;
        if (isAuthError(e)) authFailures++; else authFailures = 0;
        const permanent = e instanceof RiotApiError && (e.status === 404 || e.status === 403);
        await pool.query(
          `update match_queue set state = case when $2 or attempts >= 3 then 'failed' else 'pending' end where match_id = $1`,
          [row.match_id, permanent],
        );
        log(`match ${row.match_id}: ${(e as Error).message}`);
        // An expired key fails every request; without this the queue would silently drain to 'failed'.
        if (authFailures >= AUTH_FAILURE_LIMIT) throw new ExpiredKeyError();
      }
    }
    log(`stored ${stored}, failed ${failed}`);
  }
  return { stored, failed };
}

async function enqueueFromSeeds(
  pool: pg.Pool, riot: RiotClient, platforms: Platform[], queueId: number, startTime: number,
  perPlayer: number, players: number, log: (s: string) => void,
): Promise<number> {
  const seeds = await pool.query<{ puuid: string; platform: Platform }>(
    `select puuid, platform from seed_player
     where platform = any($1) and (last_crawled is null or last_crawled < now() - interval '1 day')
     order by last_crawled nulls first limit $2`,
    [platforms, players],
  );
  let total = 0;
  let authFailures = 0;
  for (const s of seeds.rows) {
    try {
      const ids = await riot.matchIds(riot.regionOf(s.platform), s.puuid, queueId, perPlayer, 0, startTime);
      authFailures = 0;
      if (ids.length) {
        const r = await pool.query(
          `insert into match_queue(match_id, platform) select unnest($1::text[]), $2 on conflict do nothing`,
          [ids, s.platform],
        );
        total += r.rowCount ?? 0;
      }
    } catch (e) {
      if (isAuthError(e)) authFailures++; else authFailures = 0;
      log(`ids for ${s.puuid.slice(0, 8)}…: ${(e as Error).message}`);
      if (authFailures >= AUTH_FAILURE_LIMIT) throw new ExpiredKeyError();
    }
    await pool.query(`update seed_player set last_crawled = now() where puuid = $1`, [s.puuid]);
  }
  log(`enqueued ${total} new matches from ${seeds.rows.length} players`);
  return total;
}

function toPosition(p: string): Position | null {
  return (POSITIONS as readonly string[]).includes(p) ? (p as Position) : null;
}

/** Stores one match. Returns false when the match is skipped (wrong queue, remake, missing positions). */
export async function storeMatch(pool: pg.Pool, dto: MatchDto, platform: Platform, queueId: number): Promise<boolean> {
  const info = dto.info;
  if (info.queueId !== queueId) return false;
  if (info.gameDuration < 600) return false; // remakes / early surrenders carry no draft signal
  if (info.participants.length !== 10) return false;
  const positions = info.participants.map((p: MatchParticipantDto) => toPosition(p.teamPosition));
  if (positions.some((p) => p === null)) return false;

  const winner = info.teams.find((t) => t.win)?.teamId;
  if (winner !== 100 && winner !== 200) return false;
  const patch = patchOf(info.gameVersion);

  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`insert into patch(patch, ddragon_ver) values ($1, $2) on conflict do nothing`, [patch, `${patch}.1`]);
    await c.query(
      `insert into match(match_id, platform, patch, game_version, queue_id, game_start, duration_sec, winner_team)
       values ($1,$2,$3,$4,$5,to_timestamp($6/1000.0),$7,$8) on conflict (match_id) do nothing`,
      [dto.metadata.matchId, platform, patch, info.gameVersion, info.queueId, info.gameCreation, info.gameDuration, winner],
    );
    for (let i = 0; i < info.participants.length; i++) {
      const p = info.participants[i]!;
      const keystone = p.perks?.styles?.[0]?.selections?.[0]?.perk ?? null;
      await c.query(
        `insert into participant(match_id, puuid, team_id, champion_id, position, win, tier_band,
           kills, deaths, assists, items, primary_style, sub_style, keystone, champ_level,
           physical_dmg, magic_dmg, true_dmg, dmg_taken)
         values ($1,$2,$3,$4,$5,$6,(select tier_band from seed_player where puuid = $2),
           $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         on conflict (match_id, puuid) do nothing`,
        [
          dto.metadata.matchId, p.puuid, p.teamId, p.championId, positions[i], p.win,
          p.kills, p.deaths, p.assists,
          [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
          p.perks?.styles?.[0]?.style ?? null, p.perks?.styles?.[1]?.style ?? null, keystone, p.champLevel,
          p.physicalDamageDealtToChampions, p.magicDamageDealtToChampions, p.trueDamageDealtToChampions, p.totalDamageTaken,
        ],
      );
    }
    for (const t of info.teams) {
      for (const b of t.bans ?? []) {
        if (b.championId <= 0) continue; // -1 = no ban
        await c.query(`insert into match_ban(match_id, team_id, champion_id, pick_turn) values ($1,$2,$3,$4) on conflict do nothing`,
          [dto.metadata.matchId, t.teamId, b.championId, b.pickTurn]);
      }
    }
    // Snowball: unknown players become seeds with unknown tier (filled later by lookupTiers()).
    await c.query(
      `insert into seed_player(puuid, platform) select unnest($1::text[]), $2 on conflict do nothing`,
      [info.participants.map((p) => p.puuid), platform],
    );
    await c.query("commit");
    return true;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
