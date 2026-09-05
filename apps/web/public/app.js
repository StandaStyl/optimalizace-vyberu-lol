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
  buildTeamSlots("#wpBlue");
  buildTeamSlots("#wpRed");
  document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("nav button, .tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); $("#tab-" + b.dataset.tab).classList.add("active");
    if (b.dataset.tab === "model") loadModel();
  }));
  ["#myPos", "#band", "#puuid"].forEach((s) => $(s).addEventListener("change", score));
  $("#loadPlayer").addEventListener("click", loadPlayer);
  $("#riotId").addEventListener("keydown", (e) => { if (e.key === "Enter") loadPlayer(); });
  $("#champName").addEventListener("change", loadChampion);
  $("#champBand").addEventListener("change", loadChampion);
  $("#wpBand").addEventListener("change", winprob);
  $("#wpFromDraft").addEventListener("click", fillTeamsFromDraft);
  score();
}

function buildSlots(sel, n, withPos, onChange = score) {
  const el = $(sel);
  el.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const row = document.createElement("div");
    row.className = "slot";
    row.innerHTML = `<img alt=""><input list="champList" placeholder="${withPos === null ? "ban" : "šampion"}">` +
      (withPos === null ? "" : `<select><option value="">${withPos ? "pozice" : "odhad"}</option>${POS.map((p) => `<option value="${p}">${POS_CS[p]}</option>`).join("")}</select>`);
    const input = row.querySelector("input");
    input.addEventListener("change", () => { const c = byName.get(input.value.trim().toLowerCase()); row.querySelector("img").src = c ? icon(c.key) : ""; onChange(); });
    row.querySelector("select")?.addEventListener("change", onChange);
    el.appendChild(row);
  }
}

/** Five slots with the five positions preselected — a full team line-up. */
function buildTeamSlots(sel) {
  buildSlots(sel, 5, true, winprob);
  [...$(sel).querySelectorAll(".slot")].forEach((row, i) => { row.querySelector("select").value = POS[i]; });
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
  const body = { myPos: $("#myPos").value, band: $("#band").value, allies: readSlots("#allies"), enemies: readSlots("#enemies"), bans: readSlots("#bans").map((s) => s.champ), top: 200 };
  const puuid = $("#puuid").value.trim(); if (puuid) body.myPuuid = puuid;
  const r = await fetch("/api/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
  if (r.error) { $("#resultMeta").textContent = r.error; return; }
  const classes = new Set(r.recommendations.map((x) => x.class)).size;
  $("#resultMeta").innerHTML = `patch ${r.patch} · pásmo ${r.band} · ${r.candidates} kandidátů ve ${classes} třídách · průměr pozice ${(r.fieldMean * 100).toFixed(1)} %`
    + ` · řazeno podle <b>spodní meze intervalu</b> (jistota, ne bodový odhad)`
    + (r.personalised ? " · <b>osobní</b> (s vaší historií)" : ' · <span class="warn">bez Riot ID = jen populační průměr — vaše vlastní historie je největší rozdíl</span>');
  const ep = Object.entries(r.enemyPositions || {});
  $("#enemyPos").innerHTML = ep.length ? "Odhad pozic soupeřů: " + ep.map(([id, d]) => { const c = champs.find((x) => x.id === Number(id)); const best = Object.entries(d).sort((a, b) => b[1] - a[1])[0]; return `<b>${c?.name ?? id}</b> → ${POS_CS[best[0]]} (${Math.round(best[1] * 100)} %)`; }).join(" · ") : "";
  $("#banRecs").innerHTML = r.bans?.length ? "Doporučené bany (největší očekávaná ztráta pro naše top kandidáty): " + r.bans.slice(0, 5).map((b) => `<b>${b.name}</b> ${(b.expectedLoss * 100).toFixed(1)} (pick ${Math.round(b.pPick * 100)} %)`).join(" · ") : "";
  const KIND = { matchup: "vs", synergy: "+", player: "já", future_matchup: "⌛vs", future_synergy: "⌛+" };
  const min = Math.min(...r.recommendations.map((x) => x.lo), 0.4), max = Math.max(...r.recommendations.map((x) => x.hi), 0.6);
  const pct = (v) => ((v - min) / (max - min) * 100).toFixed(1);
  const STRATUM = { new: "běžný pilot", exp: "zkušený pilot (+)" };
  // Headline is the difference from the field (the decision-relevant number); the absolute
  // probability sits beside it. Few games → warning colour; ★ = estimate from the experienced-pilot stratum.
  $("#recs tbody").innerHTML = r.recommendations.map((x) => {
    const d = (x.p - r.fieldMean) * 100;
    const st = x.contributions.find((c) => c.kind === "strength");
    return `<tr>
    <td><span class="cls c${x.class}">${x.class}</span></td>
    <td class="champ"><img src="${icon(x.key)}" alt=""><a href="#" class="champ-link" data-name="${x.name}">${x.name}</a></td>
    <td><b class="${d >= 0 ? "pos" : "neg"}">${d >= 0 ? "+" : ""}${d.toFixed(1)} p.b.</b> <span class="hint">${(x.p * 100).toFixed(1)} %</span></td>
    <td><span class="bar"><i style="left:${pct(x.lo)}%;width:${(pct(x.hi) - pct(x.lo)).toFixed(1)}%"></i><b style="left:${pct(x.p)}%"></b></span>${(x.lo * 100).toFixed(1)}–${(x.hi * 100).toFixed(1)}</td>
    <td class="${(st?.games ?? 0) < 100 ? "warn" : ""}" title="${st?.stratum ? STRATUM[st.stratum] : ""}">${st?.games ?? 0}${st?.stratum === "exp" ? " ★" : ""}</td>
    <td>${x.contributions.filter((c) => c.kind !== "strength").map((c) => `<span class="term ${c.logOdds >= 0 ? "pos" : "neg"}" title="${c.games} her">${KIND[c.kind]} ${c.vsName ?? ""}${c.vsPos ? " " + POS_CS[c.vsPos] : ""} ${c.logOdds >= 0 ? "+" : ""}${c.logOdds.toFixed(2)}</span>`).join("")}</td>
    <td>${(x.threats || []).slice(0, 3).map((t) => `<span class="term neg" title="pick ${Math.round(t.pPick * 100)} %">${t.name} ${POS_CS[t.pos]} ${t.logOdds.toFixed(2)}</span>`).join("")}</td>
  </tr>`;
  }).join("");
  // Champion name jumps to its page — the numbers behind a recommendation are one click away.
  $("#recs").querySelectorAll(".champ-link").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    $("#champName").value = a.dataset.name;
    $("#champBand").value = $("#band").value;
    document.querySelector('nav button[data-tab="champion"]').click();
    loadChampion();
  }));
}

