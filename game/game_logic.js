(function () {
"use strict";

/* ======================================================================
   1. CONFIG
   ====================================================================== */
const VARS = [
  // clues the stress rules use (black-edged tabs)
  { id: "temp", name: "Temperature", units: "°C", key: true,
    def: "Air temperature about 2 m above the ground.", source: "GLDAS · Tair_f_inst" },
  { id: "rain", name: "Rainfall", units: "mm/month", key: true,
    def: "Rain and snow falling on the land.", source: "GLDAS · Rainf_f_tavg" },
  { id: "soil", name: "Root-zone soil moisture", units: "kg/m²", key: true,
    def: "Water stored in the top ~1 m of soil, where tree roots drink.", source: "GLDAS · RootMoist_inst" },
  { id: "potevap", name: "Potential evaporation", units: "mm/month", key: true,
    def: "How much water the air could draw from wet ground — the atmosphere's demand for water.", source: "GLDAS · PotEvap_tavg" },
  // supporting clues
  { id: "topsoil", name: "Topsoil moisture", units: "kg/m²",
    def: "Water in the top 10 cm of soil — reacts first when a region dries.", source: "GLDAS · SoilMoi0_10cm_inst" },
  { id: "evap", name: "Evaporation", units: "mm/month",
    def: "Water actually returning to the air from soil and plants.", source: "GLDAS · Evap_tavg" },
  { id: "sun", name: "Sunlight", units: "W/m²", lowConfidence: true,
    def: "Energy from the sun reaching the ground. Model estimate — the weakest input in GLDAS, so read its trends with caution.", source: "GLDAS · SWdown_f_tavg" },
  { id: "ndvi", name: "Vegetation greenness", units: "index",
    def: "How green the land looks from space — ALL vegetation, not only pines. Used to test the stress rules.", source: "MODIS · MOD13A3 (AppEEARS)" },
];
const REQUIRED = ["temp", "rain", "soil"];          // a region can be planted only with these

// Sources (from research/scots_pine_growth_conditions.json)
const SOURCES = {
  S3: { cite: "Janecka et al. 2022, Forests 13:477 — Scots pine on south Baltic coastal dunes", url: "https://mdpi-res.com/d_attachment/forests/forests-13-00477/article_deploy/forests-13-00477.pdf" },
  S4: { cite: "Scots pine defoliation and climate in the Valais, Frontiers in Forests and Global Change 2022", url: "https://www.frontiersin.org/articles/10.3389/ffgc.2022.874100" },
  S5: { cite: "Drought as an inciting mortality factor in Scots pine stands of the Valais", url: "https://doc.rero.ch/record/317644?ln=de" },
  S11: { cite: "Bolte et al. 2016, Frontiers in Plant Science — beech seedling drought experiment", url: "https://www.frontiersin.org/articles/10.3389/fpls.2016.00751/pdf" },
  S13: { cite: "Körner & Paulsen — worldwide high-altitude treeline temperatures (46 sites)", url: "https://openpolar.no/Record/crwiley:10.1111%2Fj.1365-2699.2003.01043.x" },
  S14: { cite: "Treeline review on sink versus carbon limitation", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3535059" },
  S15: { cite: "EUFORGEN species profile, Pinus sylvestris", url: "https://euforgen.org/species/pinus-sylvestris" },
};
const TIER_WEIGHT = { A: 1, B: 0.5, C: 0.2 };   // research's suggested starting weights — not a published value
const TIER_TEXT = { A: "Scots pine, measured threshold", B: "Scots pine, direction only", C: "other species / general — context" };
// tier badge markup: explanation appears on hover and on keyboard focus
const tierTag = (t, focus = true) => `<span class="tier t${t}" role="img" aria-label="Evidence tier ${t}: ${TIER_TEXT[t]}" data-tip="Tier ${t} · ${TIER_TEXT[t]}"${focus ? ' tabindex="0"' : ""}>${t}</span>`;

// Stress rules that monthly data can run. Definitions match pipeline/test_rules.py.
const RULES = [
  { id: "T1", tier: "A", src: ["S3"], driver: "temperature", vars: ["temp"], name: "Cold late winter",
    test: "Jan–Mar mean temperature ≤ 1.5 standard deviations below this region's normal",
    effect: "Growth reduced in 11 of 12 ring-width chronologies, mostly in the same year (south Baltic coast, 1902–2016)." },
  { id: "T6", tier: "C", src: ["S13", "S14"], driver: "temperature", vars: ["temp"], name: "Tree-line cold",
    test: "Growing-season mean < 6.4 °C (months above 0 °C), or fewer than 3 such months",
    effect: "Trees in general can't sustain growth this cold — the worldwide tree line. Not a Scots pine limit inside its range." },
  { id: "W1", tier: "A", src: ["S4"], driver: "water", vars: ["rain"], name: "Dry late summer",
    test: "Jul–Sep rainfall < 100 mm",
    effect: "Regular defoliation in a dry inner-Alpine valley (Valais). The authors warn it may not transfer to other places." },
  { id: "W4", tier: "A", src: ["S3"], driver: "water", vars: ["rain", "potevap"], name: "Spring–summer drought",
    test: "Mar–Aug water balance (rain − potential evaporation) ≤ 1.5 SD below normal — an SPEI-style approximation",
    effect: "Growth reduced in 7 of 12 ring-width chronologies, usually the year AFTER the drought, lasting about a year." },
  { id: "W5", tier: "B", src: ["S5"], driver: "water", vars: ["rain", "potevap"], name: "Multi-year drought",
    test: "W4 in two or more consecutive years (the research gives no separate threshold)",
    effect: "Prolonged growth decline and higher long-term death risk; trees often died years later (Valais, since 1864)." },
  { id: "W6", tier: "C", src: ["S11"], driver: "water", vars: ["soil"], name: "Dry root zone",
    test: "Jun–Aug relative root-zone wetness < 0.25 (0 = driest month on record, 1 = wettest)",
    effect: "Mortality rises sharply below ~0.20–0.30 of available water — measured on beech seedlings, NOT Scots pine. Rough flag only." },
];
const ruleById = (id) => RULES.find((r) => r.id === id);

const PINE = {
  name: "Scots pine", latin: "Pinus sylvestris",
  loves: ["Full sun (a light-demanding pioneer)", "Well-drained, even sandy soil", "Cold winters are fine"],
  hates: ["Drought — especially several dry years in a row", "Unusually cold late winters"],
  facts: ["Europe's most widespread pine — from Spain to beyond the Arctic Circle", "Can live 300+ years", "The tree of Scotland's ancient Caledonian forest"],
};

// bbox = [west, south, east, north] — must match pipeline/build_data.py
const REGIONS = [
  { id: "brandenburg", name: "Brandenburg, Germany", bbox: [12.0, 51.5, 14.7, 53.4], label: [8, 0, "start"], home: true,
    desc: "The flat, sandy country around Berlin — full of pine plantations." },
  { id: "scotland", name: "Scottish Highlands", bbox: [-6.0, 56.3, -3.0, 58.0], label: [-8, 0, "end"],
    desc: "Wet, windy uplands — home of the native Caledonian pinewoods." },
  { id: "lapland", name: "Finnish Lapland", bbox: [23.5, 66.5, 28.5, 68.5], label: [8, 0, "start"],
    desc: "Far north, near the Arctic tree line. Long, freezing winters and a short summer." },
  { id: "valais", name: "Valais Alps, Switzerland", bbox: [6.9, 46.0, 8.3, 46.5], label: [8, 4, "start"],
    desc: "High Alpine peaks and glaciers around the Matterhorn — mostly above 2,000 m, where the tree line is." },
  { id: "spain", name: "Central Spain", bbox: [-6.0, 38.6, -1.5, 42.0], label: [8, 0, "start"],
    desc: "High, dry plateau with hot summers and cool winters." },
  { id: "kazakh", name: "Kazakh steppe", bbox: [69.0, 50.5, 73.0, 52.5], label: [8, 0, "start"],
    desc: "Vast dry grassland in northern Kazakhstan — hot summers, bitter winters, little rain." },
];
// Independent cross-check of the GLDAS temperature trends: Copernicus ERA5, European State of the Climate 2025
// (trends 1996–2025: Alps & central Europe 0.5–1 °C/decade; western/southwestern Europe & Fennoscandia 0.2–0.5).
const CROSSCHECK_URL = "https://climate.copernicus.eu/esotc/2025/why-europe-warming-faster";
const CROSSCHECK = {
  brandenburg: { temp: ["ok", "Fits Copernicus ERA5's 0.5–1 °C/decade for central Europe."] },
  scotland: { temp: ["ok", "At the low end of Copernicus ERA5's 0.2–0.5 °C/decade for western Europe."] },
  lapland: { temp: ["ok", "At the low end of Copernicus ERA5's 0.2–0.5 °C/decade for Fennoscandia."] },
  valais: { temp: ["warn", "At or just above the top of Copernicus ERA5's 0.5–1 °C/decade for the Alps — treat the exact rate with caution."] },
  spain: { temp: ["bad", "About twice Copernicus ERA5's 0.2–0.5 °C/decade for southwestern Europe. GLDAS likely overstates warming here — don't rely on this rate."] },
};
const FIRST_YEAR = 2000, LAST_YEAR = 2024, REPLAY_FROM = 2005, REPLAY_TO = 2024;
const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
const C = { rise: "#2a8a5a", fall: "#c2412d", muted: "#a3a8ba", line: "#2443d6", anom: "#8a8fa6" };

/* ======================================================================
   2. Helpers + data
   ====================================================================== */
const DATA = {};
const $ = (id) => document.getElementById(id);
const varById = (id) => VARS.find((v) => v.id === id);
const regionById = (id) => REGIONS.find((r) => r.id === id);
const fin = (x) => Number.isFinite(x);
const avg = (a) => { const f = a.filter(fin); return f.length ? f.reduce((s, x) => s + x, 0) / f.length : NaN; };
const sd = (a) => { const f = a.filter(fin), m = avg(f); return f.length > 1 ? Math.sqrt(f.reduce((s, x) => s + (x - m) ** 2, 0) / (f.length - 1)) : NaN; };
const zscore = (a) => { const m = avg(a), s = sd(a); return a.map((x) => (fin(x) && s > 0 ? (x - m) / s : NaN)); };
const pTxt = (p) => (!fin(p) ? "—" : p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
const qTxt = (q) => (!fin(q) ? "—" : q < 0.001 ? "q < 0.001" : `q = ${q.toFixed(3)}`);
function fmt(x, ref = x) { if (!fin(x)) return "—"; const a = Math.abs(ref || x); return x.toFixed(a >= 100 ? 0 : a >= 1 ? 1 : 2); }
const signed = (x, ref) => (x > 0 ? "+" : "") + fmt(x, ref);
const lat = (x) => `${Math.abs(x)}°${x >= 0 ? "N" : "S"}`;
const lon = (x) => `${Math.abs(x)}°${x >= 0 ? "E" : "W"}`;
const srcLinks = (ids) => ids.map((id) => `<a href="${SOURCES[id].url}" target="_blank" rel="noopener" title="${SOURCES[id].cite}">${id}</a>`).join(", ");

// value of a season in year y (months 1-12). Sums are scaled up if one month is missing.
function season(values, y, months, how = "mean", need = months.length - 1) {
  const i0 = (y - FIRST_YEAR) * 12;
  const ok = months.map((m) => values[i0 + m - 1]).filter(fin);
  if (ok.length < need) return NaN;
  return how === "sum" ? avg(ok) * months.length : avg(ok);
}

// Benjamini-Hochberg false-discovery-rate adjustment
function bh(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => fin(p)).sort((a, b) => a[0] - b[0]);
  const q = ps.map(() => NaN); let prev = 1;
  for (let k = idx.length - 1; k >= 0; k--) { prev = Math.min(prev, (idx[k][0] * idx.length) / (k + 1)); q[idx[k][1]] = prev; }
  return q;
}
// one-sided Welch t-test: is mean(a) < mean(b)?
function welchLess(a, b) {
  a = a.filter(fin); b = b.filter(fin);
  if (a.length < 3 || b.length < 3) return NaN;
  const ma = avg(a), mb = avg(b), va = sd(a) ** 2 / a.length, vb = sd(b) ** 2 / b.length;
  const t = (ma - mb) / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  const two = DDStats._internal.tTwoSidedP(t, df);
  return t < 0 ? two / 2 : 1 - two / 2;
}

/* ---------- stress rules for one region ---------- */
function evaluateRules(D) {
  const fired = {}, avail = {};
  if (D.temp) {
    const z = zscore(YEARS.map((y) => season(D.temp.values, y, [1, 2, 3])));
    fired.T1 = z.map((x) => fin(x) && x <= -1.5); avail.T1 = true;
    fired.T6 = YEARS.map((y) => {
      const m = D.temp.values.slice((y - FIRST_YEAR) * 12, (y - FIRST_YEAR) * 12 + 12).filter(fin);
      const warm = m.filter((x) => x > 0);
      return m.length >= 10 && (warm.length < 3 || avg(warm) < 6.4);
    }); avail.T6 = true;
  }
  if (D.rain) { fired.W1 = YEARS.map((y) => { const v = season(D.rain.values, y, [7, 8, 9], "sum"); return fin(v) && v < 100; }); avail.W1 = true; }
  if (D.rain && D.potevap) {
    const wb = D.rain.values.map((r, i) => r - D.potevap.values[i]);
    const z = zscore(YEARS.map((y) => season(wb, y, [3, 4, 5, 6, 7, 8], "sum", 5)));
    fired.W4 = z.map((x) => fin(x) && x <= -1.5); avail.W4 = true;
    fired.W5 = fired.W4.map((f, i) => f && i > 0 && fired.W4[i - 1]); avail.W5 = true;
  }
  if (D.soil) {
    const v = D.soil.values, mn = Math.min(...v.filter(fin)), mx = Math.max(...v.filter(fin));
    const rel = v.map((x) => (fin(x) ? (x - mn) / (mx - mn) : NaN));
    fired.W6 = YEARS.map((y) => { const s = season(rel, y, [6, 7, 8]); return fin(s) && s < 0.25; }); avail.W6 = true;
  }
  // per-year stress (tier-weighted) and which rules fired
  const years = YEARS.map((y, i) => {
    const on = RULES.filter((r) => avail[r.id] && fired[r.id][i]);
    return { y, on, stress: on.reduce((s, r) => s + TIER_WEIGHT[r.tier], 0), strong: on.some((r) => r.tier !== "C") };
  });
  // growing-season greenness anomaly (Apr–Sep), if loaded
  if (D.ndvi) {
    const ev = YEARS.map((y) => season(D.ndvi.values, y, [4, 5, 6, 7, 8, 9], "mean", 4));
    const m = avg(ev);
    years.forEach((yr, i) => { yr.evi = ev[i] - m; });
  }
  return { fired, avail, years };
}

function prepare(REAL) {
  const vi = (REAL.vegetation_index || "NDVI").toUpperCase(), veg = varById("ndvi");
  veg.name = `Vegetation greenness (${vi})`; veg.units = vi; veg.source = `MODIS · MOD13A3 ${vi} (AppEEARS)`;
  let have = 0;
  for (const reg of REGIONS) {
    DATA[reg.id] = {};
    for (const v of VARS) {
      const arr = REAL.regions && REAL.regions[reg.id] && REAL.regions[reg.id][v.id];
      if (!Array.isArray(arr) || arr.filter((x) => x !== null).length < 120) { DATA[reg.id][v.id] = null; continue; }
      have++;
      const values = arr.map((x) => (x === null ? NaN : x));
      const res = DDStats.analyze(REAL.dates, values, { name: v.name, units: v.units });
      const quality = (REAL.quality && REAL.quality[reg.id] && REAL.quality[reg.id][v.id]) || null;
      DATA[reg.id][v.id] = { dates: REAL.dates, values, result: res, quality };
    }
    reg.playable = REQUIRED.every((id) => DATA[reg.id][id]);
    if (reg.playable) DATA[reg.id].rules = evaluateRules(DATA[reg.id]);
  }
  // false-discovery-rate correction across ALL trend tests on the page
  const all = [];
  for (const reg of REGIONS) for (const v of VARS) if (DATA[reg.id][v.id]) all.push(DATA[reg.id][v.id]);
  const qs = bh(all.map((d) => d.result.mannKendall.p));
  all.forEach((d, i) => { d.q = qs[i]; d.sig = qs[i] < 0.05; });
  NTESTS = all.length;
  // test every rule against greenness, pooled over regions, same year and one year later; FDR across tests
  RULE_TEST = [];
  for (const r of RULES) for (const lag of [0, 1]) {
    const a = [], b = [];
    for (const reg of REGIONS) {
      const R = DATA[reg.id].rules; if (!R || !R.avail[r.id] || !DATA[reg.id].ndvi) continue;
      R.years.forEach((yr, i) => { const e = R.years[i + lag] && R.years[i + lag].evi; if (!fin(e)) return; (R.fired[r.id][i] ? a : b).push(e); });
    }
    RULE_TEST.push({ id: r.id, lag, n: a.length, diff: avg(a) - avg(b), p: welchLess(a, b) });
  }
  const rq = bh(RULE_TEST.map((t) => t.p));
  RULE_TEST.forEach((t, i) => (t.q = rq[i]));
  const missing = VARS.filter((v) => REGIONS.some((r) => !DATA[r.id][v.id])).map((v) => `${v.name.toLowerCase()} (${REGIONS.filter((r) => !DATA[r.id][v.id]).map((r) => r.name.split(",")[0]).join(", ")})`);
  $("data-line").textContent = `Data: NASA GLDAS via Giovanni${REAL.generated ? ` (downloaded ${REAL.generated})` : ""} · MODIS ${vi} via AppEEARS · area-averaged per region · cleaned, gaps never filled · ${have} of ${REGIONS.length * VARS.length} series on file${missing.length ? ` · no data yet: ${missing.join("; ")}` : ""}.`;
}
let NTESTS = 0, RULE_TEST = [];
function ruleSupport(id) {
  const t = RULE_TEST.filter((x) => x.id === id && x.n >= 3);
  if (!t.length) return { txt: "not enough firing years to test", cls: "grey" };
  const best = t.reduce((a, b) => (a.q < b.q ? a : b));
  return best.q < 0.05
    ? { txt: `supported by this data: greenness lower ${best.lag ? "the year after" : "the same year"} (${qTxt(best.q)}, FDR-adjusted)`, cls: "rise" }
    : { txt: `not supported by this data (best ${qTxt(best.q)})`, cls: "grey" };
}

/* ======================================================================
   3. Derived records shared by the map, replay and verdict
   ====================================================================== */
// Annual record = mean of that year's monthly values (dataset units); needs ≥ 10 of 12 months, otherwise a gap.
const BASE_FROM = 2000, BASE_TO = 2004;                 // baseline: the five years before planting
const ANNUAL = {};
function annualOf(values) {
  return YEARS.map((y, i) => { const m = values.slice(i * 12, i * 12 + 12).filter(fin); return m.length >= 10 ? avg(m) : NaN; });
}
function buildAnnual() {
  for (const reg of REGIONS) {
    ANNUAL[reg.id] = {};
    for (const v of VARS) ANNUAL[reg.id][v.id] = DATA[reg.id][v.id] ? annualOf(DATA[reg.id][v.id].values) : null;
  }
}
const yearVal = (regId, varId, y) => { const a = ANNUAL[regId] && ANNUAL[regId][varId]; return a ? a[y - FIRST_YEAR] : NaN; };
function baseline(regId, varId) {
  const a = ANNUAL[regId] && ANNUAL[regId][varId]; if (!a) return NaN;
  const xs = YEARS.map((y, i) => (y >= BASE_FROM && y <= BASE_TO ? a[i] : NaN)).filter(fin);
  return xs.length >= 4 ? avg(xs) : NaN;
}

// Provenance (dataset, variable short name, glossary) and plain-English meaning for each clue
const DATASETS = {
  gldas: { name: "GLDAS Noah Land Surface Model L4, monthly 0.25°, version 2.1 (GLDAS_NOAH025_M)", via: "NASA GES DISC, accessed via Giovanni", url: "https://doi.org/10.5067/SXAVCZFAQLNO" },
  modis: { name: "MODIS/Terra Vegetation Indices Monthly L3 Global 1 km, version 6.1 (MOD13A3)", via: "NASA LP DAAC, accessed via AppEEARS", url: "https://doi.org/10.5067/MODIS/MOD13A3.061" },
};
const GLOSSARY_URL = "https://giovanni.gsfc.nasa.gov/giovanni/doc/glossary/Giovanni_Variable_Definitions_Glossary.html";
const dsOf = (v) => (v.id === "ndvi" ? DATASETS.modis : DATASETS.gldas);
const shortName = (v) => (v.source.split(" · ")[1] || v.source);
const WHY = {
  temp: "Warmth for growing. Unusually cold late winters are a Scots pine stress signal.",
  rain: "The water supply. Dry late summers and spring–summer droughts are stress signals.",
  soil: "Water the roots can reach. A very dry root zone is a (weak, tier C) stress flag.",
  potevap: "How thirsty the air is. Higher demand dries the soil faster.",
  topsoil: "Surface wetness — reacts first when a region dries out.",
  evap: "Water actually going back to the air from soil and plants.",
  sun: "Light at the ground. Low-confidence model input — read with caution.",
  ndvi: "Regional greenness seen by satellite — all vegetation, not only pines.",
};
const HILO = { temp: ["warmest", "coldest"], rain: ["wettest", "driest"], soil: ["wettest", "driest"], topsoil: ["wettest", "driest"],
  potevap: ["highest", "lowest"], evap: ["highest", "lowest"], sun: ["sunniest", "least sunny"], ndvi: ["greenest", "least green"] };
const ord = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function rankPhrase(regId, v) {
  const vals = REGIONS.map((r) => ({ id: r.id, x: baseline(r.id, v.id) })).filter((o) => fin(o.x)).sort((a, b) => b.x - a.x);
  const k = vals.findIndex((o) => o.id === regId), n = vals.length, [hi, lo] = HILO[v.id];
  if (k < 0 || n < 2) return "";
  return k === 0 ? `${cap(hi)} of the ${n} sites` : k === n - 1 ? `${cap(lo)} of the ${n} sites` : `${ord(k + 1)} ${hi} of ${n}`;
}
const PIN_HELP = "Pin this as the clue you trust most when choosing a site (optional, one clue at a time). It stays highlighted in the replay, and the verdict tells you whether it matched what actually stressed your tree.";
const valTxt = (x, v) => (fin(x) ? `${fmt(x)} ${v.units}` : "no data");
const reduceMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ======================================================================
   4. Navigation, opening, dispatch
   ====================================================================== */
const state = { visited: new Set(), selected: null, clue: null, locked: null, openInfo: new Set() };
let map = null;
const SCREENS = ["home", "brief", "board", "replay", "verdict"];
function show(id) {
  SCREENS.forEach((s) => $(`s-${s}`).classList.toggle("hidden", s !== id));
  if (id !== "replay") pause();
  window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
  if (id === "brief") typeTitle();
  if (id === "board" && map) { const box = $("board-body").getBoundingClientRect(); if (map.w !== Math.round(box.width) || map.h !== Math.round(box.height)) renderMap(); }
}
$("home-link").onclick = () => show("home");
$("start").onclick = () => show("brief");
$("to-board").onclick = () => show("board");

// "The Scots pine case" typed letter by letter, then the question appears (instant with reduced motion)
let typeTimer = null;
function typeTitle() {
  const el = $("case-title-text"), q = $("case-question"), full = "The Scots pine case";
  clearTimeout(typeTimer);
  if (reduceMotion()) { el.textContent = full; q.classList.remove("pending"); return; }
  q.classList.add("pending"); el.innerHTML = '<span class="caret"></span>';
  let i = 0;
  const tick = () => {
    i++; el.innerHTML = esc(full.slice(0, i)) + '<span class="caret"></span>';
    if (i < full.length) typeTimer = setTimeout(tick, 70);
    else typeTimer = setTimeout(() => { el.textContent = full; q.classList.remove("pending"); }, 450);
  };
  typeTimer = setTimeout(tick, 500);
}

$("conditions").innerHTML = `
  <p><b>What it needs</b></p>
  <ul>${PINE.loves.map((x) => `<li>${x}</li>`).join("")}</ul>
  <p><b>What stresses it:</b> drought — especially several dry years in a row — and unusually cold late winters.</p>
  <p class="src">Sources: <a href="${SOURCES.S15.url}" target="_blank" rel="noopener" title="${SOURCES.S15.cite}">S15</a> (needs); ${srcLinks(["S3", "S4", "S5"])} (stress).</p>`;
$("guide").innerHTML = `
  <h4>Species guide</h4>
  <ul>${PINE.facts.map((x) => `<li>${x}</li>`).join("")}</ul>
  <p class="src">Source: <a href="${SOURCES.S15.url}" target="_blank" rel="noopener" title="${SOURCES.S15.cite}">S15</a></p>`;
const ruleCardBrief = (r) => `<div class="rcard">
    <div class="rc-top">${tierTag(r.tier)}<b>${r.id} · ${r.name}</b></div>
    <dl><dt>Fires when</dt><dd class="fires">${r.test}</dd>
      <dt>Why it matters</dt><dd>${r.effect}</dd>
      <dt>Reads</dt><dd>${r.vars.map((id) => varById(id).name.toLowerCase()).join(" and ")} records</dd>
      <dt>Evidence</dt><dd class="src">Tier ${r.tier} (${TIER_TEXT[r.tier]}) · ${srcLinks(r.src)}</dd></dl>
  </div>`;
$("rules-explained").innerHTML = `
  <p class="rules-intro">When you replay 2005–2024, the game checks every year of the NASA records against warning signs measured in published Scots pine research. A signal <b>fires</b> in a year when the records cross its threshold. <b>T</b> signals are about temperature; <b>W</b> signals are about water.</p>
  <p class="rules-intro">These are warning signs, not a pass/fail test. Each one carries an evidence tier that says how directly it applies to Scots pine:</p>
  <div class="tier-key">${["A", "B", "C"].map((x) => `<span>${tierTag(x)}${TIER_TEXT[x]}</span>`).join("")}</div>
  <div class="rule-groups">
    <div><h4>T · Temperature signals</h4>${RULES.filter((r) => r.driver === "temperature").map(ruleCardBrief).join("")}</div>
    <div><h4>W · Water signals</h4>${RULES.filter((r) => r.driver === "water").map(ruleCardBrief).join("")}</div>
  </div>
  <p class="src fineprint">Can't be checked with monthly data: single frost nights (T2, T3) and air dryness (A1, vapour-pressure deficit). Not in our data: CO₂, nitrogen, soil depth, slope, pests — all matter in real forests.</p>`;

/* ======================================================================
   5. Evidence board: full-screen map + evidence file
   ====================================================================== */
let zoomB = null, svgSel = null, projB = null;
function renderMap() {
  const box = $("board-body").getBoundingClientRect(), W = Math.max(320, Math.round(box.width)), H = Math.max(320, Math.round(box.height));
  const desktop = W > 760;
  const svg = d3.select("#map").attr("viewBox", `0 0 ${W} ${H}`);
  svg.selectAll("*").remove(); svgSel = svg;
  const proj = d3.geoNaturalEarth1().fitExtent([[0, 0], [W, H]], { type: "Sphere" }); projB = proj;
  const path = d3.geoPath(proj);
  const layer = svg.append("g");
  layer.append("rect").attr("x", -W).attr("y", -H).attr("width", 3 * W).attr("height", 3 * H).attr("fill", "#eef2fb");
  layer.append("path").datum(d3.geoGraticule10()).attr("class", "grat").attr("d", path);
  layer.append("g").selectAll("path").data(LAND.features).join("path").attr("class", "land").attr("d", path);
  const boxPath = ([w, s, e, n]) => {
    const pts = [], k = 12;
    for (let i = 0; i <= k; i++) pts.push([w + (e - w) * i / k, n]);
    for (let i = 0; i <= k; i++) pts.push([e, n - (n - s) * i / k]);
    for (let i = 0; i <= k; i++) pts.push([e - (e - w) * i / k, s]);
    for (let i = 0; i <= k; i++) pts.push([w, s + (n - s) * i / k]);
    return "M" + pts.map((p) => proj(p).map((v) => v.toFixed(1)).join(",")).join("L") + "Z";
  };
  const centre = (b) => proj([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
  const g = layer.append("g").selectAll("g").data(REGIONS).join("g")
    .attr("class", "region").attr("tabindex", 0).attr("role", "button").attr("aria-label", (d) => `${d.name}${d.home ? " (home)" : ""}: open the evidence file`);
  g.append("path").attr("class", "area").attr("d", (d) => boxPath(d.bbox));
  const pin = g.append("g").attr("class", "pin").attr("transform", (d) => `translate(${centre(d.bbox)})`).append("g").attr("class", "pin-s");
  pin.append("circle").attr("class", "pin-ring").attr("cy", -20).attr("r", 16).attr("stroke-width", 2);
  pin.append("circle").attr("class", "focus-ring").attr("cy", -19).attr("r", 19).attr("stroke-width", 3);
  pin.append("path").attr("class", "pin-body").attr("stroke-width", 2).attr("d", "M0,0 C-5,-7 -12,-12 -12,-20 A12,12 0 1 1 12,-20 C12,-12 5,-7 0,0Z");
  pin.append("circle").attr("class", "pin-dot").attr("cy", -20).attr("r", 4.5);
  pin.append("circle").attr("class", "hit").attr("cy", -16).attr("r", 24);
  pin.append("text").attr("class", "lbl").attr("x", (d) => (d.label[2] === "end" ? -16 : 16)).attr("y", -14).attr("text-anchor", (d) => d.label[2])
    .attr("font-size", 14).attr("stroke-width", 4).text((d) => (d.home ? "🏠 " : "") + d.name);

  const tip = $("tooltip");
  g.on("mousemove", (ev, d) => {
    tip.classList.remove("hidden");
    tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - 270) + "px"; tip.style.top = ev.clientY + 14 + "px";
    tip.innerHTML = `<b>${d.name}</b>${d.home ? " · 🏠 home" : ""}<br>${d.desc}<br><i>${d.playable ? "Click to open the evidence file" : "Missing records — can't be planted"}</i>`;
  }).on("mouseleave", () => tip.classList.add("hidden"))
    .on("click", (ev, d) => { tip.classList.add("hidden"); openRegion(d.id); })
    .on("keydown", (ev, d) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openRegion(d.id, true); } });

  function onZoom(t) {
    layer.attr("transform", t);
    layer.selectAll(".pin-s").attr("transform", `scale(${1 / t.k})`);
    layer.selectAll(".region .area").style("stroke-width", `${1.4 / t.k}px`);
    layer.selectAll(".land").style("stroke-width", `${0.5 / t.k}px`);
  }
  const zoom = d3.zoom().scaleExtent([1, 12]).translateExtent([[-W * .2, -H * .2], [W * 1.2, H * 1.2]]).on("zoom", (ev) => onZoom(ev.transform));
  zoomB = zoom;
  svg.call(zoom).on("dblclick.zoom", null);
  // frame all six pins inside the free area (leave room for the title card, the panel and the plant button)
  const fit = (ids, padK = .8) => {
    const regs = REGIONS.filter((r) => ids.includes(r.id));
    const pts = regs.flatMap((r) => [proj([r.bbox[0], r.bbox[1]]), proj([r.bbox[2], r.bbox[3]]), proj([r.bbox[0], r.bbox[3]]), proj([r.bbox[2], r.bbox[1]])]);
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])) - 30, y1 = Math.max(...pts.map((p) => p[1]));
    const L = desktop ? 40 : 20, R = desktop ? W - Math.min(510, W * .46) - 20 : W - 20, T = desktop ? 150 : 80, B = H - (desktop ? 70 : 150);
    const k = Math.min(12, padK * Math.min((R - L) / Math.max(1, x1 - x0), (B - T) / Math.max(1, y1 - y0)));
    return d3.zoomIdentity.translate((L + R) / 2 - k * (x0 + x1) / 2, (T + B) / 2 - k * (y0 + y1) / 2).scale(k);
  };
  map = { w: W, h: H, fit };
  const go = (t, ms) => (reduceMotion() ? svg.call(zoom.transform, t) : svg.transition().duration(ms).call(zoom.transform, t));
  $("zoom-in").onclick = () => (reduceMotion() ? svg.call(zoom.scaleBy, 1.6) : svg.transition().call(zoom.scaleBy, 1.6));
  $("zoom-out").onclick = () => (reduceMotion() ? svg.call(zoom.scaleBy, 1 / 1.6) : svg.transition().call(zoom.scaleBy, 1 / 1.6));
  $("zoom-europe").onclick = () => go(fit(REGIONS.map((r) => r.id)), 600);
  map.go = go;
  svg.call(zoom.transform, fit(REGIONS.map((r) => r.id)));
  updateMarks();
}
let resizeT = null;
window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (map && !$("s-board").classList.contains("hidden")) renderMap(); }, 200); });

