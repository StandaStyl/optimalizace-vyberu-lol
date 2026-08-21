import { z } from "zod";
import "dotenv/config";
import type { Platform } from "./types.ts";

const schema = z.object({
  RIOT_API_KEY: z.string().min(10).optional(),
  REGIONS: z.string().default("eun1,euw1"),
  QUEUE_ID: z.coerce.number().default(420),
  DATABASE_URL: z.string().optional(),
  /** Optional: raw DB password; injected URL-encoded into DATABASE_URL so special characters need no escaping. */
  DB_PASSWORD: z.string().optional(),
  RIOT_RATE_PER_SECOND: z.coerce.number().default(20),
  RIOT_RATE_PER_2MIN: z.coerce.number().default(100),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = schema.parse(env);
  const platforms = c.REGIONS.split(",").map((s) => s.trim()) as Platform[];
  let DATABASE_URL = c.DATABASE_URL;
  if (DATABASE_URL && c.DB_PASSWORD) {
    const u = new URL(DATABASE_URL);
    u.password = encodeURIComponent(c.DB_PASSWORD);
    DATABASE_URL = u.toString();
  }
  return { ...c, DATABASE_URL, platforms };
}
