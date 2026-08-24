/**
 * Draft Advisor — League client connector (SPEC-04).
 *
 * Polls the local League client for the champion-select session, sends the draft to the
 * Draft Advisor API and prints the recommendations. It only READS the client: no picking,
 * no banning, no chat — required by the Riot Developer Policies.
 *
 * Run: node --experimental-strip-types apps/desktop/src/index.ts
 * Env: API_URL (default http://localhost:8787), LCU_LOCKFILE, POLL_MS (default 1000)
 */
import { getChampSelect, readCredentials, type LcuCredentials } from "./lcu.ts";
import { snapshotKey, toDraftSnapshot, type DraftSnapshot } from "./session.ts";

const API = process.env.API_URL ?? "http://localhost:8787";
const POLL_MS = Number(process.env.POLL_MS ?? 1000);
const BAND = process.env.BAND ?? "all";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ScoreResponse {
  patch: string;
  band: string;
  candidates: number;
  logId?: number;
  recommendations: Array<{ champ: number; name: string; class: number; p: number; lo: number; hi: number; threats?: Array<{ name: string; pos: string; logOdds: number }> }>;
  bans?: Array<{ name: string; expectedLoss: number; pPick: number }>;
  error?: string;
}

async function fetchScore(d: DraftSnapshot): Promise<ScoreResponse | null> {
  if (!d.myPos) return null;
  const res = await fetch(`${API}/api/score`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      myPos: d.myPos, allies: d.allies, enemies: d.enemies, bans: d.bans, band: BAND, top: 8,
      ...(d.myPuuid ? { myPuuid: d.myPuuid, log: true, source: "lcu" } : {}),
    }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json()) as ScoreResponse;
}

async function reportChosen(logId: number, champ: number) {
  await fetch(`${API}/api/recommendation/chosen`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ logId, champ }),
  }).catch(() => undefined);
}

function render(d: DraftSnapshot, s: ScoreResponse) {
  const pct = (v: number) => (v * 100).toFixed(1);
  console.log("\n" + "─".repeat(72));
  console.log(`Pozice ${d.myPos} · patch ${s.patch} · pásmo ${s.band} · ${s.candidates} kandidátů`);
  if (d.enemies.length) console.log(`Soupeř vybral: ${d.enemies.length} šampionů · banů ${d.bans.length}`);
  for (const [i, r] of s.recommendations.entries()) {
    const threats = (r.threats ?? []).slice(0, 2).map((t) => `${t.name} ${t.logOdds.toFixed(2)}`).join(", ");
    console.log(`${String(i + 1).padStart(2)}. [tř.${r.class}] ${r.name.padEnd(14)} ${pct(r.p)} %  (${pct(r.lo)}–${pct(r.hi)})${threats ? "   hrozby: " + threats : ""}`);
  }
  if (s.bans?.length) console.log(`Bany: ${s.bans.slice(0, 3).map((b) => `${b.name} (${(b.expectedLoss * 100).toFixed(1)})`).join(" · ")}`);
}

type Say = (msg: string) => void;

async function watch(cred: LcuCredentials, say: Say) {
  let lastKey = "";
  let lastLogId: number | undefined;
  let reported = false;
  let inSelect = false;

  for (;;) {
    let session = null;
    try {
      session = await getChampSelect(cred);
    } catch {
      say("Klient se odpojil, čekám…");
      return;
    }

    if (!session) {
      if (inSelect) { say("Champion select skončil."); inSelect = false; lastKey = ""; lastLogId = undefined; reported = false; }
      await sleep(POLL_MS);
      continue;
    }
    if (!inSelect) { console.log("Champion select začal."); inSelect = true; }

    const d = toDraftSnapshot(session);
    const key = snapshotKey(d);

    if (d.myPickLocked && d.myChampion && lastLogId !== undefined && !reported) {
      await reportChosen(lastLogId, d.myChampion);
      reported = true;
      console.log(`Zvoleno: ${d.myChampion} — zaznamenáno pro kontrolu reality.`);
    }

    if (key !== lastKey && !d.myPickLocked) {
      lastKey = key;
      const s = await fetchScore(d);
      if (s && !s.error) {
        if (s.logId !== undefined) lastLogId = s.logId;
        render(d, s);
      } else if (!d.myPos) {
        say("Čekám na přidělení pozice…");
      }
    }
    await sleep(POLL_MS);
  }
}

async function main() {
  console.log(`Draft Advisor — konektor herního klienta (API ${API})`);
  const health = await fetch(`${API}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health) console.log(`Varování: API na ${API} neodpovídá. Spusť "npm run api".`);

  // Repeated identical status lines would drown the recommendations, so each is printed once.
  let lastMsg = "";
  const say: Say = (m) => { if (m !== lastMsg) { console.log(m); lastMsg = m; } };

  for (;;) {
    const cred = await readCredentials();
    if (!cred) {
      say("Herní klient neběží (lockfile nenalezen). Zkouším dál… (cestu lze určit v LCU_LOCKFILE)");
      await sleep(5000);
      continue;
    }
    // A lockfile left behind by a closed client points at a port nobody listens on.
    try {
      await getChampSelect(cred);
    } catch {
      say(`Lockfile ukazuje na port ${cred.port}, ale klient neodpovídá — nejspíš zastaralý lockfile. Zkouším dál…`);
      await sleep(5000);
      continue;
    }
    say(`Připojeno ke klientu na portu ${cred.port}. Čekám na champion select…`);
    await watch(cred, say);
    await sleep(2000);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
