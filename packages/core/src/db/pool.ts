import pg from "pg";

let pool: pg.Pool | undefined;

export function getPool(connectionString: string): pg.Pool {
  pool ??= new pg.Pool({
    connectionString,
    max: 8,
    ssl: connectionString.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}
