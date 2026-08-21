import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getPool, loadConfig, migrate } from "@da/core";
import { ddragonSync } from "./ddragonSync.ts";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "../../../infra/migrations");

async function main(argv: string[]) {
  const cmd = argv[0];
  const cfg = loadConfig();

  if (cmd === "migrate" || cmd === "ddragon-sync") {
    if (!cfg.DATABASE_URL) throw new Error("DATABASE_URL is not set (see .env.example)");
    const pool = getPool(cfg.DATABASE_URL);
    try {
      if (cmd === "migrate") {
        const applied = await migrate(pool, MIGRATIONS_DIR);
        console.log(applied.length ? `applied ${applied.length} migration(s)` : "schema up to date");
      } else {
        await ddragonSync(pool);
      }
    } finally {
      await pool.end();
    }
    return;
  }

  console.error(`usage: cli.ts <migrate|ddragon-sync>`);
  process.exit(2);
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e);
  process.exit(1);
});
