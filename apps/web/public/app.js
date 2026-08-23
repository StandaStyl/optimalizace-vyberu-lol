// Draft Advisor web UI — plain JS, no build step.
const POS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const POS_CS = { TOP: "Top", JUNGLE: "Jungle", MIDDLE: "Mid", BOTTOM: "Bot", UTILITY: "Supp" };
let champs = [];          // {id,name,key,positions}
let byName = new Map();
let ddragon = "";
const $ = (s) => document.querySelector(s);

const icon = (key) => (key && ddragon ? `https://ddragon.leagueoflegends.com/cdn/${ddragon}/img/champion/${key}.png` : "");

async function init() {
  const r = await fetch("/api/champions").then((x) => x.json());
  champs = r.champions.sort((a, b) => a.name.localeCompare(b.name));
  ddragon = r.ddragon;
  byName = new Map(champs.map((c) => [c.name.toLowerCase(), c]));
  $("#champList").innerHTML = champs.map((c) => `<option value="${c.name}">`).join("");
  $("#meta").textContent = `patch ${r.patch} · ${champs.length} šampionů`;
  buildSlots("#allies", 4, true);
  buildSlots("#enemies", 5, false);
  buildSlots("#bans", 10, null);
  document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("nav button, .tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); $("#tab-" + b.dataset.tab).classList.add("active");
    if (b.dataset.tab === "model") loadModel();
  }));
  ["#myPos", "#band", "#puuid"].forEach((s) => $(s).addEventListener("change", score));
  $("#loadPlayer").addEventListener("click", loadPlayer);
  score();
}

function buildSlots(sel, n, withPos) {
  const el = $(sel);
  el.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const row = document.createElement("div");
    row.className = "slot";
    row.innerHTML = `<img alt=""><input list="champList" placeholder="${withPos === null ? "ban" : "šampion"}">` +
      (withPos === null ? "" : `<select><option value="">${withPos ? "pozice" : "odhad"}</option>${POS.map((p) => `<option value="${p}">${POS_CS[p]}</option>`).join("")}</select>`);
    const input = row.querySelector("input");
    input.addEventListener("change", () => { const c = byName.get(input.value.trim().toLowerCase()); row.querySelector("img").src = c ? icon(c.key) : ""; score(); });
    row.querySelector("select")?.addEventListener("change", score);
    el.appendChild(row);
  }
}

function readSlots(sel) {
  return [...$(sel).querySelectorAll(".slot")].map((row) => {
    const c = byName.get(row.querySelector("input").value.trim().toLowerCase());
    if (!c) return null;
    const pos = row.querySelector("select")?.value || undefined;
    return { champ: c.id, pos };
  }).filter(Boolean);
}

