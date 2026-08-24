import { POSITIONS, type Position } from "@da/core";

/** The slice of /lol-champ-select/v1/session we care about. */
export interface LcuSession {
  localPlayerCellId: number;
  myTeam?: LcuPlayer[];
  theirTeam?: LcuPlayer[];
  actions?: LcuAction[][];
  bans?: { myTeamBans?: number[]; theirTeamBans?: number[] };
  timer?: { phase?: string };
}
export interface LcuPlayer {
  cellId: number;
  championId?: number;
  championPickIntent?: number;
  assignedPosition?: string;
  puuid?: string;
}
export interface LcuAction {
  actorCellId: number;
  championId: number;
  completed: boolean;
  type: string;
  isAllyAction?: boolean;
}

export interface DraftSnapshot {
  myPos: Position | null;
  myPuuid: string | undefined;
  /** Locked-in allies other than us, with the position the lobby assigned them. */
  allies: Array<{ champ: number; pos?: Position }>;
  /** Locked-in enemies; the client never tells us their positions, so those stay inferred. */
  enemies: Array<{ champ: number }>;
  bans: number[];
  /** True once our own pick action is completed — nothing left to advise. */
  myPickLocked: boolean;
  /** Champion we locked, if any. */
  myChampion: number | null;
}

/** "middle" / "UTILITY" / "" → Position | null */
export function toPosition(raw: string | undefined): Position | null {
  const p = (raw ?? "").toUpperCase();
  return (POSITIONS as readonly string[]).includes(p) ? (p as Position) : null;
}

/**
 * Pure translation of a champ-select session into what the scorer needs.
 * Kept free of I/O so it can be tested against recorded sessions.
 */
export function toDraftSnapshot(s: LcuSession): DraftSnapshot {
  const me = (s.myTeam ?? []).find((p) => p.cellId === s.localPlayerCellId);
  const actions = (s.actions ?? []).flat();

  const bans = new Set<number>();
  for (const b of [...(s.bans?.myTeamBans ?? []), ...(s.bans?.theirTeamBans ?? [])]) if (b > 0) bans.add(b);
  for (const a of actions) if (a.type === "ban" && a.completed && a.championId > 0) bans.add(a.championId);

  // A champion counts as picked only when the action is completed; hovering (pick intent) does not.
  const lockedBy = new Map<number, number>(); // cellId -> championId
  for (const a of actions) if (a.type === "pick" && a.completed && a.championId > 0) lockedBy.set(a.actorCellId, a.championId);

  const allies: DraftSnapshot["allies"] = [];
  for (const p of s.myTeam ?? []) {
    if (p.cellId === s.localPlayerCellId) continue;
    const champ = lockedBy.get(p.cellId) ?? (p.championId && p.championId > 0 ? p.championId : 0);
    if (!champ) continue;
    const pos = toPosition(p.assignedPosition);
    allies.push(pos ? { champ, pos } : { champ });
  }

  const enemies: DraftSnapshot["enemies"] = [];
  for (const p of s.theirTeam ?? []) {
    const champ = lockedBy.get(p.cellId) ?? (p.championId && p.championId > 0 ? p.championId : 0);
    if (champ) enemies.push({ champ });
  }

  const myChampion = me ? (lockedBy.get(me.cellId) ?? null) : null;
  return {
    myPos: toPosition(me?.assignedPosition),
    myPuuid: me?.puuid && me.puuid.length > 20 ? me.puuid : undefined,
    allies,
    enemies,
    bans: [...bans],
    myPickLocked: myChampion !== null,
    myChampion,
  };
}

/** Cheap value to detect "nothing changed" between polls. */
export function snapshotKey(d: DraftSnapshot): string {
  return [d.myPos, d.allies.map((a) => `${a.champ}:${a.pos ?? ""}`).join(","), d.enemies.map((e) => e.champ).join(","), d.bans.slice().sort((a, b) => a - b).join(","), d.myChampion].join("|");
}