async function loadPlayer() {
  const riotId = $("#riotId").value.trim(); if (!riotId) return;
  $("#profileHead").textContent = "hledám…";
  const r = await fetch("/api/profile?riotId=" + encodeURIComponent(riotId)).then((x) => x.json());
  if (r.error) { $("#profileHead").textContent = "Chyba: " + r.error; $("#playerTable tbody").innerHTML = ""; return; }
  const BAND = { low: "Iron–Gold", mid: "Platinum–Emerald", high: "Diamond+" };
  $("#profileHead").innerHTML = `<b>${r.gameName}#${r.tagLine}</b> · ${r.platform.toUpperCase()} · ${r.tier ? r.tier + " " + r.division : "bez ranku"} (${BAND[r.band] ?? "pásmo neznámé"}) · ${r.inDb ? "v datech" : "zatím žádná historie v našich datech"}
    · <button id="useForDraft">Použít pro draft</button> · <a href="/privacy.html">smazat moje data</a>`;
  $("#useForDraft").onclick = () => { $("#puuid").value = r.puuid; if (r.band) $("#band").value = r.band; document.querySelector('nav button[data-tab="draft"]').click(); score(); };
  $("#playerTable tbody").innerHTML = r.champions.map((c) => `<tr><td class="champ"><img src="${icon(c.key)}" alt="">${c.name ?? c.champion_id}</td><td>${POS_CS[c.position] ?? "?"}</td><td>${c.games}</td><td>${(100 * c.wins / c.games).toFixed(0)} %</td><td>${new Date(c.last_played).toLocaleDateString("cs")}</td></tr>`).join("") || "<tr><td colspan=5>žádné zápasy v našich datech</td></tr>";
}

