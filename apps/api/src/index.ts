import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getPool, loadConfig } from "@da/core";
import { createApi } from "./server.ts";

export const API_VERSION = "0.1.0";

const cfg = loadConfig();
if (!cfg.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const api = createApi({ pool: getPool(cfg.DATABASE_URL), platforms: cfg.platforms, staticDir: resolve(here, "../../web/public") });
api.warm().then((c) => console.log(`aggregates loaded: patch ${c.patch}`), (e) => console.error("warm-up failed:", e.message));
api.server.listen(port, () => console.log(`draft-advisor api on http://localhost:${port}`));
