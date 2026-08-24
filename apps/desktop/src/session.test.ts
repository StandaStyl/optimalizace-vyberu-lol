import { describe, it, expect } from "vitest";
import { parseLockfile } from "./lcu.ts";
import { snapshotKey, toDraftSnapshot, toPosition, type LcuSession } from "./session.ts";

describe("parseLockfile", () => {
  it("reads port, password and protocol", () => {
    expect(parseLockfile("LeagueClient:12345:52000:abcdef:https\n")).toEqual({ port: 52000, password: "abcdef", protocol: "https" });
  });
  it("rejects garbage", () => {
    expect(() => parseLockfile("nope")).toThrow();
    expect(() => parseLockfile("a:b:notaport:d:e")).toThrow();
  });
});

it("toPosition maps client spelling", () => {
  expect(toPosition("middle")).toBe("MIDDLE");
  expect(toPosition("UTILITY")).toBe("UTILITY");
  expect(toPosition("")).toBeNull();
  expect(toPosition(undefined)).toBeNull();
});

/** Mid-draft: we are cell 0 (bot), one ally and two enemies locked, one ally still hovering. */
const session: LcuSession = {
  localPlayerCellId: 0,
  myTeam: [
    { cellId: 0, championId: 0, assignedPosition: "bottom", puuid: "p".repeat(78) },
    { cellId: 1, championId: 412, assignedPosition: "utility" },
    { cellId: 2, championId: 0, championPickIntent: 64, assignedPosition: "jungle" },
  ],
  theirTeam: [
    { cellId: 5, championId: 51 },
    { cellId: 6, championId: 0 },
  ],
  actions: [
    [{ actorCellId: 0, championId: 99, completed: true, type: "ban", isAllyAction: true }],
    [{ actorCellId: 5, championId: 55, completed: true, type: "ban", isAllyAction: false }],
    [{ actorCellId: 1, championId: 412, completed: true, type: "pick", isAllyAction: true }],
    [{ actorCellId: 5, championId: 51, completed: true, type: "pick", isAllyAction: false }],
    [{ actorCellId: 6, championId: 238, completed: false, type: "pick", isAllyAction: false }],
    [{ actorCellId: 0, championId: 0, completed: false, type: "pick", isAllyAction: true }],
  ],
  bans: { myTeamBans: [99], theirTeamBans: [55] },
};

describe("toDraftSnapshot", () => {
  const d = toDraftSnapshot(session);

  it("reads our position and puuid", () => {
    expect(d.myPos).toBe("BOTTOM");
    expect(d.myPuuid).toHaveLength(78);
    expect(d.myPickLocked).toBe(false);
    expect(d.myChampion).toBeNull();
  });

  it("takes locked allies with positions, ignores hovering", () => {
    expect(d.allies).toEqual([{ champ: 412, pos: "UTILITY" }]);
  });

  it("takes locked enemies without positions and ignores an incomplete enemy pick", () => {
    expect(d.enemies).toEqual([{ champ: 51 }]);
  });

  it("collects bans from both the bans object and completed ban actions", () => {
    expect(d.bans.sort((a, b) => a - b)).toEqual([55, 99]);
  });

  it("detects our own lock", () => {
    const locked: LcuSession = { ...session, actions: [...(session.actions ?? []), [{ actorCellId: 0, championId: 22, completed: true, type: "pick", isAllyAction: true }]] };
    const l = toDraftSnapshot(locked);
    expect(l.myPickLocked).toBe(true);
    expect(l.myChampion).toBe(22);
  });

  it("snapshotKey changes only on meaningful change", () => {
    const same = toDraftSnapshot(JSON.parse(JSON.stringify(session)) as LcuSession);
    expect(snapshotKey(same)).toBe(snapshotKey(d));
    const moved: LcuSession = { ...session, theirTeam: [{ cellId: 5, championId: 51 }, { cellId: 6, championId: 238 }] };
    expect(snapshotKey(toDraftSnapshot(moved))).not.toBe(snapshotKey(d));
  });

  it("survives an empty session", () => {
    const empty = toDraftSnapshot({ localPlayerCellId: 0 });
    expect(empty).toMatchObject({ myPos: null, allies: [], enemies: [], bans: [], myPickLocked: false });
  });
});
