/*
 * app.js — Earth Data Detective front end.
 *
 * Reads:
 *   data/catalog.json  — variables, places, and which (place, variable) series exist
 *   data/cases.json    — demo "case files"
 *   data/series/*.json — one time series per (place, variable)
 *
 * Uses: Leaflet (map), Plotly (charts), stats.js (DDStats).
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    catalog: null,          // {variables, places, series}
    cases: [],
    theme: "all",
    placeId: null,
    varId: null,
    series: null,           // loaded series {dates, values, ...}
    startYear: null,
  };

  const COLORS = { rise: "#2a7f62", fall: "#b5452f", muted: "#9aa3b2", line: "#4a7ab0", anom: "#8a8f99" };
  const $ = (id) => document.getElementById(id);
  const cache = new Map();   // file -> series JSON

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------
  // Round x to the same number of decimals that `ref` needs for 2 significant digits,
  // so a rate and its confidence range line up (e.g. -0.27 and -0.53 to +0.00).
  function decimalsFor(ref) {
    const a = Math.abs(ref);
    if (!isFinite(a) || a === 0) return 2;
    return Math.max(0, 1 - Math.floor(Math.log10(a)));
  }
  function fmt(x, ref = x) {
    if (!isFinite(x)) return "—";
    const a = Math.abs(ref || x);
    if (a >= 1e5 || (a > 0 && a < 1e-4)) return x.toExponential(1);   // e.g. NO2 columns
    return x.toFixed(decimalsFor(ref || x));
  }
  const fmtSigned = (x, ref = x) => (x > 0 ? "+" : x < 0 ? "" : "±") + fmt(x, ref);
  const fmtP = (p) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
  const varById = (id) => state.catalog.variables.find((v) => v.id === id);
  const placeById = (id) => state.catalog.places.find((p) => p.id === id);
  const seriesEntry = (placeId, varId) =>
    state.catalog.series.find((s) => s.place === placeId && s.variable === varId);

  function setStatus(msg) { $("status").textContent = msg || ""; }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
  async function getJSON(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  async function loadSeries(file) {
    if (!cache.has(file)) cache.set(file, await getJSON(`data/${file}`));
    return cache.get(file);
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  function showView(name) {
    document.querySelectorAll("nav button").forEach((b) =>
      b.setAttribute("aria-selected", String(b.dataset.view === name)));
    document.querySelectorAll(".view").forEach((v) =>
      v.classList.toggle("active", v.id === `view-${name}`));
    if (name === "investigate" && map) setTimeout(() => map.invalidateSize(), 50);
  }

  // ---------------------------------------------------------------------------
  // Map
  // ---------------------------------------------------------------------------
  let map = null;
  let markerLayer = null;
  let pickMarker = null;

  function initMap() {
    map = L.map("map", { worldCopyJump: true, zoomControl: true }).setView([30, 10], 1);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 10,
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    map.on("click", (e) => selectNearestPlace(e.latlng.lat, e.latlng.lng));
    drawMarkers();
  }

  // Marker colour = trend of the selected variable at that place (if the pipeline
  // stored a summary), so the map doubles as a "where is it rising / falling" map.
  function markerColor(placeId) {
    if (!state.varId) return COLORS.line;
    const s = seriesEntry(placeId, state.varId);
    if (!s) return null;                               // no data for this variable here
    if (!s.summary) return COLORS.line;
    if (s.summary.p >= 0.05) return COLORS.muted;
    return s.summary.senPerDecade > 0 ? COLORS.rise : COLORS.fall;
  }

  function drawMarkers() {
    if (!markerLayer) return;
    markerLayer.clearLayers();
    for (const p of state.catalog.places) {
      const color = markerColor(p.id);
      if (color === null) continue;
      const selected = p.id === state.placeId;
      const m = L.circleMarker([p.lat, p.lon], {
        radius: selected ? 9 : p.preset ? 7 : 4,
        color: selected ? "#14213d" : "#fff",
        weight: selected ? 3 : 1,
        fillColor: color,
        fillOpacity: 0.9,
      });
      m.bindTooltip(p.name);
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); selectPlace(p.id); });
      markerLayer.addLayer(m);
    }
  }

  // Data is pre-downloaded, so a map click snaps to the nearest place we have data for.
  function selectNearestPlace(lat, lon) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dist = (a, b) => {
      const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
      const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
      return 12742 * Math.asin(Math.sqrt(h)); // km
    };
    const candidates = state.catalog.places.filter((p) =>
      !state.varId || seriesEntry(p.id, state.varId));
    let best = null, bestD = Infinity;
    for (const p of candidates) {
      const d = dist({ lat, lon }, p);
      if (d < bestD) { best = p; bestD = d; }
    }
    if (!best || bestD > 800) {
      setStatus("No data near there yet — try a highlighted dot on the map.");
      return;
    }
    setStatus(bestD > 50 ? `Nearest location with data: ${best.name} (${Math.round(bestD)} km away).` : "");
    selectPlace(best.id);
  }

  // ---------------------------------------------------------------------------
  // Step 1: themes
  // ---------------------------------------------------------------------------
  function initThemes() {
    document.querySelectorAll("#theme-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.theme = chip.dataset.theme;
        document.querySelectorAll("#theme-chips .chip").forEach((c) =>
          c.setAttribute("aria-pressed", String(c === chip)));
        renderVarList();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Step 2: places
  // ---------------------------------------------------------------------------
  function initPlaces() {
    const sel = $("place-select");
    for (const p of state.catalog.places.filter((p) => p.preset)) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => sel.value && selectPlace(sel.value));
  }

  function selectPlace(id) {
    state.placeId = id;
    const p = placeById(id);
    $("place-select").value = p.preset ? id : "";
    $("where-label").textContent = `${p.name} (${p.lat.toFixed(1)}°, ${p.lon.toFixed(1)}°)`;
    if (map) {
      if (pickMarker) pickMarker.remove();
      if (map.getZoom() < 3) map.setView([p.lat, p.lon], 4);
    }
    drawMarkers();
    renderVarList();
    // keep the current variable if it exists here, otherwise wait for a new pick
    if (state.varId && seriesEntry(id, state.varId)) runInvestigation();
    else if (state.varId) { state.varId = null; renderVarList(); showEmpty("Pick a clue that's available here."); }
  }

  // ---------------------------------------------------------------------------
  // Step 3: variables ("clues")
  // ---------------------------------------------------------------------------
  function renderVarList() {
    const box = $("var-list");
    box.innerHTML = "";
    const vars = state.catalog.variables.filter((v) =>
      state.theme === "all" || v.theme === state.theme);
    if (!vars.length) {
      box.innerHTML = `<p class="hint">No clues for this theme yet.</p>`;
      return;
    }
    for (const v of vars) {
      const available = !state.placeId || seriesEntry(state.placeId, v.id);
      const btn = document.createElement("button");
      btn.className = "var-card";
      btn.setAttribute("aria-pressed", String(v.id === state.varId));
      btn.disabled = !available;
      if (!available) btn.style.opacity = 0.45;
      btn.innerHTML =
        `<strong>${v.name}</strong>` +
        `<span>${v.definition}</span><br>` +
        `<span class="src">${v.sourceLabel}${available ? "" : " · no data here yet"}</span>`;
      btn.addEventListener("click", () => {
        state.varId = v.id;
        renderVarList();
        drawMarkers();
        if (state.placeId) runInvestigation();
        else setStatus("Now pick a place on the map — coloured dots show where this clue is rising or falling.");
      });
      box.appendChild(btn);
    }
  }

  // ---------------------------------------------------------------------------
  // The investigation
  // ---------------------------------------------------------------------------
  function showEmpty(msg) {
    $("empty-state").hidden = false;
    $("empty-state").querySelector("p").textContent = msg;
    $("result-body").hidden = true;
  }

  async function runInvestigation(startYear) {
    const entry = seriesEntry(state.placeId, state.varId);
    if (!entry) return showEmpty("No data for this clue here yet.");
    setStatus("Gathering evidence…");
    try {
      state.series = await loadSeries(entry.file);
    } catch (err) {
      console.error(err);
      setStatus("Couldn't load the data file. If you opened index.html directly, run a local server (see README).");
      return;
    }
    setupSlider(startYear);
    analyzeAndRender();
    setStatus("");
  }

  function setupSlider(startYear) {
    const years = state.series.dates.map((d) => +d.slice(0, 4));
    const first = years[0], last = years[years.length - 1];
    const slider = $("start-year");
    slider.min = first;
    slider.max = Math.max(first, last - 9);   // keep at least 10 years
    state.startYear = startYear && startYear >= first ? Math.min(startYear, +slider.max) : first;
    slider.value = state.startYear;
  }

  function subset() {
    const { dates, values } = state.series;
    const keep = dates.map((d) => +d.slice(0, 4) >= state.startYear);
    return {
      dates: dates.filter((_, i) => keep[i]),
      values: values.map((v) => (v === null ? NaN : v)).filter((_, i) => keep[i]),
    };
  }

  function analyzeAndRender() {
    const v = varById(state.varId);
    const p = placeById(state.placeId);
    const { dates, values } = subset();
    const r = DDStats.analyze(dates, values, { name: v.name, units: v.units });
    const lastYear = dates[dates.length - 1].slice(0, 4);
    $("start-year-out").textContent = `${state.startYear}–${lastYear} (${Math.round(r.years)} yrs)`;

    $("empty-state").hidden = true;
    $("result-body").hidden = false;
    renderVerdict(r, v, p);
    renderEvidence(r, v);
    renderCharts(dates, values, r, v);
  }

  function renderVerdict(r, v, p) {
    const mk = r.mannKendall;
    const rate = mk.senSlopePerDecade;
    const dir = rate > 0 ? "rise" : "fall";
    const card = $("verdict-card");
    card.classList.remove("rise", "fall");
    let headline;
    if (mk.significant) {
      card.classList.add(dir);
      headline = rate > 0 ? "Significantly rising" : "Significantly falling";
    } else if (Math.abs(mk.tau) < 0.02) {
      headline = "No clear trend";
    } else {
      headline = rate > 0 ? "Slightly rising — not proven yet" : "Slightly falling — not proven yet";
    }
    $("verdict-label").textContent = `${v.name} · ${p.name}`;
    $("verdict-headline").textContent = headline;
    $("verdict-text").textContent = r.verdict;
    const stamp = $("verdict-stamp");
    stamp.textContent = mk.significant ? "Significant" : "Not significant";
    stamp.className = "stamp " + (mk.significant ? "sig" : "nsig");
  }

  function renderEvidence(r, v) {
    const u = v.units ? ` ${v.units}` : "";
    const lin = r.linear, mk = r.mannKendall;
    $("lin-rate").textContent = `${fmtSigned(lin.slopePerDecade)}${u} / decade`;
    const ref = lin.slopePerDecade;
    $("lin-ci").textContent = `${fmtSigned(ref - lin.ciPerDecade, ref)} to ${fmtSigned(ref + lin.ciPerDecade, ref)}`;
    $("lin-p").textContent = fmtP(lin.p);
    $("lin-sig").textContent = lin.significant ? "Yes" : "No";
    $("mk-rate").textContent = `${fmtSigned(mk.senSlopePerDecade)}${u} / decade`;
    $("mk-tau").textContent = `${(mk.tau * 100).toFixed(0)}% more ${mk.tau >= 0 ? "ups" : "downs"}`;
    $("mk-p").textContent = fmtP(mk.p);
    $("mk-sig").textContent = mk.significant ? "Yes" : "No";
    $("disagree-box").hidden = !r.testsDisagree;
  }

  function renderCharts(dates, values, r, v) {
    const layout = (ytitle) => ({
      margin: { l: 56, r: 16, t: 8, b: 36 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, system-ui, sans-serif", size: 12, color: "#4a5568" },
      xaxis: { showgrid: false, linecolor: "#cfc9ba" },
      yaxis: { title: { text: ytitle }, gridcolor: "#eee9dd", zeroline: false },
      showlegend: false,
      hovermode: "x unified",
    });
    const cfg = { displayModeBar: false, responsive: true };

    Plotly.react("chart-raw", [{
      x: dates, y: values, type: "scatter", mode: "lines",
      line: { color: COLORS.line, width: 1.5 }, name: v.name,
      hovertemplate: `%{y:.3g} ${v.units}<extra></extra>`,
    }], layout(v.units), cfg);

    const mk = r.mannKendall, lin = r.linear;
    const color = !mk.significant ? COLORS.muted : mk.senSlopePerDecade > 0 ? COLORS.rise : COLORS.fall;
    const t0 = new Date(dates[0]).getTime();
    const trendY = dates.map((d) =>
      lin.intercept + lin.slopePerYear * ((new Date(d).getTime() - t0) / (365.25 * 86400000)));

    const anomLayout = layout(`difference from normal (${v.units})`);
    anomLayout.shapes = [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0,
      line: { color: "#bdb6a6", width: 1 } }];
    Plotly.react("chart-anom", [
      { x: dates, y: r.anomalies.map((a) => (isFinite(a) ? a : null)), type: "scatter", mode: "lines",
        line: { color: COLORS.anom, width: 1 }, name: "Anomaly",
        hovertemplate: `%{y:+.3g} ${v.units}<extra>vs. normal</extra>` },
      { x: dates, y: trendY, type: "scatter", mode: "lines",
        line: { color, width: 3 }, name: "Trend", hoverinfo: "skip" },
    ], anomLayout, cfg);
  }

  // ---------------------------------------------------------------------------
  // Record-length slider
  // ---------------------------------------------------------------------------
  function initSlider() {
    let raf = null;
    $("start-year").addEventListener("input", (e) => {
      state.startYear = +e.target.value;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => state.series && analyzeAndRender());
    });
  }

  // ---------------------------------------------------------------------------
  // Case files
  // ---------------------------------------------------------------------------
  function renderCases() {
    const box = $("case-list");
    box.innerHTML = "";
    if (!state.cases.length) {
      box.innerHTML = `<p class="hint">Case files coming soon.</p>`;
      return;
    }
    for (const c of state.cases) {
      const el = document.createElement("article");
      el.className = "card case";
      el.innerHTML =
        `<span class="tag">${c.tag || "Case file"}</span>` +
        `<h3>${c.title}</h3><p>${c.summary}</p>` +
        `<button type="button">Open case →</button>`;
      el.querySelector("button").addEventListener("click", () => openCase(c));
      box.appendChild(el);
    }
  }

  function openCase(c) {
    showView("investigate");
    state.theme = "all";
    document.querySelectorAll("#theme-chips .chip").forEach((ch) =>
      ch.setAttribute("aria-pressed", String(ch.dataset.theme === "all")));
    state.varId = c.variable;
    state.placeId = c.place;
    const p = placeById(c.place);
    $("place-select").value = p.preset ? p.id : "";
    $("where-label").textContent = `${p.name} (${p.lat.toFixed(1)}°, ${p.lon.toFixed(1)}°)`;
    if (map) map.setView([p.lat, p.lon], c.zoom || 4);
    renderVarList();
    drawMarkers();
    runInvestigation(c.startYear);
  }

  // ---------------------------------------------------------------------------
  // Start-up
  // ---------------------------------------------------------------------------
  async function init() {
    document.querySelectorAll("nav button").forEach((b) =>
      b.addEventListener("click", () => showView(b.dataset.view)));
    initThemes();
    initSlider();

    try {
      state.catalog = await getJSON("data/catalog.json");
    } catch (err) {
      console.error(err);
      setStatus("Couldn't load data/catalog.json. If you opened index.html directly, run a local server (see README).");
      return;
    }
    try { state.cases = (await getJSON("data/cases.json")).cases || []; }
    catch { state.cases = []; }

    initPlaces();
    renderVarList();
    renderCases();
    if (window.L) initMap();
    else setStatus("Map library didn't load — check your internet connection.");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
