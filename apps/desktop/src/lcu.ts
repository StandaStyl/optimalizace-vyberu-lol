import { readFile } from "node:fs/promises";
import { request } from "node:https";
import type { LcuSession } from "./session.ts";

export interface LcuCredentials {
  port: number;
  password: string;
  protocol: string;
}

/** Where the League client writes its lockfile. Override with LCU_LOCKFILE. */
export const DEFAULT_LOCKFILE_PATHS = [
  "C:/Riot Games/League of Legends/lockfile",
  "D:/Riot Games/League of Legends/lockfile",
  "/Applications/League of Legends.app/Contents/LoL/lockfile",
];

/** lockfile format: name:pid:port:password:protocol */
export function parseLockfile(text: string): LcuCredentials {
  const parts = text.trim().split(":");
  if (parts.length < 5) throw new Error("lockfile has unexpected format");
  const port = Number(parts[2]);
  if (!Number.isInteger(port) || port <= 0) throw new Error("lockfile has no valid port");
  return { port, password: parts[3]!, protocol: parts[4]! };
}

export async function readCredentials(paths: string[] = DEFAULT_LOCKFILE_PATHS): Promise<LcuCredentials | null> {
  const candidates = process.env.LCU_LOCKFILE ? [process.env.LCU_LOCKFILE, ...paths] : paths;
  for (const p of candidates) {
    try {
      return parseLockfile(await readFile(p, "utf8"));
    } catch {
      /* not this one */
    }
  }
  return null;
}

/**
 * GET from the League client. The client serves HTTPS with a self-signed certificate on
 * 127.0.0.1, so certificate verification is disabled for this connection only — nothing
 * else in the app uses this helper.
 */
export function lcuGet<T>(cred: LcuCredentials, path: string): Promise<{ status: number; body: T | null }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: cred.port,
        path,
        method: "GET",
        rejectUnauthorized: false,
        headers: { authorization: "Basic " + Buffer.from(`riot:${cred.password}`).toString("base64") },
        timeout: 5000,
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) return resolve({ status, body: null });
          try {
            resolve({ status, body: JSON.parse(data) as T });
          } catch {
            resolve({ status, body: null });
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("LCU request timed out")));
    req.on("error", reject);
    req.end();
  });
}

/** null = not in champion select right now. */
export async function getChampSelect(cred: LcuCredentials): Promise<LcuSession | null> {
  const r = await lcuGet<LcuSession>(cred, "/lol-champ-select/v1/session");
  return r.status === 200 ? r.body : null;
}