function updateMarks() {
  d3.selectAll(".region").classed("sel", (d) => d.id === state.selected)
    .classed("visited", (d) => state.visited.has(d.id)).classed("nodata", (d) => !d.playable);
  $("examined").innerHTML = `EXAMINED <b>${state.visited.size}</b> / ${REGIONS.length}`;
}

function openRegion(id, viaKeyboard) {
  state.selected = id; state.visited.add(id);
  updateMarks(); renderPanel(); updatePlant();
  if (viaKeyboard) $("panel-title").focus();   // keyboard users land in the file; Escape takes them back to the pin
}
function closePanel() {
  $("dossier").classList.add("hidden");
  const g = [...document.querySelectorAll(".region")].find((e) => e.__data__.id === state.selected);
  if (g) g.focus({ preventScroll: true });
}

function renderPanel() {
  const reg = regionById(state.selected), D = DATA[reg.id], p = $("dossier");
  p.classList.remove("hidden");
  p.setAttribute("aria-label", `Evidence file: ${reg.name}`);
  const rows = VARS.map((v) => {
    const b = baseline(reg.id, v.id), missing = !D[v.id] || !fin(b), pinned = state.clue === v.id, ds = dsOf(v);
    return `<div class="evrow ${missing ? "missing" : ""} ${pinned ? "pinned-row" : ""}">
      <div class="nm">${v.name}<button class="info" aria-expanded="false" aria-controls="def-${v.id}" aria-label="What is ${v.name}?">i</button></div>
      <div class="val">${missing ? "Unavailable" : `${fmt(b)} <small>${v.units}</small>`}</div>
      <p class="why">${missing ? "No records on file for this region." : `<span class="rank">${rankPhrase(reg.id, v)}.</span> ${WHY[v.id]}`}</p>
      <div class="def hidden" id="def-${v.id}">
        <p>${v.def.split(/(?<=\.)\s/)[0]} <span class="src">${v.id === "ndvi" ? `<a href="${ds.url}" target="_blank" rel="noopener">MOD13A3 dataset</a>` : `<a href="${GLOSSARY_URL}" target="_blank" rel="noopener">Giovanni glossary: ${shortName(v)}</a>`}</span></p>
      </div>
      ${missing ? "" : `<div class="tools"><button class="pinclue" data-var="${v.id}" aria-pressed="${pinned}" aria-describedby="pin-help" data-tip="${PIN_HELP}">${pinned ? "📌 Your clue" : "Pin as my clue"}</button></div>`}
    </div>`;
  }).join("");
  p.innerHTML = `
    <div class="panel-head">
      <span class="label">Evidence file${reg.home ? " · 🏠 home" : ""}</span>
      <h3 id="panel-title" tabindex="-1">${reg.name}</h3>
      <p class="desc">${reg.desc}</p>
      <div class="period"><span class="obs-label">Baseline 2000–2004 · before planting</span></div>
      <button class="iconbtn panel-close" id="panel-close" aria-label="Close the evidence file and go back to the pins">✕</button>
    </div>
    <div class="panel-body">
      <p class="src">Each value is the average month of ${BASE_FROM}–${BASE_TO}, averaged over the area ${lat(reg.bbox[1])}–${lat(reg.bbox[3])}, ${lon(reg.bbox[0])}–${lon(reg.bbox[2])}. Records run monthly ${FIRST_YEAR}–${LAST_YEAR}.</p>
      ${rows}
      ${!reg.playable ? `<p class="note note-bad">Missing records — this region can't be planted.</p>` : ""}
      <p class="src" id="pin-help">${PIN_HELP}</p>
    </div>`;
  const openInfo = (b, open) => {
    const id = b.getAttribute("aria-controls").slice(4), d = $(b.getAttribute("aria-controls"));
    d.classList.toggle("hidden", !open); b.setAttribute("aria-expanded", String(open));
    open ? state.openInfo.add(id) : state.openInfo.delete(id);
  };
  p.querySelectorAll(".info").forEach((b) => {
    b.onclick = () => openInfo(b, b.getAttribute("aria-expanded") !== "true");
    if (state.openInfo.has(b.getAttribute("aria-controls").slice(4))) openInfo(b, true);
  });
  p.querySelectorAll(".pinclue").forEach((b) => (b.onclick = () => {
    state.clue = state.clue === b.dataset.var ? null : b.dataset.var;
    const keep = b.dataset.var, top = p.querySelector(".panel-body").scrollTop;
    renderPanel(); updatePlant();
    p.querySelector(".panel-body").scrollTop = top;
    const nb = p.querySelector(`.pinclue[data-var="${keep}"]`); if (nb) nb.focus({ preventScroll: true });
  }));
  $("panel-close").onclick = closePanel;
}
$("board-body").addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("dossier").classList.contains("hidden")) closePanel(); });

function updatePlant() {
  const reg = state.selected && regionById(state.selected), ok = !!(reg && reg.playable);
  $("plant").disabled = !ok;
  $("lockmsg").textContent = !reg ? "Pick a region on the map" : !reg.playable ? `${reg.name}: missing records`
    : `Site: ${reg.name.split(",")[0]}${state.clue ? ` · clue: ${varById(state.clue).name}` : ""}`;
}
$("plant").onclick = () => {
  const reg = regionById(state.selected); if (!reg || !reg.playable) return;
  state.locked = { regionId: reg.id, clueId: state.clue };
  $("plant").disabled = true; $("dossier").classList.add("hidden");
  const go = () => startReplay(state.locked.regionId, state.locked.clueId);
  if (reduceMotion() || !map) return go();
  svgSel.transition().duration(1100).call(zoomB.transform, map.fit([reg.id], .45)).on("end", go);
};

/* ======================================================================
   6. Replay 2005–2024 (20 annual records) — play / pause / scrub
   ====================================================================== */
// Vigour and growth only VISUALISE the tier-weighted stress. This is not a survival forecast.
function replay(regionId) {
  const R = DATA[regionId].rules, i0 = REPLAY_FROM - FIRST_YEAR;
  let vigour = 1, growth = 0;
  const years = R.years.slice(i0).map((yr) => {
    vigour = Math.max(0.15, Math.min(1, vigour - 0.35 * yr.stress + 0.12));
    growth += Math.max(0, 1 - 0.6 * Math.min(1, yr.stress));
    return { ...yr, vigour, growth };
  });
  const total = years.reduce((s, y) => s + y.stress, 0);
  const strongYears = years.filter((y) => y.strong).length;
  const anyYears = years.filter((y) => y.on.length).length;
  const drivers = { water: 0, temperature: 0 };
  years.forEach((y) => y.on.forEach((r) => (drivers[r.driver] += TIER_WEIGHT[r.tier])));
  const main = total ? (drivers.water >= drivers.temperature ? "water" : "temperature") : null;
  const multi = years.some((y) => y.on.some((r) => r.id === "W5"));
  // greenness check inside this region: stress years vs calm years (same year and next year)
  const pick = (lag, cond) => years.map((y, k) => (cond(y) && years[k + lag] ? years[k + lag].evi : NaN)).filter(fin);
  const evi0 = { a: avg(pick(0, (y) => y.strong)), b: avg(pick(0, (y) => !y.on.length)), n: pick(0, (y) => y.strong).length };
  const evi1 = { a: avg(pick(1, (y) => y.strong)), b: avg(pick(1, (y) => !y.on.length)), n: pick(1, (y) => y.strong).length };
  return { regionId, years, total, strongYears, anyYears, drivers, main, multi, evi0, evi1 };
}
function verdictOf(r) {
  if (r.strongYears <= 1 && r.total < 1.5) return { word: "Mostly calm", cls: "rise", short: "Mostly calm" };
  if (r.strongYears <= 4 && !r.multi) return { word: "Occasional stress", cls: "rise", short: "Occasional stress" };
  if (r.strongYears <= 9) return { word: "Frequent stress", cls: "grey", short: "Frequent stress" };
  return { word: "Chronic stress", cls: "fall", short: "Chronic stress" };
}


const RP = { regionId: null, clueId: null, r: null, k: 0, timer: null, varId: null };
const BAND = (v) => (v >= 0.7 ? "healthy" : v >= 0.4 ? "stressed" : "struggling");
function startReplay(regionId, clueId) {
  const reg = regionById(regionId);
  Object.assign(RP, { regionId, clueId, r: replay(regionId), k: 0, varId: clueId && DATA[regionId][clueId] ? clueId : (DATA[regionId].rain ? "rain" : "temp") });
  show("replay");
  $("replay-title").innerHTML = `Twenty years in <span class="swash blue">${reg.name.split(",")[0]}</span>`;
  $("replay-sub").textContent = `You planted your seed in ${reg.name}${clueId ? `, trusting the ${varById(clueId).name.toLowerCase()} clue` : ""}. Press Play, or drag the year slider.`;
  $("r-place").textContent = reg.name;
  $("sim-note").innerHTML = `The tree, its canopy condition and its growth are <b>simulated</b> by the game from the stress signals in the real records — not measured, and not a survival forecast.`;
  const mini = (v) => `<div class="mini ${v.id === clueId ? "is-clue" : ""}">
      <div class="mini-head"><span class="mini-name">${v.name}${v.id === clueId ? " 📌" : ""}</span><span class="mini-val" id="mv-${v.id}"></span></div>
      ${DATA[regionId][v.id] ? `<div class="mini-chart" id="rc-${v.id}" role="img" aria-label="${v.name}, annual values ${REPLAY_FROM}–${REPLAY_TO}"></div>` : `<p class="mini-na">Unavailable — no records on file for this region.</p>`}
      <p class="src">${v.units} · dashed = 2000–04 average${v.id === "ndvi" ? " · regional vegetation reading (all plants)" : ""}${v.lowConfidence ? " · low confidence" : ""}</p></div>`;
  $("charts-left").innerHTML = VARS.slice(0, 4).map(mini).join("");
  $("charts-right").innerHTML = VARS.slice(4).map(mini).join("");
  $("timeline").innerHTML = RP.r.years.map(() => "<span></span>").join("");
  $("to-verdict").classList.remove("ready");
  setYear(0, true);
}
function setYear(k, force) {
  k = Math.max(0, Math.min(RP.r.years.length - 1, k));
  if (k === RP.k && !force) return;
  RP.k = k;
  const r = RP.r, yr = r.years[k], reg = regionById(RP.regionId);
  $("scrub").value = yr.y; $("scrub").setAttribute("aria-valuetext", String(yr.y));
  $("r-year").textContent = yr.y;
  // simulated tree: size from growth, crown width and canopy colour from condition
  const gp = Math.min(1, yr.growth / (REPLAY_TO - REPLAY_FROM + 1)), s = 0.14 + 0.86 * gp, v = yr.vigour;
  const tree = $("r-tree");
  tree.style.transform = `translateX(-50%) scale(${(s * (0.78 + 0.22 * v)).toFixed(3)}, ${s.toFixed(3)})`;
  tree.style.filter = `saturate(${0.35 + 0.65 * v}) sepia(${((1 - v) * 0.75).toFixed(2)}) hue-rotate(${(-(1 - v) * 18).toFixed(0)}deg)`;
  tree.alt = `Your simulated Scots pine in ${yr.y}: canopy ${BAND(v)}, ${Math.round(v * 100)}% condition, ${Math.round(gp * 100)}% grown`;
  $("r-hp").textContent = `${Math.round(v * 100)}% · ${BAND(v)}`;
  $("r-hbar").style.width = `${v * 100}%`;
  $("r-hbar").style.background = v >= 0.7 ? "#8fd14f" : v >= 0.4 ? "#f2c76a" : "#e8836f";
  $("r-gp").textContent = `${Math.round(gp * 100)}%`;
  $("r-gbar").style.width = `${gp * 100}%`;
  // year log: squares appear as each year passes
  [...$("timeline").children].forEach((c, i) => {
    const y = r.years[i], cls = i <= k ? (!y.on.length ? "ok" : y.strong ? "bad" : "meh") : "";
    if (c.dataset.c !== cls) { c.className = cls; c.dataset.c = cls; }
    c.classList.toggle("now", i === k);
  });
  $("signals").innerHTML = !yr.on.length ? `<b>${yr.y}:</b> no stress signal from the Scots pine research.`
    : `<b>${yr.y}:</b> ${yr.on.map((x) => `${tierTag(x.tier, false)}<b>${x.id} ${x.name}</b>`).join(" · ")} <span class="src">${srcLinks([...new Set(yr.on.flatMap((x) => x.src))])}</span>`;
  drawReplayCharts();
  if (k === r.years.length - 1) $("to-verdict").classList.add("ready");
}
function drawReplayCharts() {
  const ys = YEARS.filter((y) => y >= REPLAY_FROM), cur = RP.r.years[RP.k].y, ink = "#1b2140";
  for (const v of VARS) {
    const have = !!DATA[RP.regionId][v.id], cv = yearVal(RP.regionId, v.id, cur);
    $(`mv-${v.id}`).innerHTML = !have ? "unavailable" : fin(cv) ? `${cur}: <b>${fmt(cv)}</b> ${v.units}` : `${cur}: gap`;
    if (!have) continue;
    const vals = ys.map((y) => { const x = yearVal(RP.regionId, v.id, y); return fin(x) ? x : null; }), base = baseline(RP.regionId, v.id);
    const shapes = [{ type: "line", x0: cur, x1: cur, yref: "paper", y0: 0, y1: 1, line: { color: "#2443d6", width: 2 } }];
    if (fin(base)) shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, y0: base, y1: base, line: { color: "#8a8fa6", width: 1, dash: "dash" } });
    Plotly.react(`rc-${v.id}`, [
      { x: ys, y: vals, type: "scatter", mode: "lines+markers", connectgaps: false, line: { color: "#2443d6", width: 1.6 }, marker: { size: 4, color: "#fff", line: { color: "#2443d6", width: 1.2 } }, hovertemplate: `%{x}: %{y:.3g} ${v.units}<extra></extra>` },
      { x: [cur], y: [fin(cv) ? cv : null], type: "scatter", mode: "markers", marker: { size: 10, color: "#b5ec7a", line: { color: ink, width: 2 } }, hoverinfo: "skip" },
    ], {
      margin: { l: 38, r: 6, t: 4, b: 20 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", showlegend: false, hovermode: "closest",
      font: { family: "DM Sans, system-ui, sans-serif", size: 9, color: "#4c5272" }, hoverlabel: { bgcolor: ink, font: { color: "#fff" } },
      xaxis: { range: [REPLAY_FROM - .5, REPLAY_TO + .5], tickvals: [2005, 2010, 2015, 2020, 2024], showgrid: false, linecolor: ink, tickfont: { family: "Space Mono, monospace", size: 9 } },
      yaxis: { gridcolor: "#e9e4d4", zeroline: false, nticks: 4, tickfont: { family: "Space Mono, monospace", size: 9 } }, shapes,
    }, { displayModeBar: false, responsive: true, staticPlot: false });
  }
}
function pause() { clearInterval(RP.timer); RP.timer = null; const b = $("play"); b.innerHTML = "▶ Play"; b.setAttribute("aria-pressed", "false"); }
function play() {
  if (RP.k >= RP.r.years.length - 1) setYear(0);
  const b = $("play"); b.innerHTML = "❚❚ Pause"; b.setAttribute("aria-pressed", "true");
  RP.timer = setInterval(() => { if (RP.k >= RP.r.years.length - 1) return pause(); setYear(RP.k + 1); }, 1000);
}
$("play").onclick = () => (RP.timer ? pause() : play());
$("scrub").oninput = (e) => { pause(); setYear(+e.target.value - REPLAY_FROM); };
$("to-verdict").onclick = () => { pause(); show("verdict"); renderVerdict(); };   // show first: charts need their on-screen width

/* ======================================================================
   7. Verdict — what happened, why, and how sure we are
   ====================================================================== */
function trendWord(d) { const up = d.result.mannKendall.senSlopePerDecade > 0; return d.sig ? (up ? "Rising" : "Falling") : (up ? "Slightly rising — not proven" : "Slightly falling — not proven"); }
function renderVerdict() {
  const r = RP.r, reg = regionById(r.regionId), verdict = verdictOf(r), D = DATA[r.regionId], R = D.rules, clue = RP.clueId && varById(RP.clueId);
  // the most informative trends: FDR-significant first (lowest q), then the rest; the pinned clue is always shown
  let picks = VARS.filter((v) => D[v.id]).sort((a, b) => (D[b.id].sig - D[a.id].sig) || (D[a.id].q - D[b.id].q)).slice(0, 3).map((v) => v.id);
  if (clue && D[clue.id] && !picks.includes(clue.id)) picks = [clue.id, ...picks.slice(0, 2)];
  else if (clue && picks.includes(clue.id)) picks = [clue.id, ...picks.filter((x) => x !== clue.id)];
  const trendCard = (id) => {
    const v = varById(id), d = D[id], mk = d.result.mannKendall, up = mk.senSlopePerDecade > 0, b = baseline(r.regionId, id), last = yearVal(r.regionId, id, LAST_YEAR);
    const cc = CROSSCHECK[r.regionId] && CROSSCHECK[r.regionId][id];
    return `<div class="trend">
      <div class="t-top"><h4>${v.name}</h4>${id === RP.clueId ? `<span class="fact clue">📌 Your clue</span>` : ""}</div>
      <div class="big ${d.sig ? (up ? "up" : "down") : ""}">${trendWord(d)}</div>
      <div class="then-now">${up ? "+" : "−"}${fmt(Math.abs(mk.senSlopePerDecade))} ${v.units} per decade · monthly record ${FIRST_YEAR}–${LAST_YEAR}<br>2000–04 average ${valTxt(b, v)} → ${LAST_YEAR}: ${valTxt(last, v)}</div>
      <p class="stat">${d.sig
        ? `<b>Statistically significant.</b> Mann-Kendall trend test (seasons removed, corrected for month-to-month persistence): ${pTxt(mk.p)}. After correcting for all ${NTESTS} trend tests in this game: ${qTxt(d.q)}. Very unlikely to be chance.`
        : `<b>Not statistically significant</b> (${pTxt(mk.p)}; ${qTxt(d.q)} after correcting for all ${NTESTS} trend tests). Read the direction as a description, not a proven trend.`}
        ${v.lowConfidence ? " ⚠ Low-confidence model variable." : ""}</p>
      ${cc ? `<div class="note ${cc[0] === "ok" ? "note-ok" : cc[0] === "bad" ? "note-bad" : ""}"><b>${cc[0] === "ok" ? "✓" : "⚠"} Cross-check:</b> ${cc[1]} <a href="${CROSSCHECK_URL}" target="_blank" rel="noopener">Source</a></div>` : ""}
      <div class="chart" id="vchart-${id}" role="img" aria-label="${v.name} at ${reg.name}: monthly differences from normal, ${FIRST_YEAR}–${LAST_YEAR}, with the straight-line trend"></div>
      <p class="src">Chart: monthly difference from normal (${v.units}) with the straight-line trend · ${dsOf(v).name}.</p>
    </div>`;
  };
  // ranking under the game's model (same rule, same records, every playable site)
  const all = REGIONS.filter((x) => x.playable).map((x) => replay(x.id)).sort((a, b) => a.total - b.total);
  const posOf = (o) => all.findIndex((x) => x.total === o.total) + 1;
  const rankItem = (o) => {
    const rg = regionById(o.regionId), RR = DATA[o.regionId].rules, ties = all.filter((x) => x !== o && x.total === o.total).map((x) => regionById(x.regionId).name);
    const lines = RULES.filter((x) => RR.avail[x.id]).map((x) => ({ x, n: o.years.filter((y) => y.on.includes(x)).length })).filter((c) => c.n)
      .sort((a, b) => b.n * TIER_WEIGHT[b.x.tier] - a.n * TIER_WEIGHT[a.x.tier]);
    const quiet = RULES.filter((x) => RR.avail[x.id] && !o.years.some((y) => y.on.includes(x))).map((x) => x.id);
    const noEval = RULES.filter((x) => !RR.avail[x.id]).map((x) => x.id);
    const missingVars = VARS.filter((v) => !DATA[o.regionId][v.id]).map((v) => v.name.toLowerCase());
    return `<li class="${o.regionId === r.regionId ? "mine" : ""}"><details>
      <summary><span class="pos">${posOf(o)}</span><span class="nm">${rg.home ? "🏠 " : ""}${rg.name}${o.regionId === r.regionId ? " 🌲 yours" : ""}<small>${verdictOf(o).short}${ties.length ? " · tied" : ""}</small></span>
        <span class="score">${o.total.toFixed(1)} stress · ${o.strongYears} strong yrs</span></summary>
      <div class="why">
        ${lines.length ? `<p>What drove the score (years fired × tier weight):</p><ul>${lines.map((c) => `<li>${tierTag(c.x.tier, false)}${c.x.id} ${c.x.name}: ${c.n} year${c.n > 1 ? "s" : ""} × ${TIER_WEIGHT[c.x.tier]} = ${(c.n * TIER_WEIGHT[c.x.tier]).toFixed(1)}</li>`).join("")}</ul>` : `<p>No stress signal fired here in ${REPLAY_FROM}–${REPLAY_TO}.</p>`}
        ${quiet.length ? `<p>Checked, never fired: ${quiet.join(", ")}.</p>` : ""}
        ${noEval.length ? `<p>Not evaluated (data missing): ${noEval.join(", ")}.</p>` : ""}
        ${missingVars.length ? `<p>Missing evidence: ${missingVars.join(", ")} — not used in the score.</p>` : ""}
        ${ties.length ? `<p>Tied with ${ties.join(", ")} (same score).</p>` : ""}
        <p>Main pressure: ${o.main || "—"}.</p>
      </div></details></li>`;
  };
  // key years: observed stress signals and simulated condition changes
  const ev = [];
  r.years.forEach((y, i) => {
    const prev = i ? BAND(r.years[i - 1].vigour) : BAND(1), now = BAND(y.vigour);
    const obs = y.on, sim = now !== prev ? { from: prev, to: now, pct: Math.round(y.vigour * 100) } : null;
    if (obs.length || sim) ev.push({ y: y.y, obs, sim });
  });
  const evItem = (e) => `<li id="ev-${e.y}"><div class="yr">${e.y}</div><div class="what">
      ${e.obs.map((x) => `<p><span class="obs-label">Observed · NASA records</span> ${tierTag(x.tier)}<b>${x.id} ${x.name}</b> — ${x.test}.</p><p class="why">Why it matters: ${x.effect} <span class="src">${srcLinks(x.src)}</span></p>`).join("")}
      ${e.sim ? `<p><span class="sim-label">Simulated</span> The game's tree went from “${e.sim.from}” to “${e.sim.to}” (${e.sim.pct}% canopy condition).</p><p class="why">Why it matters: the model lowers condition after stress signals and lets it recover a little in each calm year — a visual aid, not a forecast.</p>` : ""}
    </div></li>`;
  const firedRules = [...new Set(r.years.flatMap((y) => y.on))];
  const researchRules = firedRules.length ? firedRules : RULES.filter((x) => ["T1", "W4"].includes(x.id));
  const eviTxt = !fin(r.evi0.a) || r.evi0.n < 2 ? `<p>Not enough stress years with greenness data to check this region against the satellite.</p>`
    : `<p>In the ${r.evi0.n} strong-stress years, growing-season greenness here was <b>${r.evi0.a < r.evi0.b ? "lower" : "not lower"}</b> than in calm years (${(r.evi0.a - r.evi0.b >= 0 ? "+" : "") + (r.evi0.a - r.evi0.b).toFixed(3)} same year; ${fin(r.evi1.a) ? (r.evi1.a - r.evi1.b >= 0 ? "+" : "") + (r.evi1.a - r.evi1.b).toFixed(3) : "—"} the year after, in ${varById("ndvi").units} units). One region alone is too small a sample for a significance test — see the pooled test below.</p>`;
  const clueTxt = !clue ? `You didn't pin a clue — the evidence speaks for itself.`
    : !r.main ? `Your key clue was <b>${clue.name.toLowerCase()}</b>, and no strong stress signal fired here — your call held up.`
    : (r.main === "water" ? ["rain", "potevap", "soil"] : ["temp"]).includes(clue.id) ? `🕵️ <b>Sharp work, detective.</b> Your key clue — ${clue.name.toLowerCase()} — feeds the ${r.main} signals that dominated this case.`
    : `Your key clue was <b>${clue.name.toLowerCase()}</b>, but the dominant stress here was <b>${r.main}</b>, read from the ${(r.main === "water" ? ["rain", "potevap", "soil"] : ["temp"]).map((v) => varById(v).name.toLowerCase()).join(", ")} records.`;
  const pct = (i) => ((i - REPLAY_FROM) / (REPLAY_TO - REPLAY_FROM)) * 100;
  $("report").innerHTML = `
    <div class="verdict-head">
      <div><div class="kicker">Case report · ${reg.name} · ${REPLAY_FROM}–${REPLAY_TO}</div><h2 id="what-happened">What happened?</h2>
        <div class="facts"><span class="fact">📍 ${reg.name}</span><span class="fact ${clue ? "clue" : ""}">${clue ? `📌 Your clue: ${clue.name}` : "No clue pinned"}</span><span class="fact">20 annual records</span></div></div>
      <span class="stamp big thud ${verdict.cls}">${verdict.word}</span>
    </div>
    <p class="outcome">Under the game's model, your simulated Scots pine had <b>${verdict.word.toLowerCase()}</b>: strong stress signals (tier A or B) fired in <b>${r.strongYears} of 20 years</b>, any signal in ${r.anyYears}${r.main ? `, mainly from <b>${r.main}</b>` : ""}.${r.multi ? " There was at least one <b>multi-year drought</b> — the pattern linked to long-term decline." : ""}</p>
    <p class="outcome sub">${clueTxt}</p>

    <section class="v-sec"><h3>The clearest trends at this site</h3>
      <p>Trend tests use the full monthly record ${FIRST_YEAR}–${LAST_YEAR} with the seasonal cycle removed, so a single hot summer or wet winter doesn't count as a trend. Hover the charts to inspect each month.</p>
      <div class="trends">${picks.map(trendCard).join("")}</div>
    </section>

    <section class="v-sec"><h3>Key years</h3>
      <p>Years when the NASA records crossed a research stress threshold (<span class="obs-label">observed</span>) or the game's tree changed condition (<span class="sim-label">simulated</span>).</p>
      ${ev.length ? `<div class="events-axis" aria-hidden="true">${[2005, 2010, 2015, 2020, 2024].map((y) => `<span class="tick" style="left:${pct(y)}%">${y}</span>`).join("")}
        ${ev.map((e) => `<a href="#ev-${e.y}" tabindex="-1" class="${e.obs.length && e.sim ? "both" : e.obs.length ? "obs" : "sim"}" style="left:${pct(e.y)}%" title="${e.y}"></a>`).join("")}</div>
        <ol class="events">${ev.map(evItem).join("")}</ol>` : `<p>No stress signals fired and the simulated tree's condition never changed in ${REPLAY_FROM}–${REPLAY_TO}.</p>`}
    </section>

    <section class="v-sec"><h3>How the six sites compare</h3>
      <p><b>Ranking rule (the game's model):</b> every year a research stress signal fires adds its tier weight — A = 1, B = 0.5, C = 0.2 (the research's suggested starting weights). Lower total = calmer. The same rules, the same 20 years and the same NASA records are used for every site. These are outcomes under the game's model, not a forecast. Open a site to see what drove its place.</p>
      <ol class="rank-list">${all.map(rankItem).join("")}</ol>
    </section>

    <section class="v-sec"><h3>Did satellite greenness agree?</h3>
      ${eviTxt}
      <p>Across all regions, tested against MODIS greenness (false-discovery-rate corrected):</p>
      <ul class="rulelist">${RULES.map((x) => { const s = ruleSupport(x.id); return `<li>${tierTag(x.tier)}<b>${x.id}</b> ${x.name}: <span class="${s.cls}-t">${s.txt}</span></li>`; }).join("")}</ul>
    </section>

    <section class="v-sec"><h3>What the research says</h3>
      <div class="research">
        <div><h4>Scots pine studies</h4><ul class="rulelist">${researchRules.map((x) => `<li>${tierTag(x.tier)}<b>${x.id} ${x.name}:</b> ${x.effect} <span class="src">${srcLinks(x.src)}</span></li>`).join("")}</ul></div>
        <div><h4>Choosing a planting site</h4><p>Look at how often the bad years come — and whether they come back to back — not just the average climate. A site can look fine on average while drifting toward the conditions that stress the tree, so check the trend as well as today's numbers.</p></div>
      </div>
    </section>

    <details class="how"><summary>How this explanation works</summary><div class="how-body">
      <h4>Data</h4><ul>
        <li><a href="${DATASETS.gldas.url}" target="_blank" rel="noopener">${DATASETS.gldas.name}</a> — ${DATASETS.gldas.via}. Seven clues: ${VARS.filter((v) => v.id !== "ndvi").map((v) => `${v.name.toLowerCase()} (<code>${shortName(v)}</code>)`).join(", ")}.</li>
        <li><a href="${DATASETS.modis.url}" target="_blank" rel="noopener">${DATASETS.modis.name}</a> — ${DATASETS.modis.via}. ${varById("ndvi").name}: a regional vegetation reading.</li>
        <li>Variable definitions: <a href="${GLOSSARY_URL}" target="_blank" rel="noopener">Giovanni variable glossary</a>.</li>
        <li>Coverage: six areas, values averaged over each area; monthly ${FIRST_YEAR}–${LAST_YEAR}; gaps are never filled. ${$("data-line").textContent}</li>
        <li>Annual records = the mean of that year's monthly values, only when at least 10 of 12 months exist (otherwise shown as a gap). Baseline = mean of ${BASE_FROM}–${BASE_TO}.</li></ul>
      <h4>Trend tests</h4><p>Seasonal cycle removed; Mann-Kendall test with the Hamed-Rao correction (12-month lag) and Sen's slope; Benjamini-Hochberg false-discovery-rate correction across all ${NTESTS} trend tests; least-squares trend with 95% interval as a second check.</p>
      <h4>Stress rules</h4><ul class="rulelist">${RULES.map((x) => `<li>${tierTag(x.tier)}<b>${x.id} ${x.name}</b> — ${x.test}. <span class="src">${srcLinks(x.src)}</span></li>`).join("")}</ul>
      <h4>Simulated tree</h4><p>Each year, canopy condition = previous condition − 0.35 × (tier-weighted stress) + 0.12, kept between 15% and 100%; growth adds up to one unit per year, less in stressed years. It only visualises the stress signals — it is not a survival forecast.</p>
      <h4>Who writes this text</h4><p>No AI model is connected. Every sentence on this page is assembled by fixed rules in the game's code from numbers the code computes from the records above.</p>
      <h4>Sources</h4><ul>${Object.entries(SOURCES).map(([k, s]) => `<li><b>${k}</b> <a href="${s.url}" target="_blank" rel="noopener">${s.cite}</a></li>`).join("")}<li>Temperature cross-check: <a href="${CROSSCHECK_URL}" target="_blank" rel="noopener">Copernicus, European State of the Climate 2025</a></li></ul>
    </div></details>

    <div class="actions">
      <button class="btn" id="again">Try another site <span class="arrow" aria-hidden="true">→</span></button>
    </div>
    <p class="src fineprint">What this is — and isn't: stress signals from published Scots pine studies, evaluated on NASA monthly records and tested against MODIS greenness (which covers all vegetation, not just pines). The research gives warning signs, not a pass/fail rule, so this is a stress record, not a forecast of whether a tree lives or dies. Not in the data: single frost nights, air dryness (VPD), CO₂, nitrogen, soil depth, slope, pests.</p>
    <div class="corner"></div>`;
  picks.forEach((id) => drawTrend(D[id], varById(id), `vchart-${id}`));
  $("again").onclick = () => { state.locked = null; show("board"); renderMap(); if (state.selected) renderPanel(); updatePlant(); };
}
function drawTrend(d, v, el) {
  const res = d.result, mk = res.mannKendall, lin = res.linear, ink = "#1b2140";
  const color = !d.sig ? "#a3a8ba" : mk.senSlopePerDecade > 0 ? C.rise : C.fall;
  const t0 = new Date(d.dates[0]).getTime(), yrs = d.dates.map((x) => (new Date(x).getTime() - t0) / (365.25 * 864e5));
  Plotly.react(el, [
    { x: d.dates, y: res.anomalies.map((x) => (fin(x) ? x : null)), type: "scatter", mode: "lines", line: { color: C.anom, width: 1 }, hovertemplate: `%{x|%b %Y}: %{y:+.3g} ${v.units}<extra>vs normal</extra>` },
    { x: d.dates, y: yrs.map((t) => lin.intercept + lin.slopePerYear * t), type: "scatter", mode: "lines", line: { color, width: 3 }, hoverinfo: "skip" },
  ], {
    margin: { l: 44, r: 6, t: 6, b: 26 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", showlegend: false, hovermode: "closest",
    font: { family: "DM Sans, system-ui, sans-serif", size: 10, color: "#4c5272" }, hoverlabel: { bgcolor: ink, font: { color: "#fff" } },
    xaxis: { showgrid: false, linecolor: ink, tickfont: { family: "Space Mono, monospace", size: 9 } },
    yaxis: { gridcolor: "#e9e4d4", zeroline: false, tickfont: { family: "Space Mono, monospace", size: 9 }, title: { text: v.units, font: { size: 10 } } },
    shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "#cfcab9", width: 1 } }],
  }, { displayModeBar: false, responsive: true });
}

/* ======================================================================
   8. Start
   ====================================================================== */
function boot(REAL) {
  prepare(REAL); buildAnnual();
  $("nodata").classList.add("hidden");
  $("board-body").classList.remove("hidden");
  map = { w: 0, h: 0 };   // rendered when the board is first shown (it needs its on-screen size)
  window.D2 = { DATA, REGIONS, RULES, VARS, ANNUAL, baseline, yearVal, replay, RP, state, RULE_TEST: () => RULE_TEST };
}
function noData() {
  REGIONS.forEach((r) => (r.playable = false));
  $("nodata").classList.remove("hidden");
  $("board-body").classList.add("hidden");
  $("data-line").textContent = "No climate records loaded — this game only uses real NASA data. Run pipeline/build_data.py.";
}
$("datafile").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const j = JSON.parse(await f.text()); if (!j.regions || !j.dates) throw new Error("not a game_data.json file"); boot(j); renderMap(); }
  catch (err) { $("datafile-msg").textContent = `Couldn't read that file: ${err.message}`; }
};
(async function start() {
  try { const r = await fetch("data/game_data.json", { cache: "no-cache" }); if (!r.ok) throw new Error("no data file"); boot(await r.json()); }
  catch (e) { noData(); }
  show("home");
})();
})();
