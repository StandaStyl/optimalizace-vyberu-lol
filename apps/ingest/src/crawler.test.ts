import { describe, it, expect } from "vitest";
import type pg from "pg";
import type { MatchDto, MatchParticipantDto } from "@da/core";
import { storeMatch } from "./crawler.ts";

const POS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

function participant(i: number, teamId: number, win: boolean): MatchParticipantDto {
  return {
    puuid: `p${i}`, teamId, championId: 100 + i, teamPosition: POS[i % 5]!, win,
    kills: 1, deaths: 2, assists: 3, champLevel: 15,
    item0: 1, item1: 2, item2: 3, item3: 4, item4: 5, item5: 6, item6: 7,
    physicalDamageDealtToChampions: 100, magicDamageDealtToChampions: 200, trueDamageDealtToChampions: 10, totalDamageTaken: 500,
    perks: { styles: [{ style: 8000, selections: [{ perk: 8005 }] }, { style: 8100, selections: [] }] },
  };
}

function match(over: Partial<MatchDto["info"]> = {}): MatchDto {
  const participants = Array.from({ length: 10 }, (_, i) => participant(i, i < 5 ? 100 : 200, i < 5));
  return {
    metadata: { matchId: "EUN1_1", participants: participants.map((p) => p.puuid) },
    info: { gameCreation: 1_700_000_000_000, gameDuration: 1800, gameVersion: "16.16.707.1", queueId: 420, platformId: "EUN1",
      participants, teams: [{ teamId: 100, win: true, bans: [{ championId: 99, pickTurn: 1 }, { championId: -1, pickTurn: 2 }] }, { teamId: 200, win: false, bans: [{ championId: 55, pickTurn: 6 }] }], ...over },
  };
}

/** Records executed SQL; enough to assert what storeMatch writes. */
function fakePool() {
  const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; },
    release: () => {},
  };
  return { pool: { connect: async () => client } as unknown as pg.Pool, calls };
}

describe("storeMatch", () => {
  it("stores match, 10 participants and snowballs seeds", async () => {
    const { pool, calls } = fakePool();
    expect(await storeMatch(pool, match(), "eun1", 420)).toBe(true);
    const sqls = calls.map((c) => c.sql);
    expect(sqls[0]).toBe("begin");
    expect(sqls.filter((s) => s.includes("insert into participant")).length).toBe(10);
    expect(sqls.some((s) => s.includes("insert into seed_player"))).toBe(true);
    expect(sqls.filter((s) => s.includes("insert into match_ban")).length).toBe(2); // -1 skipped
    expect(sqls.at(-1)).toBe("commit");
    const m = calls.find((c) => c.sql.includes("insert into match("))!;
    expect(m.params![2]).toBe("16.16");
    expect(m.params![7]).toBe(100);
    const p = calls.find((c) => c.sql.includes("insert into participant"))!;
    expect(p.params![4]).toBe("TOP");
    expect(p.params![12]).toBe(8005); // keystone
  });

  it("skips remakes, wrong queue and missing positions", async () => {
    const { pool, calls } = fakePool();
    expect(await storeMatch(pool, match({ gameDuration: 300 }), "eun1", 420)).toBe(false);
    expect(await storeMatch(pool, match({ queueId: 440 }), "eun1", 420)).toBe(false);
    const m = match();
    m.info.participants[3]!.teamPosition = "";
    expect(await storeMatch(pool, m, "eun1", 420)).toBe(false);
    expect(calls.length).toBe(0);
  });
});
