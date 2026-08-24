import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getPool, loadConfig, migrate, RiotClient } from "@da/core";
import { ddragonSync } from "./ddragonSync.ts";
import { seedPlayers } from "./seed.ts";
import { crawl } from "./crawler.ts";
import { lookupTiers } from "./lookupTiers.ts";
import { prospectiveSummary, resolveLogs } from "./resolveLogs.ts";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "../../../infra/migrations");

const USAGE = `usage: cli.ts <command> [options]
  migrate                 apply infra/migrations
  ddragon-sync            upsert current patch + champions from Data Dragon
  seed [--pages N]        fill seed_player from the ranked ladder (default 2 pages per tier)
  crawl [--max N]         crawl matches into the DB (default: until exhausted)
  tiers [--limit N]       fill tier for snowballed players
  bands                   infer a tier band for each match from its known participants
  resolve-logs            link logged recommendations to the game that followed
  stats                   print row counts`;

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]) {
  const cmd = argv[0];
  const cfg = loadConfig();
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(USAGE);
    return;
  }
  if (!cfg.DATABASE_URL) throw new Error("DATABASE_URL is not set (see .env.example)");
  const pool = getPool(cfg.DATABASE_URL);
  const riot = () => {
    if (!cfg.RIOT_API_KEY) throw new Error("RIOT_API_KEY is not set");
    return new RiotClient({ apiKey: cfg.RIOT_API_KEY, perSecond: cfg.RIOT_RATE_PER_SECOND, per2Min: cfg.RIOT_RATE_PER_2MIN });
  };

  try {
    switch (cmd) {
      case "migrate": {
        const applied = await migrate(pool, MIGRATIONS_DIR);
        console.log(applied.length ? `applied ${applied.length} migration(s)` : "schema up to date");
        break;
      }
      case "ddragon-sync":
        await ddragonSync(pool);
        break;
      case "seed": {
        const n = await seedPlayers(pool, riot(), { platforms: cfg.platforms, pagesPerTier: Number(arg(argv, "--pages") ?? 2) });
        console.log(`seeded ${n} players`);
        break;
      }
      case "crawl": {
        const max = arg(argv, "--max");
        const r = await crawl(pool, riot(), { platforms: cfg.platforms, queueId: cfg.QUEUE_ID, ...(max ? { maxMatches: Number(max) } : {}) });
        console.log(`crawl done: stored ${r.stored}, failed ${r.failed}`);
        break;
      }
      case "tiers":
        await lookupTiers(pool, riot(), cfg.platforms, Number(arg(argv, "--limit") ?? 200));
        break;
      case "bands": {
        const r = await pool.query<{ n: number }>(`select infer_match_bands() as n`);
        const dist = await pool.query(`select tier_band, count(*)::int n from match group by 1 order by 2 desc`);
        console.log(`matches updated: ${r.rows[0]!.n}`);
        console.table(dist.rows);
        break;
      }
      case "resolve-logs": {
        await resolveLogs(pool);
        const s = await prospectiveSummary(pool);
        console.table([s.totals]);
        if (s.byClass.length) console.table(s.byClass);
        break;
      }
      case "stats": {
        const q = await pool.query(`
          select (select count(*) from seed_player) seeds,
                 (select count(*) from seed_player where tier_band is null) seeds_unknown_tier,
                 (select count(*) from match_queue where state='pending') queue_pending,
                 (select count(*) from match) matches,
                 (select count(*) from participant) participants,
                 (select string_agg(patch || ':' || n, ', ') from (select patch, count(*) n from match group by patch order by patch) p) by_patch`);
        console.table(q.rows);
        break;
      }
      default:
        console.error(USAGE);
        process.exit(2);
    }
  } finally {
    await pool.end();
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
