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
   3. Navigation + species guide
   ====================================================================== */
const state = { visited: new Set(), selected: null, varId: "temp", showRaw: false };
let map = null;
function show(id) {
  ["home", "brief", "board", "replay"].forEach((s) => $(`s-${s}`).classList.toggle("hidden", s !== id));
  document.querySelectorAll(".steps span").forEach((el) => el.classList.toggle("on", el.dataset.step === id));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("home-link").onclick = () => show("home");
$("start").onclick = () => show("brief");
$("to-board").onclick = () => show("board");
$("guide-toggle").onclick = () => {
  const g = $("guide"), open = g.classList.toggle("hidden") === false;
  $("guide-toggle").setAttribute("aria-expanded", String(open));
  g.innerHTML = `
    <div>${PINE.loves.map((x) => `<span class="pill">✓ ${x}</span>`).join("")}${PINE.hates.map((x) => `<span class="pill bad">✗ ${x}</span>`).join("")}</div>
    <p style="font-size:.85rem;color:var(--ink-soft);margin-top:10px"><b>Stress signals from the research.</b> These are warning signs measured in studies, not a pass/fail test. Each carries an evidence tier:
      <b>A</b> = Scots pine, measured threshold · <b>B</b> = Scots pine, direction only · <b>C</b> = other species, context only.</p>
    <ul class="rulelist">${RULES.map((r) => `<li><span class="tier t${r.tier}">${r.tier}</span><b>${r.id} ${r.name}</b> — ${r.test}. <span class="src">${srcLinks(r.src)}</span></li>`).join("")}</ul>
    <p class="src" style="margin-top:8px">Can't be checked with monthly data: single frost nights (T2, T3) and air dryness (A1, vapour-pressure deficit). Not in our data: CO₂, nitrogen, soil depth, slope, pests — all matter in real forests.</p>`;
};

/* ======================================================================
   4. Map
   ====================================================================== */
function renderMap() {
  const svg = d3.select("#map"), W = 640, H = 400;
  svg.selectAll("*").remove();
  const proj = d3.geoNaturalEarth1().fitExtent([[10, 10], [W - 10, H - 10]], { type: "Sphere" });
  const path = d3.geoPath(proj);
  const layer = svg.append("g");
  layer.append("rect").attr("width", W).attr("height", H).attr("fill", "#eef2fb");
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
    .attr("class", "region").attr("tabindex", 0).attr("role", "button").attr("aria-label", (d) => `Open the ${d.name} file`);
  g.append("circle").attr("class", "halo").attr("transform", (d) => `translate(${centre(d.bbox)})`).attr("r", 10);
  g.append("path").attr("class", "area").attr("d", (d) => boxPath(d.bbox));
  g.append("text").attr("class", "lbl")
    .attr("transform", (d) => { const [w, s, e, n] = d.bbox; return `translate(${proj([d.label[2] === "end" ? w : e, (s + n) / 2])})`; })
    .attr("text-anchor", (d) => d.label[2]).text((d) => (d.home ? "🏠 " : "") + d.name);

  const tip = $("tooltip");
  g.on("mousemove", (ev, d) => {
    tip.classList.remove("hidden");
    tip.style.left = ev.clientX + 14 + "px"; tip.style.top = ev.clientY + 14 + "px";
    const R = DATA[d.id] && DATA[d.id].rules;
    const rows = !R ? "Missing records" : RULES.filter((r) => R.avail[r.id]).map((r) => {
      const n = R.fired[r.id].filter(Boolean).length; return `${n ? "●" : "○"} ${r.name}: ${n} of ${YEARS.length} years`;
    }).join("<br>");
    tip.innerHTML = `<b>${d.name}</b><br>${rows}<br><i style="opacity:.7">${d.playable ? "Click to open the file" : "Missing data — can't be planted"}</i>`;
  }).on("mouseleave", () => tip.classList.add("hidden"))
    .on("click", (ev, d) => openRegion(d.id))
    .on("keydown", (ev, d) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openRegion(d.id); } });

  function onZoom(k, t) {
    if (t) layer.attr("transform", t);
    layer.selectAll(".region text").style("font-size", `${11 / k}px`).style("stroke-width", `${3 / k}px`)
      .attr("dx", (d) => d.label[0] / k).attr("dy", (d) => (d.label[1] + 4) / k).style("display", k < 1.8 ? "none" : null);
    layer.selectAll(".region .area").style("stroke-width", `${1.4 / k}px`);
    layer.selectAll(".region .halo").attr("r", 10 / k).style("stroke-width", `${2 / k}px`).style("display", k >= 3 ? "none" : null);
  }
  const zoom = d3.zoom().scaleExtent([1, 9]).translateExtent([[0, 0], [W, H]]).on("zoom", (ev) => onZoom(ev.transform.k, ev.transform));
  svg.call(zoom);
  // fit all six regions
  const fitAll = () => {
    const pts = REGIONS.flatMap((r) => [proj([r.bbox[0], r.bbox[1]]), proj([r.bbox[2], r.bbox[3]]), proj([r.bbox[0], r.bbox[3]]), proj([r.bbox[2], r.bbox[1]])]);
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
    const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    const k = Math.min(9, 0.85 * Math.min(W / (x1 - x0), H / (y1 - y0)));
    return d3.zoomIdentity.translate(W / 2 - k * (x0 + x1) / 2, H / 2 - k * (y0 + y1) / 2).scale(k);
  };
  $("zoom-in").onclick = () => svg.transition().call(zoom.scaleBy, 1.6);
  $("zoom-out").onclick = () => svg.transition().call(zoom.scaleBy, 1 / 1.6);
  $("zoom-europe").onclick = () => svg.transition().duration(600).call(zoom.transform, fitAll());
  $("zoom-reset").onclick = () => svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity);
  svg.call(zoom.transform, fitAll());
  map = true;
  updateMarks();
}
function updateMarks() {
  d3.selectAll(".region").classed("sel", (d) => d.id === state.selected)
    .classed("visited", (d) => state.visited.has(d.id)).classed("nodata", (d) => !d.playable);
  $("examined").innerHTML = `EXAMINED <b>${state.visited.size}</b> / ${REGIONS.length}`;
}

