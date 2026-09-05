import type pg from "pg";
import { fetchChampionAttributes } from "@da/core";

/**
 * SPEC-08: upserts champion attributes from the LoL wiki into champion_attr.
 * Champions in our table that the wiki does not know (or vice versa) are reported, not guessed.
 */
export async function syncAttributes(pool: pg.Pool, fetchImpl: typeof fetch = fetch, log = console.log) {
  const { attributes, dash, blink } = await fetchChampionAttributes(fetchImpl);
  const known = new Map((await pool.query<{ champion_id: number; name: string }>(`select champion_id, name from champion`)).rows.map((r) => [r.champion_id, r.name]));
  const wikiIds = new Set(attributes.map((a) => a.id));
  const missing = [...known].filter(([id]) => !wikiIds.has(id)).map(([, n]) => n);
  const extra = attributes.filter((a) => !known.has(a.id)).map((a) => a.name);

  const c = await pool.connect();
  let rows = 0;
  try {
    await c.query("begin");
    for (const a of attributes) {
      if (!known.has(a.id)) continue;
      for (const [dim, value] of Object.entries(a.attrs)) {
        const source = dim === "mobility" ? "wiki:Dash+Blink" : dim === "toughness" || dim === "mobility_rating" ? "riot-rating via wiki" : "wiki:ChampionData";
        await c.query(
          `insert into champion_attr(champion_id, dim, value, source, updated_at) values ($1,$2,$3,$4,now())
           on conflict (champion_id, dim) do update set value = excluded.value, source = excluded.source, updated_at = now()`,
          [a.id, dim, value, source]);
        rows++;
      }
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
  log(`attrs: ${rows} rows for ${attributes.filter((a) => known.has(a.id)).length} champions (dash ${dash}, blink ${blink})`);
  if (missing.length) log(`attrs: not on wiki: ${missing.join(", ")}`);
  if (extra.length) log(`attrs: on wiki but not in champion table: ${extra.join(", ")}`);
  return { rows, missing, extra };
}
