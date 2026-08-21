import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";

/** Applies infra/migrations/*.sql in lexical order, tracked in schema_migrations. */
export async function migrate(
  pool: pg.Pool,
  dir: string,
  log: (s: string) => void = console.log,
): Promise<string[]> {
  await pool.query(
    `create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())`,
  );
  const done = new Set(
    (await pool.query<{ name: string }>(`select name from schema_migrations`)).rows.map((r) => r.name),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(join(dir, f), "utf8");
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(sql);
      await c.query(`insert into schema_migrations(name) values ($1)`, [f]);
      await c.query("commit");
      applied.push(f);
      log(`applied ${f}`);
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  return applied;
}
