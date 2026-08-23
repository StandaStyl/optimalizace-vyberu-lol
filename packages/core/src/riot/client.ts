import { RateLimiter } from "./rateLimiter.ts";
import { PLATFORM_TO_REGION, type Platform, type Region, type Tier } from "../types.ts";

export class RiotApiError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string) {
    super(`Riot API ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

export interface RiotClientOptions {
  apiKey: string;
  perSecond?: number;
  per2Min?: number;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

export interface LeagueEntry {
  puuid: string;
  tier: Tier;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

export interface MatchParticipantDto {
  puuid: string;
  teamId: number;
  championId: number;
  teamPosition: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  champLevel: number;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  item6: number;
  physicalDamageDealtToChampions: number;
  magicDamageDealtToChampions: number;
  trueDamageDealtToChampions: number;
  totalDamageTaken: number;
  perks: { styles: Array<{ style: number; selections: Array<{ perk: number }> }> };
}

export interface MatchDto {
  metadata: { matchId: string; participants: string[] };
  info: {
    gameCreation: number;
    gameDuration: number;
    gameVersion: string;
    queueId: number;
    platformId: string;
    participants: MatchParticipantDto[];
    teams: Array<{ teamId: number; win: boolean; bans?: Array<{ championId: number; pickTurn: number }> }>;
  };
}

/** Thin, rate-limited Riot API client covering what the ingest needs. */
export class RiotClient {
  private limiter: RateLimiter;
  private fetchImpl: typeof fetch;
  private maxRetries: number;

  private opts: RiotClientOptions;

  constructor(opts: RiotClientOptions) {
    this.opts = opts;
    this.limiter = new RateLimiter([
      { limit: opts.perSecond ?? 20, periodMs: 1000 },
      { limit: opts.per2Min ?? 100, periodMs: 120_000 },
    ]);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 5;
  }

  private async get<T>(host: string, path: string): Promise<T> {
    const url = `https://${host}.api.riotgames.com${path}`;
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire();
      const res = await this.fetchImpl(url, { headers: { "X-Riot-Token": this.opts.apiKey } });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "1");
        this.limiter.penalise(retryAfter * 1000);
        if (attempt < this.maxRetries) continue;
      } else if (res.status >= 500 && attempt < this.maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      throw new RiotApiError(res.status, url);
    }
  }

  /** League-EXP-V4: paged entries for a tier/division (seed players). */
  leagueEntries(platform: Platform, tier: Tier, division: "I" | "II" | "III" | "IV", page = 1) {
    return this.get<LeagueEntry[]>(
      platform,
      `/lol/league-exp/v4/entries/RANKED_SOLO_5x5/${tier}/${division}?page=${page}`,
    );
  }

  /** League-V4: ranked entries of a player (used to fill tier for snowballed seeds). */
  leagueByPuuid(platform: Platform, puuid: string) {
    return this.get<Array<LeagueEntry & { queueType: string }>>(platform, `/lol/league/v4/entries/by-puuid/${puuid}`);
  }

  /** Match-V5: match ids for a puuid. */
  matchIds(region: Region, puuid: string, queue: number, count = 20, start = 0, startTime?: number) {
    const q = new URLSearchParams({ queue: String(queue), count: String(count), start: String(start) });
    if (startTime) q.set("startTime", String(startTime));
    return this.get<string[]>(region, `/lol/match/v5/matches/by-puuid/${puuid}/ids?${q}`);
  }

  match(region: Region, matchId: string) {
    return this.get<MatchDto>(region, `/lol/match/v5/matches/${matchId}`);
  }

  regionOf(platform: Platform): Region {
    return PLATFORM_TO_REGION[platform];
  }
}