let scoreTimer;
function score() { clearTimeout(scoreTimer); scoreTimer = setTimeout(doScore, 150); }
async function doScore() {
  const body = { myPos: $("#myPos").value, band: $("#band").value, allies: readSlots("#allies"), enemies: readSlots("#enemies"), bans: readSlots("#bans").map((s) => s.champ), top: 25 };
  const puuid = $("#puuid").value.trim(); if (puuid) body.myPuuid = puuid;
  const r = await fetch("/api/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
  if (r.error) { $("#resultMeta").textContent = r.error; return; }
  $("#resultMeta").textContent = `patch ${r.patch} · pásmo ${r.band} · ${r.candidates} kandidátů`;
  const ep = Object.entries(r.enemyPositions || {});
  $("#enemyPos").innerHTML = ep.length ? "Odhad pozic soupeřů: " + ep.map(([id, d]) => { const c = champs.find((x) => x.id === Number(id)); const best = Object.entries(d).sort((a, b) => b[1] - a[1])[0]; return `<b>${c?.name ?? id}</b> → ${POS_CS[best[0]]} (${Math.round(best[1] * 100)} %)`; }).join(" · ") : "";
  $("#banRecs").innerHTML = r.bans?.length ? "Doporučené bany (největší očekávaná ztráta pro naše top kandidáty): " + r.bans.slice(0, 5).map((b) => `<b>${b.name}</b> ${(b.expectedLoss * 100).toFixed(1)} (pick ${Math.round(b.pPick * 100)} %)`).join(" · ") : "";
  const KIND = { matchup: "vs", synergy: "+", player: "já", future_matchup: "⌛vs", future_synergy: "⌛+" };
  const min = Math.min(...r.recommendations.map((x) => x.lo), 0.4), max = Math.max(...r.recommendations.map((x) => x.hi), 0.6);
  const pct = (v) => ((v - min) / (max - min) * 100).toFixed(1);
  $("#recs tbody").innerHTML = r.recommendations.map((x) => `<tr>
    <td><span class="cls c${x.class}">${x.class}</span></td>
    <td class="champ"><img src="${icon(x.key)}" alt="">${x.name}</td>
    <td><b>${(x.p * 100).toFixed(1)} %</b></td>
    <td><span class="bar"><i style="left:${pct(x.lo)}%;width:${(pct(x.hi) - pct(x.lo)).toFixed(1)}%"></i><b style="left:${pct(x.p)}%"></b></span>${(x.lo * 100).toFixed(1)}–${(x.hi * 100).toFixed(1)}</td>
    <td>${x.contributions.find((c) => c.kind === "strength")?.games ?? 0}</td>
    <td>${x.contributions.filter((c) => c.kind !== "strength").map((c) => `<span class="term ${c.logOdds >= 0 ? "pos" : "neg"}" title="${c.games} her">${KIND[c.kind]} ${c.vsName ?? ""}${c.vsPos ? " " + POS_CS[c.vsPos] : ""} ${c.logOdds >= 0 ? "+" : ""}${c.logOdds.toFixed(2)}</span>`).join("")}</td>
    <td>${(x.threats || []).slice(0, 3).map((t) => `<span class="term neg" title="pick ${Math.round(t.pPick * 100)} %">${t.name} ${POS_CS[t.pos]} ${t.logOdds.toFixed(2)}</span>`).join("")}</td>
  </tr>`).join("");
}

async function loadPlayer() {
  const puuid = $("#playerPuuid").value.trim(); if (!puuid) return;
  const r = await fetch("/api/player/" + encodeURIComponent(puuid)).then((x) => x.json());
  $("#playerTable tbody").innerHTML = r.champions.map((c) => `<tr><td>${c.name ?? c.champion_id}</td><td>${POS_CS[c.position] ?? "?"}</td><td>${c.games}</td><td>${(100 * c.wins / c.games).toFixed(0)} %</td><td>${new Date(c.last_played).toLocaleDateString("cs")}</td></tr>`).join("") || "<tr><td colspan=5>žádná data</td></tr>";
}

async function loadReplay() {
  const r = await fetch("/api/model/replay").then((x) => x.json());
  const run = r.runs[0]; if (!run) { $("#replay").innerHTML = "<p class=hint>zatím žádné přehrání</p>"; return; }
  const rep = run.report, pc = (v) => Number.isFinite(v) ? (v * 100).toFixed(1) + " %" : "–";
  $("#replay").innerHTML = `<p>Run ${run.run_id} · patch ${run.patch} · ${run.games} her · ${run.picks} picků · pokrytí ${pc(rep.coverage)}</p>
    <p><b>Lift:</b> třída 1 WR ${pc(rep.lift.class1.wr)} (n=${rep.lift.class1.n}) vs. ostatní ${pc(rep.lift.other.wr)} (n=${rep.lift.other.n}) → ${(rep.lift.diff * 100).toFixed(1)} p.b.</p>
    <table><thead><tr><th>Rank zvoleného</th><th>n</th><th>skutečný WR</th><th>predikované P</th></tr></thead><tbody>${rep.byRank.map((b) => `<tr><td>${b.bucket}</td><td>${b.n}</td><td>${pc(b.wr)}</td><td>${pc(b.meanP)}</td></tr>`).join("")}</tbody></table>
    <p><b>Kalibrace P(zvolený):</b> log‑loss ${rep.calibration.logloss.toFixed(4)} · Brier ${rep.calibration.brier.toFixed(4)} · AUC ${rep.calibration.auc.toFixed(3)} · ECE ${rep.calibration.ece.toFixed(3)}</p>
    <table><thead><tr><th>Známých soupeřů</th><th>n</th><th>přesnost odhadu pozic (H4)</th></tr></thead><tbody>${rep.positionAccuracy.map((p) => `<tr><td>${p.knownEnemies}</td><td>${p.n}</td><td>${pc(p.accuracy)}</td></tr>`).join("")}</tbody></table>`;
}

async function loadModel() {
  loadReplay();
  const r = await fetch("/api/model/eval").then((x) => x.json());
  $("#dataSummary").innerHTML = "<p>Data: " + r.data.map((d) => `<b>${d.patch}</b> ${d.games} her (${new Date(d.first).toLocaleDateString("cs")} – ${new Date(d.last).toLocaleDateString("cs")})`).join(" · ") + "</p>";
  $("#evalTable tbody").innerHTML = r.runs.map((e) => `<tr><td>${e.run_id}</td><td>${e.patch}</td><td>${e.tier_band ?? "vše"}</td><td>${e.baseline}</td><td>${e.n_games}</td><td>${Number(e.logloss).toFixed(4)}</td><td>${Number(e.brier).toFixed(4)}</td><td>${Number(e.auc).toFixed(3)}</td><td>${Number(e.ece).toFixed(3)}</td></tr>`).join("") || "<tr><td colspan=9>zatím žádná evaluace</td></tr>";
  const full = r.runs.find((e) => e.baseline === "full");
  $("#calib").innerHTML = full ? "<p class=hint>Kalibrace plného modelu (run " + full.run_id + "): predikce vs. skutečnost po binech</p><div class=calib>" + full.calibration.map((b) => `<div><b>${b.n}</b><br>${b.n ? (b.pred * 100).toFixed(0) + "→" + (b.obs * 100).toFixed(0) : "–"}</div>`).join("") + "</div>" : "";
}

init().catch((e) => { $("#meta").textContent = "chyba: " + e.message; });
