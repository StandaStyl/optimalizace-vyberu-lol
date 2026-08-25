import type pg from "pg";

/**
 * Data retention. Measured 2026-08-24: 21 640 matches ≈ 216 MB, i.e. roughly 10 kB per match,
 * so the Supabase free tier (500 MB) holds on the order of 50 000 matches — about one patch
 * at full crawl. Old patches have to go, or the plan has to.
 *
 * Deleting is destructive, so nothing happens without `apply: true`; the dry run reports
 * exactly what would go.
 */

export interface PrunePlan {
  patches: Array<{ patch: string; matches: number }>;
  queueRows: number;
  sizeBefore: string;
}

export async function planPrune(pool: pg.Pool, keepPatches: number, queueOlderThanDays: number): Promise<PrunePlan> {
  const all = (await pool.query<{ patch: string; matches: string; last: Date }>(
    `select patch, count(*)::text matches, max(game_start) last from match group by 1 order by max(game_start) desc`)).rows;
  const doomed = all.slice(keepPatches).map((r) => ({ patch: r.patch, matches: Number(r.matches) }));
  const queue = (await pool.query<{ n: string }>(
    `select count(*)::text n from match_queue where state in ('done','failed') and enqueued_at < now() - ($1 || ' days')::interval`,
    [String(queueOlderThanDays)])).rows[0]!.n;
  const size = (await pool.query<{ size: string }>(`select pg_size_pretty(pg_database_size(current_database())) size`)).rows[0]!.size;
  return { patches: doomed, queueRows: Number(queue), sizeBefore: size };
}

export async function prune(
  pool: pg.Pool,
  opts: { keepPatches?: number; queueOlderThanDays?: number; apply?: boolean; log?: (s: string) => void } = {},
): Promise<PrunePlan> {
  const keep = opts.keepPatches ?? 1;
  const queueDays = opts.queueOlderThanDays ?? 7;
  const log = opts.log ?? console.log;
  const plan = await planPrune(pool, keep, queueDays);

  log(`databáze má ${plan.sizeBefore}; ponechávám ${keep} nejnovější patch(e)`);
  if (!plan.patches.length && !plan.queueRows) { log("není co mazat"); return plan; }
  for (const p of plan.patches) log(`  patch ${p.patch}: ${p.matches} zápasů (a jejich účastníci i bany)`);
  if (plan.queueRows) log(`  fronta: ${plan.queueRows} vyřízených položek starších než ${queueDays} dní`);

  if (!opts.apply) { log("ZKUŠEBNÍ BĚH — nic nesmazáno; spusť s --yes"); return plan; }

  for (const p of plan.patches) {
    // participant and match_ban hang off match with ON DELETE CASCADE.
    const r = await pool.query(`delete from match where patch = $1`, [p.patch]);
    log(`smazán patch ${p.patch}: ${r.rowCount} zápasů`);
  }
  if (plan.queueRows) {
    const r = await pool.query(
      `delete from match_queue where state in ('done','failed') and enqueued_at < now() - ($1 || ' days')::interval`,
      [String(queueDays)]);
    log(`smazáno ${r.rowCount} položek fronty`);
  }
  // Space is only returned to the OS after a full vacuum; without it the file stays as large.
  log("uvolňuji místo (vacuum full participant, match)…");
  await pool.query(`vacuum full participant`);
  await pool.query(`vacuum full match`);
  const after = (await pool.query<{ size: string }>(`select pg_size_pretty(pg_database_size(current_database())) size`)).rows[0]!.size;
  log(`hotovo: ${plan.sizeBefore} → ${after}`);
  return plan;
}
