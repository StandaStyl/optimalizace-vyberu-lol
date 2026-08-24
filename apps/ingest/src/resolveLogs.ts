import type pg from "pg";

/**
 * SPEC-05 §2, second half: link logged recommendations to the game that followed.
 *
 * A log row is resolved when we later crawl a match where the same player played the
 * champion they locked, started after the recommendation was made. No Riot API calls —
 * this only reads what the crawler already stored, so a row stays open until that game
 * happens to be crawled (with a production key we could fetch it directly).
 */
export async function resolveLogs(pool: pg.Pool, maxAgeHours = 72, log = console.log): Promise<number> {
  const r = await pool.query(
    `update recommendation_log l
        set match_id = g.match_id, win = g.win
       from (
         select distinct on (l2.id) l2.id as log_id, p.match_id, p.win
           from recommendation_log l2
           join participant p on p.puuid = l2.puuid and p.champion_id = l2.chosen
           join match m on m.match_id = p.match_id
          where l2.match_id is null
            and l2.chosen is not null
            and m.game_start >= l2.created_at
            and m.game_start < l2.created_at + ($1 || ' hours')::interval
          order by l2.id, m.game_start
       ) g
      where l.id = g.log_id`,
    [String(maxAgeHours)],
  );
  const open = await pool.query<{ n: string }>(
    `select count(*)::text n from recommendation_log where match_id is null and chosen is not null`);
  log(`resolved ${r.rowCount ?? 0} recommendation(s); ${open.rows[0]!.n} still open`);
  return r.rowCount ?? 0;
}

/** Counts for the model page: how recommendations that were followed actually did. */
export async function prospectiveSummary(pool: pg.Pool) {
  const byClass = (await pool.query(
    `select (r->>'class')::int as cls, count(*)::int n, sum(case when l.win then 1 else 0 end)::int wins
       from recommendation_log l
       cross join lateral jsonb_array_elements(l.recommended) r
      where l.match_id is not null and (r->>'champ')::int = l.chosen
      group by 1 order by 1`)).rows;
  const totals = (await pool.query(
    `select count(*)::int logged,
            count(*) filter (where chosen is not null)::int with_choice,
            count(*) filter (where match_id is not null)::int resolved
       from recommendation_log`)).rows[0];
  return { totals, byClass };
}
