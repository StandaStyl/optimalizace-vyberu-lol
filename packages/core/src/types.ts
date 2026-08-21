/** Platform routing values (League-V4, Summoner-V4). */
export type Platform = "eun1" | "euw1" | "na1" | "kr";
/** Regional routing values (Match-V5, Account-V1). */
export type Region = "europe" | "americas" | "asia";

export const PLATFORM_TO_REGION: Record<Platform, Region> = {
  eun1: "europe",
  euw1: "europe",
  na1: "americas",
  kr: "asia",
};

export type Position = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";
export const POSITIONS: readonly Position[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

export type Tier =
  | "IRON" | "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "EMERALD"
  | "DIAMOND" | "MASTER" | "GRANDMASTER" | "CHALLENGER";

/** Three bands used for separate model estimation (replaces the thesis' linear "w" by division). */
export type TierBand = "low" | "mid" | "high";
export function tierBand(t: Tier): TierBand {
  if (t === "IRON" || t === "BRONZE" || t === "SILVER" || t === "GOLD") return "low";
  if (t === "PLATINUM" || t === "EMERALD") return "mid";
  return "high";
}

export const RANKED_SOLO_QUEUE = 420;

/** Minimal slice of a Match-V5 participant we persist (no PII beyond puuid). */
export interface ParticipantRow {
  matchId: string;
  puuid: string;
  teamId: 100 | 200;
  championId: number;
  position: Position | "";
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  items: number[];
  primaryStyle: number;
  subStyle: number;
  keystone: number;
  champLevel: number;
  physicalDamage: number;
  magicDamage: number;
  trueDamage: number;
  damageTaken: number;
}

export interface MatchRow {
  matchId: string;
  platform: Platform;
  /** e.g. "16.16" */
  patch: string;
  gameVersion: string;
  queueId: number;
  gameStart: Date;
  durationSec: number;
  winnerTeam: 100 | 200;
}
