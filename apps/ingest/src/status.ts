import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import type { Config } from "@da/core";

/**
 * One command that answers "is everything actually running?".
 *
 * Detached background processes on Windows have died silently more than once, and a plain
 * latency probe hides a refused connection, so every check here reports what it actually saw.
 */

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function pidAlive(repoRoot: string, name: string): Promise<Check> {
  let pid: number;
  try {
    pid = Number((await readFile(join(repoRoot, "data", `${name}.pid`), "utf8")).trim());
  } catch {
    return { name, ok: false, detail: "žádný PID soubor — proces nikdy neběžel z tohoto repa" };
  }
  if (!Number.isInteger(pid) || pid <= 0) return { name, ok: false, detail: "PID soubor je poškozený" };
  try {
    process.kill(pid, 0); // signal 0 = existence check only
    return { name, ok: true, detail: `běží (PID ${pid})` };
  } catch {
    return { name, ok: false, detail: `PID ${pid} neběží — proces skončil` };
  }
}

async function apiCheck(port: number): Promise<Check> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5000) });
    const body = (await res.json()) as { ok?: boolean; patch?: string };
    return { name: "api", ok: res.ok, detail: res.ok ? `HTTP 200, patch ${body.patch ?? "?"}` : `HTTP ${res.status}` };
  } catch (e) {
    return { name: "api", ok: false, detail: `neodpovídá na portu ${port} (${e instanceof Error ? e.message : e})` };
  }
}

async function riotKeyCheck(key: string | undefined): Promise<Check> {
  if (!key) return { name: "riot key", ok: false, detail: "RIOT_API_KEY není v .env" };
  try {
    const res = await fetch("https://eun1.api.riotgames.com/lol/status/v4/platform-data", {
      headers: { "X-Riot-Token": key }, signal: AbortSignal.timeout(8000),
    });
    if (res.status === 200) return { name: "riot key", ok: true, detail: "platný (HTTP 200)" };
    if (res.status === 401 || res.status === 403) return { name: "riot key", ok: false, detail: `HTTP ${res.status} — expirovaný, vygeneruj nový na developer.riotgames.com` };
    return { name: "riot key", ok: false, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { name: "riot key", ok: false, detail: `nedostupné (${e instanceof Error ? e.message : e})` };
  }
}

async function dbCheck(pool: pg.Pool): Promise<Check[]> {
  const out: Check[] = [];
  try {
    const r = (await pool.query<{ matches: string; participants: string; pending: string; last: Date | null; size: string }>(`
      select (select count(*) from match)::text matches,
             (select count(*) from participant)::text participants,
             (select count(*) from match_queue where state = 'pending')::text pending,
             (select max(ingested_at) from match) last,
             pg_size_pretty(pg_database_size(current_database())) size`)).rows[0]!;
    out.push({ name: "databáze", ok: true, detail: `${r.matches} zápasů, ${r.participants} účastníků, ${r.size}` });
    const mins = r.last ? (Date.now() - r.last.getTime()) / 60000 : Infinity;
    out.push({
      name: "crawl postup",
      ok: mins < 15,
      detail: r.last ? `poslední zápas před ${mins.toFixed(0)} min, ve frontě ${r.pending}` : "zatím žádná data",
    });
  } catch (e) {
    out.push({ name: "databáze", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

export async function status(pool: pg.Pool, cfg: Config, repoRoot: string, port = Number(process.env.PORT ?? 8787)): Promise<Check[]> {
  const checks: Check[] = [];
  checks.push(await apiCheck(port));
  checks.push(await pidAlive(repoRoot, "api"));
  checks.push(await pidAlive(repoRoot, "crawl"));
  checks.push(await riotKeyCheck(cfg.RIOT_API_KEY));
  checks.push(...(await dbCheck(pool)));
  return checks;
}