async function loadChampion() {
  const c = byName.get($("#champName").value.trim().toLowerCase()); if (!c) return;
  const r = await fetch(`/api/champion/${c.id}?band=${$("#champBand").value}`).then((x) => x.json());
  if (r.error) { $("#champHead").textContent = r.error; return; }
  const pc = (v) => (v * 100).toFixed(1) + " %";
  $("#champHead").innerHTML = `<p class="champ" style="display:flex;align-items:center;gap:10px"><img src="${icon(r.key)}" alt="" style="width:48px;height:48px;border-radius:6px"><b style="font-size:1.2rem">${r.name}</b> <span class="hint">patch ${r.patch} · pásmo ${r.band}</span></p>
    <table><thead><tr><th>Pozice</th><th>Her</th><th>Podíl</th><th>WR (posterior)</th><th>80% interval</th></tr></thead><tbody>${r.positions.map((p) => `<tr><td>${POS_CS[p.pos]}</td><td>${p.games}</td><td>${pc(p.share)}</td><td><b>${pc(p.wr)}</b></td><td>${pc(p.lo)}–${pc(p.hi)}</td></tr>`).join("")}</tbody></table>`;
  const rows = (xs) => xs.length ? xs.map((x) => `<tr><td class="champ"><img src="${icon(x.key)}" alt="">${x.name}</td><td>${POS_CS[x.pos]}</td><td>${x.games}</td><td>${pc(x.wr)}</td><td><span class="term ${x.delta >= 0 ? "pos" : "neg"}">${x.delta >= 0 ? "+" : ""}${x.delta.toFixed(2)}</span> <span class="hint">(${x.lo.toFixed(2)}…${x.hi.toFixed(2)})</span></td></tr>`).join("") : "<tr><td colspan=5 class=hint>málo dat</td></tr>";
  const block = (title, xs) => `<h3 style="margin:14px 0 6px;font:600 .95rem Literata,serif">${title}</h3><table><thead><tr><th>Šampion</th><th>Pozice</th><th>Her</th><th>WR</th><th>Δ log‑odds vs. nezávislost (80 %)</th></tr></thead><tbody>${rows(xs)}</tbody></table>`;
  $("#champBody").innerHTML = r.byPosition.map((b) => `<div class="panel" style="margin-top:12px"><h2>${r.name} na pozici ${POS_CS[b.pos]}</h2>
    ${block("Vítězí proti (nejlepší matchupy)", b.counters)}${block("Prohrává proti (nejhorší matchupy)", b.countered)}
    ${block("Nejlepší synergie", b.synergies)}${block("Nejhorší synergie", b.antiSynergies)}</div>`).join("") || "<p class=hint>šampion nemá na žádné pozici dost her</p>";
}

const TERM_CS = { strength: "Síla šampionů na pozicích", matchup: "Matchupy (napříč pozicemi)", synergy: "Synergie uvnitř týmů", player: "Historie hráčů" };

/** Copy the draft tab into the two team line-ups; slots without a known position stay empty. */
function fillTeamsFromDraft() {
  const setTeam = (sel, slots) => {
    const rows = [...$(sel).querySelectorAll(".slot")];
    rows.forEach((row, i) => { row.querySelector("input").value = ""; row.querySelector("img").src = ""; row.querySelector("select").value = POS[i]; });
    slots.forEach((s) => {
      const row = rows[POS.indexOf(s.pos)];
      if (!s.pos || !row) return;
      const c = champs.find((x) => x.id === s.champ);
      if (!c) return;
      row.querySelector("input").value = c.name;
      row.querySelector("img").src = icon(c.key);
    });
  };
  setTeam("#wpBlue", readSlots("#allies"));
  setTeam("#wpRed", readSlots("#enemies"));
  $("#wpBand").value = $("#band").value;
  winprob();
}