/* ======================================================================
   5. Region dossier
   ====================================================================== */
function openRegion(id) { state.selected = id; state.visited.add(id); updateMarks(); renderDossier(); renderCall(); }

function ruleStrip(R, r) {
  return `<div class="strip" title="${r.id}: years it fired">${YEARS.map((y, i) => `<i class="${R.fired[r.id][i] ? "on t" + r.tier : ""}" title="${y}${R.fired[r.id][i] ? " — fired" : ""}"></i>`).join("")}</div>`;
}
function ruleCard(R, r) {
  const n = R.fired[r.id].filter(Boolean).length, sup = ruleSupport(r.id);
  return `<div class="rulecard">
    <div class="rc-head"><span class="tier t${r.tier}" title="${TIER_TEXT[r.tier]}">${r.tier}</span><b>${r.id} · ${r.name}</b><span class="rc-n">${n} of ${YEARS.length} years</span></div>
    <div class="rc-test">${r.test}</div>
    ${ruleStrip(R, r)}
    <div class="rc-foot">${r.effect} <span class="src">Source ${srcLinks(r.src)} · tier ${r.tier} (${TIER_TEXT[r.tier]}) · <span class="${sup.cls}-t">${sup.txt}</span></span></div>
  </div>`;
}

function renderDossier() {
  const reg = regionById(state.selected), D = DATA[reg.id];
  if (!D[state.varId]) {
    const first = VARS.find((x) => D[x.id]);
    if (!first) { $("dossier").innerHTML = `<h2>${reg.name}</h2><p class="lead">No records on file for this region yet.</p>`; return; }
    state.varId = first.id;
  }
  const v = varById(state.varId), d = D[v.id], res = d.result, mk = res.mannKendall, lin = res.linear, q = d.quality;
  const up = mk.senSlopePerDecade > 0;
  const word = d.sig ? (up ? "Rising" : "Falling") : (up ? "Slightly rising — not proven" : "Slightly falling — not proven");
  const R = D.rules;
  const myRules = R ? RULES.filter((r) => r.vars.includes(v.id) && R.avail[r.id]) : [];
  const allFired = R ? RULES.filter((r) => R.avail[r.id]).map((r) => `<span class="chip ${R.fired[r.id].some(Boolean) ? "on" : ""}"><span class="tier t${r.tier}">${r.tier}</span>${r.id} ${r.name} · ${R.fired[r.id].filter(Boolean).length}</span>`).join("") : "";
  $("dossier").innerHTML = `
    <div>
      <div class="kicker" style="font-size:.68rem">Region file${reg.home ? " · 🏠 home" : ""}</div>
      <h2 style="margin-top:6px">${reg.name}</h2>
      <p style="color:var(--ink-soft);margin-top:4px">${reg.desc}</p>
      <div class="meta">AREA ${lat(reg.bbox[1])}–${lat(reg.bbox[3])} · ${lon(reg.bbox[0])}–${lon(reg.bbox[2])} · VALUES AVERAGED OVER THE AREA</div>
    </div>
    ${R ? `<div><div class="kicker" style="font-size:.66rem;margin-bottom:6px">Stress signals 2000–2024 (years fired)</div><div class="chips">${allFired}</div></div>` : ""}
    <div class="cluetabs" role="tablist">
      ${VARS.map((x) => `<button role="tab" data-var="${x.id}" class="${x.key ? "key" : ""}" aria-selected="${x.id === v.id}" ${D[x.id] ? "" : "disabled title='No data on file'"}>${x.name}${D[x.id] ? "" : " · no data"}</button>`).join("")}
    </div>
    <div class="legend-line"><i></i>Black-edged clues feed the research's stress signals. The others are supporting clues.</div>
    <div>
      <div class="chart-head"><h3>${state.showRaw ? "Monthly records" : "Seasons removed — is there a trend?"}</h3>
        <label class="toggle"><input type="checkbox" id="raw" ${state.showRaw ? "checked" : ""}/> raw records</label></div>
      <div class="chart" id="chart"></div>
      <div class="src">${v.def} SOURCE: ${v.source}${q ? ` · ${q.points_used ? q.points_used + " GRID POINTS · " : ""}${q.months_total - q.months_missing}/${q.months_total} MONTHS${q.months_missing ? " (GAPS LEFT EMPTY)" : ""}${q.values_removed ? ` · ${q.values_removed} IMPOSSIBLE VALUES REMOVED` : ""}` : ""}</div>
    </div>
    <div class="finding">
      <span class="stamp ${d.sig ? (up ? "rise" : "fall") : "grey"}" style="flex:none;margin-top:4px">${d.sig ? "Significant" : "Not proven"}</span>
      <div class="txt"><strong>${word}</strong><p>${v.name} ${up ? "rose" : "fell"} by about ${fmt(Math.abs(mk.senSlopePerDecade))} ${v.units} per decade. ${pTxt(mk.p)}; after correcting for all ${NTESTS} trend tests on this site (false discovery rate) ${qTxt(d.q)} — ${d.sig ? "still significant." : "not significant."}${v.lowConfidence ? " ⚠ Low-confidence model variable." : ""}</p></div>
    </div>
    <div class="tests">
      <div class="tag"><h4>Mann-Kendall · Sen's slope</h4><dl>
        <dt>Rate</dt><dd>${signed(mk.senSlopePerDecade)} ${v.units}/decade</dd>
        <dt>Ups vs downs</dt><dd>${(mk.tau * 100).toFixed(0)}%</dd>
        <dt>Evidence</dt><dd>${pTxt(mk.p)} · ${qTxt(d.q)}</dd></dl></div>
      <div class="tag"><h4>Straight line · t-test</h4><dl>
        <dt>Rate</dt><dd>${signed(lin.slopePerDecade)} ${v.units}/decade</dd>
        <dt>95% range</dt><dd>${signed(lin.slopePerDecade - lin.ciPerDecade, lin.slopePerDecade)} to ${signed(lin.slopePerDecade + lin.ciPerDecade, lin.slopePerDecade)}</dd>
        <dt>Evidence</dt><dd>${pTxt(lin.p)}</dd></dl></div>
    </div>
    ${CROSSCHECK[reg.id] && CROSSCHECK[reg.id][v.id] ? `<div class="note" style="${CROSSCHECK[reg.id][v.id][0] === "ok" ? "background:#eef8e2;border-color:#cfe9b0" : CROSSCHECK[reg.id][v.id][0] === "bad" ? "background:#fdeeea;border-color:#f2cdc4" : ""}"><b>${CROSSCHECK[reg.id][v.id][0] === "ok" ? "✓" : "⚠"} Cross-check:</b> ${CROSSCHECK[reg.id][v.id][1]} <a href="${CROSSCHECK_URL}" target="_blank" rel="noopener">Source</a></div>` : ""}
    ${res.testsDisagree ? `<div class="note"><b>The two tests disagree.</b> Months are "sticky" — a dry month is often followed by another — so the straight-line test can be over-confident. Mann-Kendall is corrected for this; trust it more.</div>` : ""}
    ${myRules.length ? `<div><div class="kicker" style="font-size:.66rem;margin-bottom:8px">Pine stress signals that use this clue</div>${myRules.map((r) => ruleCard(R, r)).join("")}</div>`
      : `<div class="note" style="background:#f4f6ff;border-color:#d5ddff">🔎 Supporting clue — no stress rule uses it directly. ${v.id === "ndvi" ? "Greenness is how we TEST the rules: if a rule matters, greenness should dip in the years it fires." : v.id === "evap" ? "The research gives evaporation low weight (E1): context for the water balance." : v.id === "sun" ? "The research gives no sunlight threshold (L1): Scots pine needs full sun, but light rarely limits it in Europe." : "Topsoil reacts before the root zone does."}</div>`}`;
  $("dossier").querySelectorAll(".cluetabs button").forEach((b) => (b.onclick = () => { state.varId = b.dataset.var; renderDossier(); }));
  $("raw").onchange = (e) => { state.showRaw = e.target.checked; renderDossier(); };
  drawChart(d, v);
}

function drawChart(d, v) {
  const res = d.result, mk = res.mannKendall, lin = res.linear;
  const color = !d.sig ? C.muted : mk.senSlopePerDecade > 0 ? C.rise : C.fall;
  const layout = {
    margin: { l: 52, r: 10, t: 6, b: 28 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "DM Sans, sans-serif", size: 11, color: "#4c5272" }, showlegend: false, hovermode: "x unified",
    xaxis: { showgrid: false, linecolor: "#cfcab9" },
    yaxis: { gridcolor: "#ebe7da", zeroline: false, title: { text: state.showRaw ? v.units : `vs normal (${v.units})` } },
  };
  const t0 = new Date(d.dates[0]).getTime();
  const yrs = d.dates.map((x) => (new Date(x).getTime() - t0) / (365.25 * 864e5));
  const traces = state.showRaw
    ? [{ x: d.dates, y: d.values.map((x) => (fin(x) ? x : null)), type: "scatter", mode: "lines", line: { color: C.line, width: 1.3 }, hovertemplate: `%{y:.3g} ${v.units}<extra></extra>` }]
    : [{ x: d.dates, y: res.anomalies.map((x) => (fin(x) ? x : null)), type: "scatter", mode: "lines", line: { color: C.anom, width: 1 }, hovertemplate: `%{y:+.3g} ${v.units}<extra>vs normal</extra>` },
       { x: d.dates, y: yrs.map((t) => lin.intercept + lin.slopePerYear * t), type: "scatter", mode: "lines", line: { color, width: 3 }, hoverinfo: "skip" }];
  if (!state.showRaw) layout.shapes = [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "#cfcab9", width: 1 } }];
  Plotly.react("chart", traces, layout, { displayModeBar: false, responsive: true });
}

/* ======================================================================
   6. Make your call (one seed)
   ====================================================================== */
function renderCall() {
  const cur = $("pick-region").value, curC = $("pick-clue").value;
  $("pick-region").innerHTML = `<option value="">Choose a region…</option>` + REGIONS.map((r) => {
    const off = !r.playable || !state.visited.has(r.id);
    const why = !r.playable ? " (missing data)" : !state.visited.has(r.id) ? " (not examined yet)" : "";
    return `<option value="${r.id}" ${off ? "disabled" : ""} ${cur === r.id ? "selected" : ""}>${r.home ? "🏠 " : ""}${r.name}${why}</option>`;
  }).join("");
  $("pick-clue").innerHTML = `<option value="">Choose a clue…</option>` + VARS.map((v) => `<option value="${v.id}" ${curC === v.id ? "selected" : ""}>${v.name}</option>`).join("");
  updateCall();
}
function updateCall() {
  const all = state.visited.size === REGIONS.length, r = $("pick-region").value, c = $("pick-clue").value;
  $("plant").disabled = !(all && r && c);
  $("lockmsg").textContent = !all ? `Examine all ${REGIONS.length} regions first — ${state.visited.size} of ${REGIONS.length} done.`
    : !r ? "Choose your planting site." : !c ? "Which clue convinced you?" : "Ready. You only get one seed — sure?";
}
$("pick-region").onchange = updateCall;
$("pick-clue").onchange = updateCall;
$("plant").onclick = () => startReplay($("pick-region").value, $("pick-clue").value, $("pick-note").value.trim());

/* ======================================================================
   7. Replay 2005–2024: real years, real stress signals
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

let timer = null;
function startReplay(regionId, clueId, note) {
  const reg = regionById(regionId), r = replay(regionId);
  show("replay");
  $("report").classList.add("hidden");
  $("replay-title").innerHTML = `Twenty years in <span class="swash blue">${reg.name.split(",")[0]}</span>`;
  $("r-place").textContent = reg.name;
  $("timeline").innerHTML = r.years.map(() => "<span></span>").join("");
  let k = -1;
  const step = () => { k++; drawYear(r, k); if (k < r.years.length - 1) timer = setTimeout(step, 520); else finishCase(r, clueId, note); };
  $("skip").onclick = () => { clearTimeout(timer); while (k < r.years.length - 1) { k++; drawYear(r, k); } finishCase(r, clueId, note); };
  drawYear(r, -1);
  timer = setTimeout(step, 600);
}

function drawYear(r, k) {
  const yr = k < 0 ? { y: REPLAY_FROM, vigour: 1, growth: 0, on: [], stress: 0 } : r.years[k];
  const gp = Math.min(1, yr.growth / (REPLAY_TO - REPLAY_FROM + 1));
  const tree = $("r-tree");
  tree.style.transform = `translateX(-50%) scale(${0.1 + 0.9 * gp})`;
  tree.style.filter = `saturate(${0.3 + 0.7 * yr.vigour}) sepia(${(1 - yr.vigour) * 0.7})`;
  $("r-year").textContent = yr.y;
  $("r-hp").textContent = `${Math.round(yr.vigour * 100)}%`;
  $("r-hbar").style.width = `${yr.vigour * 100}%`;
  $("r-hbar").style.background = yr.vigour > 0.7 ? "#8fd14f" : yr.vigour > 0.4 ? "#f2c76a" : "#e8836f";
  $("r-gp").textContent = `${Math.round(gp * 100)}%`;
  $("r-gbar").style.width = `${gp * 100}%`;
  if (k >= 0) {
    const cell = $("timeline").children[k];
    cell.className = !yr.on.length ? "ok" : yr.strong ? "bad" : "meh";
    cell.title = `${yr.y}: ${yr.on.length ? yr.on.map((x) => x.id).join(", ") : "no stress signal"}`;
  }
  $("readout").innerHTML = `<tr><th>${yr.y}</th><th>Stress signal</th><th>Tier</th><th>Source</th></tr>` +
    (k < 0 ? `<tr><td colspan="4" class="src">Planting…</td></tr>`
      : !yr.on.length ? `<tr><td></td><td class="ok-t">No stress signal this year</td><td></td><td></td></tr>`
      : yr.on.map((x) => `<tr><td>${x.id}</td><td>${x.name}</td><td><span class="tier t${x.tier}">${x.tier}</span></td><td class="src">${srcLinks(x.src)}</td></tr>`).join(""));
}

function finishCase(r, clueId, note) {
  const reg = regionById(r.regionId), verdict = verdictOf(r), clue = varById(clueId), R = DATA[r.regionId].rules;
  const counts = RULES.filter((x) => R.avail[x.id]).map((x) => {
    const yrs = r.years.filter((y) => y.on.includes(x)).map((y) => y.y);
    return { x, yrs };
  });
  const fired = counts.filter((c) => c.yrs.length).map((c) =>
    `<li><span class="tier t${c.x.tier}">${c.x.tier}</span><b>${c.x.id} ${c.x.name}</b> — ${c.yrs.length} of 20 years (${c.yrs.join(", ")}). ${c.x.effect} <span class="src">${srcLinks(c.x.src)}</span></li>`).join("");
  const unavailable = RULES.filter((x) => !R.avail[x.id]).map((x) => x.id);
  const mainVars = r.main === "water" ? ["rain", "potevap", "soil"] : r.main === "temperature" ? ["temp"] : [];
  const clueTxt = !r.main
    ? `Your key clue was <b>${clue.name.toLowerCase()}</b>, and no strong stress signal fired here — your call held up.`
    : mainVars.includes(clueId) ? `🕵️ <b>Sharp work, detective.</b> Your key clue — ${clue.name.toLowerCase()} — feeds the ${r.main} signals that dominated this case.`
    : `Your key clue was <b>${clue.name.toLowerCase()}</b>, but the dominant stress here was <b>${r.main}</b>, read from the ${mainVars.map((v) => varById(v).name.toLowerCase()).join(", ")} records.`;
  const eviTxt = !fin(r.evi0.a) || r.evi0.n < 2 ? `<p>Not enough stress years with greenness data to check this region against the satellite.</p>`
    : `<p>In the ${r.evi0.n} strong-stress years, growing-season greenness here was <b>${r.evi0.a < r.evi0.b ? "lower" : "not lower"}</b> than in calm years (${(r.evi0.a - r.evi0.b >= 0 ? "+" : "") + (r.evi0.a - r.evi0.b).toFixed(3)} same year; ${fin(r.evi1.a) ? (r.evi1.a - r.evi1.b >= 0 ? "+" : "") + (r.evi1.a - r.evi1.b).toFixed(3) : "—"} the year after, in ${varById("ndvi").units} units). One region alone is too small a sample for a significance test — see the pooled test below.</p>`;
  const pooled = RULES.map((x) => { const s = ruleSupport(x.id); return `<li><span class="tier t${x.tier}">${x.tier}</span><b>${x.id}</b> ${x.name}: <span class="${s.cls}-t">${s.txt}</span></li>`; }).join("");
  const others = REGIONS.filter((x) => x.playable).map((x) => replay(x.id)).sort((a, b) => a.total - b.total);
  const lowest = others[0].total, bests = others.filter((o) => o.total === lowest).map((o) => regionById(o.regionId).name);
  const mineBest = others.filter((o) => o.total === lowest).some((o) => o.regionId === r.regionId);
  $("report").innerHTML = `
    <div class="folder" style="margin-top:70px">
      <div class="tab">CASE REPORT</div>
      <div class="body">
        <article class="sheet dots report">
          <div class="report-head">
            <div><div class="kicker">${reg.name} · 2005–2024</div><h2 class="assign" style="margin:10px 0 0">Case closed</h2></div>
            <span class="stamp big ${verdict.cls}">${verdict.word}</span>
          </div>
          <p style="margin-top:12px">Strong stress signals (tier A or B) fired in <b style="color:var(--ink)">${r.strongYears} of 20 years</b>; any signal in ${r.anyYears}. ${r.main ? `The main pressure was <b>${r.main}</b>.` : ""} ${r.multi ? "There was at least one <b>multi-year drought</b> — the pattern linked to long-term decline." : ""}</p>
          <h3>Stress signals that fired</h3>
          ${fired ? `<ul class="rulelist">${fired}</ul>` : `<p>None of the research's stress signals fired here in 2005–2024.</p>`}
          ${unavailable.length ? `<p class="src">Not evaluated (data missing): ${unavailable.join(", ")}.</p>` : ""}
          <h3>Did real greenness agree?</h3>
          ${eviTxt}
          <p style="margin-bottom:4px">Across all regions, tested against MODIS greenness (false-discovery-rate corrected):</p>
          <ul class="rulelist">${pooled}</ul>
          <h3>Your call</h3>
          <p>${clueTxt}</p>
          ${note ? `<p style="margin-top:6px;font-family:var(--type);color:var(--ink)">“${note.replace(/</g, "&lt;")}”</p>` : ""}
          <h3>How every region compares</h3>
          <p style="margin-bottom:8px">Same 20 years of real records. Ranked by tier-weighted stress (A = 1, B = 0.5, C = 0.2 per signal per year — the research's suggested starting weights).</p>
          <table class="ranking"><tr><th>#</th><th>Region</th><th>Outcome</th><th>Strong-stress years</th><th>Weighted stress</th><th>Main pressure</th></tr>
            ${others.map((o, i) => `<tr class="${o.regionId === r.regionId ? "mine" : ""}"><td>${i + 1}</td><td>${regionById(o.regionId).home ? "🏠 " : ""}${regionById(o.regionId).name}${o.regionId === r.regionId ? " 🌲 <b>yours</b>" : ""}</td><td>${verdictOf(o).short}</td><td>${o.strongYears}</td><td>${o.total.toFixed(1)}</td><td>${o.main || "—"}</td></tr>`).join("")}
          </table>
          <p style="margin-top:12px">${mineBest ? `🏆 You picked ${bests.length > 1 ? "one of the calmest regions" : "the calmest region"} for a Scots pine.` : `The calmest ${bests.length > 1 ? "regions were" : "region was"} <b>${bests.join(", ")}</b>.`}</p>
          <div class="actions">
            <button class="btn" id="reopen">Reopen the evidence <span class="arrow">→</span></button>
            <button class="btn ghost" id="newcase">New case</button>
          </div>
          <p class="src" style="margin-top:18px">What this is — and isn't: stress signals from published Scots pine studies, evaluated on NASA monthly records and tested against MODIS greenness (which covers all vegetation, not just pines). The research gives warning signs, not a pass/fail rule, so this is a stress record, not a forecast of whether a tree lives or dies. Not in the data: single frost nights, air dryness (VPD), CO₂, nitrogen, soil depth, slope, pests.</p>
          <div class="corner"></div>
        </article>
      </div>
    </div>`;
  $("report").classList.remove("hidden");
  $("reopen").onclick = () => show("board");
  $("newcase").onclick = () => { state.visited = new Set(); state.selected = null; $("pick-note").value = ""; updateMarks();
    $("dossier").innerHTML = `<div class="empty"><div class="big">Pick a region</div><p>Click a highlighted area on the map to open its file.</p></div>`; renderCall(); show("home"); };
  setTimeout(() => $("report").scrollIntoView({ behavior: "smooth", block: "start" }), 300);
}

/* ======================================================================
   8. Start
   ====================================================================== */
function boot(REAL) {
  prepare(REAL);
  $("nodata").classList.add("hidden");
  $("board-body").classList.remove("hidden");
  renderMap(); renderCall();
  window.D2 = { DATA, REGIONS, RULES, replay, RULE_TEST: () => RULE_TEST };
}
function noData() {
  REGIONS.forEach((r) => (r.playable = false));
  $("nodata").classList.remove("hidden");
  $("board-body").classList.add("hidden");
  $("data-line").textContent = "No climate records loaded — this game only uses real NASA data. Run pipeline/build_data.py.";
}
$("datafile").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const j = JSON.parse(await f.text()); if (!j.regions || !j.dates) throw new Error("not a game_data.json file"); boot(j); }
  catch (err) { $("datafile-msg").textContent = `Couldn't read that file: ${err.message}`; }
};
(async function start() {
  try { const r = await fetch("data/game_data.json", { cache: "no-cache" }); if (!r.ok) throw new Error("no data file"); boot(await r.json()); }
  catch (e) { noData(); }
  show("home");
})();
})();
