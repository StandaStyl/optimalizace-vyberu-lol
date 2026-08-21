import type pg from "pg";
import { champions, latestVersion, patchOf } from "@da/core";

/** Upserts the current patch and its champion list from Data Dragon. */
export async function ddragonSync(pool: pg.Pool, fetchImpl: typeof fetch = fetch, log = console.log) {
  const version = await latestVersion(fetchImpl);
  const patch = patchOf(version);
  const list = await champions(version, fetchImpl);

  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(
      `insert into patch(patch, ddragon_ver) values ($1,$2)
       on conflict (patch) do update set ddragon_ver = excluded.ddragon_ver`,
      [patch, version],
    );
    for (const ch of list) {
      await c.query(
        `insert into champion(champion_id, key, name, tags, updated_at) values ($1,$2,$3,$4,now())
         on conflict (champion_id) do update set key=excluded.key, name=excluded.name, tags=excluded.tags, updated_at=now()`,
        [ch.id, ch.key, ch.name, ch.tags],
      );
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
  log(`ddragon: patch ${patch} (${version}), ${list.length} champions`);
  return { patch, version, champions: list.length };
}