let wpTimer;
function winprob() { clearTimeout(wpTimer); wpTimer = setTimeout(doWinprob, 150); }
async function doWinprob() {
  const blue = readSlots("#wpBlue").filter((s) => s.pos);
  const red = readSlots("#wpRed").filter((s) => s.pos);
  if (!blue.length && !red.length) { $("#wpResult").innerHTML = '<p class="hint">Zadejte šampiony obou týmů (nebo je převezměte z draftu).</p>'; return; }
  const r = await fetch("/api/winprob", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blue, red, band: $("#wpBand").value }) }).then((x) => x.json());
  if (r.error) { $("#wpResult").innerHTML = `<p class="hint">Chyba: ${r.error}</p>`; return; }
  const pc = (v) => (v * 100).toFixed(1) + " %";
  const pbs = (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + " p.b.";
  const b = (r.pBlue * 100).toFixed(1), rd = (100 - r.pBlue * 100).toFixed(1);
  $("#wpResult").innerHTML = `
    <p><span class="wp-big">${b} %</span> <span class="hint">šance modrých · červení ${rd} %</span></p>
    <div class="wp-bar"><i class="b" style="width:${b}%"></i><i class="r" style="width:${rd}%"></i></div>
    <p class="hint">patch ${r.patch} · pásmo ${r.band} · obsazeno modří ${r.blue}/5, červení ${r.red}/5${r.blue < 5 || r.red < 5 ? " — neobsazené pozice se nezapočítávají" : ""}</p>
    <table><thead><tr><th>Člen modelu</th><th>log‑odds (kladné = pro modré)</th><th>Dopad na šanci</th></tr></thead><tbody>
      ${Object.entries(r.terms).map(([k, v]) => `<tr><td>${TERM_CS[k] ?? k}</td><td><span class="term ${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${v.toFixed(3)}</span></td><td>${pbs(r.impact[k])}</td></tr>`).join("")}
    </tbody></table>
    <p class="hint">Varianty modelu: jen síla ${pc(r.byVariant.strength)} · párový (bez hráčů) ${pc(r.byVariant.pairwise)} · plný ${pc(r.byVariant.full)}</p>`;
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

async function loadProspective() {
  const r = await fetch("/api/model/prospective").then((x) => x.json());
  if (r.error) { $("#prospective").innerHTML = `<p class="hint">${r.error}</p>`; return; }
  const t = r.totals;
  const head = `<p>Zaznamenaných doporučení: <b>${t.logged}</b> · z toho s vybraným šampionem: <b>${t.with_choice}</b> · s dohledaným výsledkem: <b>${t.resolved}</b>${t.resolved ? ` (výher ${t.wins})` : ""}</p>`;
  const table = r.byClass.length
    ? `<table><thead><tr><th>Třída doporučení</th><th>Her</th><th>Výher</th><th>WR</th></tr></thead><tbody>${r.byClass.map((b) => `<tr><td><span class="cls c${b.cls}">${b.cls}</span></td><td>${b.n}</td><td>${b.wins}</td><td>${((100 * b.wins) / b.n).toFixed(1)} %</td></tr>`).join("")}</tbody></table>`
    : `<p class="hint">Zatím žádná dohraná hra k vyhodnocení — spusť konektor (<code>npm run lcu</code>) a odehraj ranked zápas.</p>`;
  $("#prospective").innerHTML = head + table;
}

async function loadModel() {
  loadReplay();
  loadProspective();
  const r = await fetch("/api/model/eval").then((x) => x.json());
  $("#dataSummary").innerHTML = "<p>Data: " + r.data.map((d) => `<b>${d.patch}</b> ${d.games} her (${new Date(d.first).toLocaleDateString("cs")} – ${new Date(d.last).toLocaleDateString("cs")})`).join(" · ") + "</p>";
  $("#evalTable tbody").innerHTML = r.runs.map((e) => `<tr><td>${e.run_id}</td><td>${e.patch}</td><td>${e.tier_band ?? "vše"}</td><td>${e.baseline}</td><td>${e.n_games}</td><td>${Number(e.logloss).toFixed(4)}</td><td>${Number(e.brier).toFixed(4)}</td><td>${Number(e.auc).toFixed(3)}</td><td>${Number(e.ece).toFixed(3)}</td></tr>`).join("") || "<tr><td colspan=9>zatím žádná evaluace</td></tr>";
  const full = r.runs.find((e) => e.baseline === "full");
  $("#calib").innerHTML = full ? "<p class=hint>Kalibrace plného modelu (run " + full.run_id + "): predikce vs. skutečnost po binech</p><div class=calib>" + full.calibration.map((b) => `<div><b>${b.n}</b><br>${b.n ? (b.pred * 100).toFixed(0) + "→" + (b.obs * 100).toFixed(0) : "–"}</div>`).join("") + "</div>" : "";
}

init().catch((e) => { $("#meta").textContent = "chyba: " + e.message; });
