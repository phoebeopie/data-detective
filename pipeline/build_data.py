"""
build_data.py — builds the data files the Earth Data Detective website reads.

    docs/data/catalog.json          variables, places, and which series exist (+ trend summary)
    docs/data/cases.json            the demo "case files"
    docs/data/series/<id>.json      one monthly time series per (place, variable)

Data sources (all from the challenge's resource list):
    giovanni : NASA Giovanni "Time Series" API, single point (needs ~/.edl_token)
    cdo      : NOAA Climate Data Online / NCEI Access Data Service, weather stations
    csv      : any CSV you exported yourself (e.g. Giovanni website "Area-Averaged Time Series")

Everything downloaded is cached in pipeline/cache/, so re-running is fast and works offline.

Usage (from the repository root):
    python3 pipeline/build_data.py                 # build everything in the config below
    python3 pipeline/build_data.py --offline       # only use cached downloads
    python3 pipeline/build_data.py --only spain    # only places whose id contains "spain"

Install once:  pip3 install requests pandas numpy pymannkendall
"""
import argparse
import hashlib
import io
import json
import os
import sys
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
import pymannkendall as mk
import requests

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data"
CACHE = Path(__file__).resolve().parent / "cache"
MIN_YEARS = 10          # skip series shorter than this
MK_LAG = 12             # same autocorrelation lag as stats.js

# =============================================================================
# CONFIG — edit these lists to add variables, places and case files
# =============================================================================

# GLDAS monthly variables via Giovanni. "scale"/"offset" convert to friendlier units.
GLDAS = "GLDAS_NOAH025_M_2_1_"
VARIABLES = [
    dict(id="soilmoist", name="Topsoil moisture", theme="water",
         definition="How wet the top 10 cm of soil is.",
         units="kg/m²", source="giovanni", data_id=GLDAS + "SoilMoi0_10cm_inst",
         sourceLabel="GLDAS model via NASA Giovanni"),
    dict(id="rootmoist", name="Root-zone soil moisture", theme="water",
         definition="Water available to plant roots (roughly the top metre of soil).",
         units="kg/m²", source="giovanni", data_id=GLDAS + "RootMoist_inst",
         sourceLabel="GLDAS model via NASA Giovanni"),
    dict(id="rain", name="Rainfall", theme="water",
         definition="Rain falling on the land surface.",
         units="mm/day", source="giovanni", data_id=GLDAS + "Rainf_f_tavg", scale=86400,
         sourceLabel="GLDAS model via NASA Giovanni"),
    dict(id="evap", name="Evaporation", theme="water",
         definition="Water going back into the air from soil, water and plants.",
         units="mm/day", source="giovanni", data_id=GLDAS + "Evap_tavg", scale=86400,
         sourceLabel="GLDAS model via NASA Giovanni"),
    dict(id="snow", name="Snow water", theme="water",
         definition="How much water is stored in the snowpack.",
         units="mm", source="giovanni", data_id=GLDAS + "SWE_inst",
         sourceLabel="GLDAS model via NASA Giovanni"),
    # GLDAS air temperature is switched off: at our test points it warmed ~1.7-2.0 °C/decade
    # over 2000-2024 (about 5x the Madrid station's +0.34), most likely an artefact of
    # changes in the model's forcing data. Candidate replacement: MERRA-2 T2M
    # (data_id "M2TMNXSLV_5_12_4_T2M"), which needs GES DISC authorized in your Earthdata profile.
    # dict(id="tair", name="Air temperature", theme="heat",
    #      definition="Temperature about 2 m above the ground.",
    #      units="°C", source="giovanni", data_id=GLDAS + "Tair_f_inst", offset=-273.15,
    #      sourceLabel="GLDAS model via NASA Giovanni"),
    # NOAA weather stations (CDO). Each CDO place below lists its station id.
    dict(id="st_temp", name="Station temperature", theme="heat",
         definition="Average monthly temperature measured at a weather station.",
         units="°C", source="cdo", cdo_type="TAVG",
         sourceLabel="NOAA Climate Data Online (station)"),
    dict(id="st_rain", name="Station rainfall", theme="water",
         definition="Total monthly rain and snow measured at a weather station.",
         units="mm", source="cdo", cdo_type="PRCP",
         sourceLabel="NOAA Climate Data Online (station)"),
]

# Places. preset=True -> appears in the "Choose a place" dropdown.
# vars: which variable ids to fetch here ("gldas" = all Giovanni variables).
PLACES = [
    dict(id="spain", name="Central Spain", lat=40.4, lon=-3.7, preset=True, vars="gldas"),
    dict(id="alps", name="Swiss Alps", lat=46.5, lon=8.0, preset=True, vars="gldas"),
    dict(id="delhi", name="Delhi, India", lat=28.6, lon=77.2, preset=True, vars="gldas"),
    dict(id="amazon", name="Central Amazon", lat=-3.5, lon=-62.0, preset=True, vars="gldas"),
    dict(id="sahel", name="Sahel, Niger", lat=14.0, lon=2.0, preset=True, vars="gldas"),
    dict(id="calif", name="Central Valley, California", lat=36.5, lon=-120.0, preset=True, vars="gldas"),
    # Weather station example — check the id on the CDO website before relying on it.
    dict(id="madrid_st", name="Madrid Retiro (station)", lat=40.41, lon=-3.68, preset=True,
         vars=["st_temp", "st_rain"], cdo_station="SP000003195"),
]

# Grids of points for the trend map. Each point becomes a small dot on the map.
# Keep them modest: every point is one request per variable.
GRIDS = [
    dict(prefix="iberia", name="Iberia", south=37, north=43, west=-9, east=3, step=2,
         vars=["soilmoist"]),
    # Global coarse grid (≈2,600 requests per variable — run overnight, not during the demo):
    # dict(prefix="globe", name="Global", south=-55, north=70, west=-180, east=175, step=5,
    #      vars=["tair"]),
]

# Optional: your own CSVs (e.g. Giovanni website exports). Path relative to repo root.
CSV_SERIES = [
    # dict(place="europe_box", variable="no2", path="pipeline/csv/no2_europe.csv"),
]

CASES = [
    dict(tag="Water", title="Is Spain drying out?",
         summary="The soil-moisture line slopes down. But is that proof, or just a run of dry years? "
                 "Watch the two tests disagree.",
         place="spain", variable="soilmoist"),
    dict(tag="Water", title="Is the snow in the Alps disappearing?",
         summary="Snow is the Alps' water tower. Is it holding less water than it used to?",
         place="alps", variable="snow"),
    dict(tag="Heat", title="Is Madrid warming?",
         summary="75 years of thermometer readings from one Madrid park. Slide the start year "
                 "and see how much record you need before the warming is proven.",
         place="madrid_st", variable="st_temp"),
]

GIOVANNI_START, GIOVANNI_END = "2000-01-01T00:00:00", "2024-12-31T23:59:59"
CDO_START, CDO_END = "1950-01-01", "2024-12-31"

# =============================================================================
# Fetching
# =============================================================================
def cache_path(key: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    return CACHE / (hashlib.md5(key.encode()).hexdigest()[:16] + ".txt")


def cached_get(url, params, headers=None, offline=False, label=""):
    key = url + json.dumps(params, sort_keys=True)
    p = cache_path(key)
    if p.exists():
        return p.read_text()
    if offline:
        raise RuntimeError(f"not in cache (offline): {label}")
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, headers=headers or {}, timeout=300)
            if r.status_code == 200:
                p.write_text(r.text)
                return r.text
            if r.status_code in (401, 403):
                raise RuntimeError(f"HTTP {r.status_code} — check your token/login ({label})")
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(5 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
        except requests.RequestException as e:
            if attempt == 2:
                raise RuntimeError(f"network error ({label}): {e}")
            time.sleep(5)
    raise RuntimeError(f"gave up after retries ({label})")


def parse_dated_lines(text):
    """Pull 'date,value' rows out of any CSV-ish text (Giovanni API or website export)."""
    rows = []
    for ln in text.splitlines():
        if len(ln) >= 7 and ln[:4].isdigit() and ln[4] == "-":
            parts = [p.strip() for p in ln.replace("\t", ",").split(",")]
            if len(parts) >= 2:
                rows.append((parts[0], parts[1]))
    if not rows:
        return None
    df = pd.DataFrame(rows, columns=["time", "value"])
    df["time"] = pd.to_datetime(df["time"].str.replace("Z", "", regex=False), errors="coerce")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    s = df.dropna(subset=["time"]).set_index("time")["value"]
    return s.where(s > -9000)          # fill values -> NaN


def load_token():
    tok = os.environ.get("EDL_TOKEN")
    p = Path.home() / ".edl_token"
    if not tok and p.exists():
        tok = p.read_text().strip()
    return tok


def fetch_giovanni(var, lat, lon, offline):
    token = load_token()
    if not token and not offline:
        raise RuntimeError("no Earthdata token: save it in ~/.edl_token")
    text = cached_get(
        "https://api.giovanni.earthdata.nasa.gov/timeseries",
        {"data": var["data_id"], "location": f"[{lat},{lon}]",
         "time": f"{GIOVANNI_START}/{GIOVANNI_END}"},
        headers={"Authorization": f"Bearer {token}"} if token else None,
        offline=offline, label=f"{var['id']} @ {lat},{lon}")
    s = parse_dated_lines(text)
    if s is None:
        raise RuntimeError(f"no data rows returned for {var['data_id']}: {text[:200]!r}")
    return s


def fetch_cdo(var, station, offline):
    text = cached_get(
        "https://www.ncei.noaa.gov/access/services/data/v1",
        {"dataset": "global-summary-of-the-month", "stations": station,
         "dataTypes": var["cdo_type"], "startDate": CDO_START, "endDate": CDO_END,
         "format": "json", "units": "metric"},
        offline=offline, label=f"CDO {station} {var['cdo_type']}")
    rows = json.loads(text)
    if not rows:
        raise RuntimeError(f"CDO returned no rows for {station} {var['cdo_type']}")
    df = pd.DataFrame(rows)
    s = pd.Series(pd.to_numeric(df[var["cdo_type"]], errors="coerce").values,
                  index=pd.to_datetime(df["DATE"], errors="coerce"))
    return s.dropna()


def fetch_csv(path):
    s = parse_dated_lines((ROOT / path).read_text())
    if s is None:
        raise RuntimeError(f"no 'date,value' rows found in {path}")
    return s

# =============================================================================
# Processing
# =============================================================================
def to_monthly(s, var):
    s = s.sort_index()
    s = s * var.get("scale", 1) + var.get("offset", 0)
    m = s.resample("MS").mean()
    # full monthly index from first to last valid month (gaps stay as NaN)
    m = m.loc[m.first_valid_index(): m.last_valid_index()]
    return m


def summary(m):
    anom = m - m.groupby(m.index.month).transform("mean")
    x = anom.dropna().values
    r = mk.hamed_rao_modification_test(x, lag=MK_LAG)
    p = float(r.p) if np.isfinite(r.p) else 1.0
    return {"senPerDecade": round(float(r.slope) * 120, 6), "p": round(p, 5),
            "years": round((m.index[-1] - m.index[0]).days / 365.25, 1)}


def write_series(place, var, m):
    fname = f"series/{place['id']}_{var['id']}.json"
    payload = {
        "place": place["id"], "variable": var["id"], "units": var["units"],
        "source": var["sourceLabel"],
        "dates": [d.strftime("%Y-%m-%d") for d in m.index],
        "values": [None if not np.isfinite(v) else round(float(v), 6) for v in m.values],
    }
    (OUT / fname).write_text(json.dumps(payload, separators=(",", ":")))
    return fname

# =============================================================================
# Main
# =============================================================================
def build_jobs(only):
    var_by_id = {v["id"]: v for v in VARIABLES}
    gldas_ids = [v["id"] for v in VARIABLES if v["source"] == "giovanni"]
    places, jobs = [], []

    def add(place, var_ids):
        places.append(place)
        for vid in var_ids:
            jobs.append((place, var_by_id[vid]))

    for p in PLACES:
        add(p, gldas_ids if p["vars"] == "gldas" else p["vars"])
    for g in GRIDS:
        for lat in np.arange(g["south"], g["north"] + 1e-9, g["step"]):
            for lon in np.arange(g["west"], g["east"] + 1e-9, g["step"]):
                pid = f"{g['prefix']}_{lat:+.1f}_{lon:+.1f}".replace(".", "p")
                add(dict(id=pid, name=f"{g['name']} grid {lat:.1f}°, {lon:.1f}°",
                         lat=float(lat), lon=float(lon), preset=False), g["vars"])
    for c in CSV_SERIES:
        if not any(p["id"] == c["place"] for p in places):
            raise SystemExit(f"CSV_SERIES place '{c['place']}' must also be listed in PLACES")
        jobs.append((next(p for p in places if p["id"] == c["place"]),
                     dict(var_by_id[c["variable"]], source="csv", path=c["path"])))
    if only:
        jobs = [j for j in jobs if only in j[0]["id"]]
    return places, jobs


def run_job(place, var, offline):
    if var["source"] == "giovanni":
        raw = fetch_giovanni(var, place["lat"], place["lon"], offline)
    elif var["source"] == "cdo":
        if not place.get("cdo_station"):
            raise RuntimeError("place has no cdo_station")
        raw = fetch_cdo(var, place["cdo_station"], offline)
    elif var["source"] == "csv":
        raw = fetch_csv(var["path"])
    else:
        raise RuntimeError(f"unknown source {var['source']}")
    m = to_monthly(raw, var)
    if m.notna().sum() < MIN_YEARS * 12 * 0.8:
        raise RuntimeError(f"too short / too many gaps ({m.notna().sum()} months)")
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="use cached downloads only")
    ap.add_argument("--only", default="", help="only places whose id contains this text")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    (OUT / "series").mkdir(parents=True, exist_ok=True)
    places, jobs = build_jobs(args.only)

    # keep series already built (so --only doesn't wipe the rest of the catalog)
    old = {}
    if (OUT / "catalog.json").exists():
        for s in json.loads((OUT / "catalog.json").read_text()).get("series", []):
            old[(s["place"], s["variable"])] = s

    print(f"Building {len(jobs)} series ({'offline' if args.offline else 'online'})…")
    built, failed = dict(old), []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(run_job, p, v, args.offline): (p, v) for p, v in jobs}
        for i, f in enumerate(as_completed(futs), 1):
            p, v = futs[f]
            try:
                m = f.result()
                fname = write_series(p, v, m)
                built[(p["id"], v["id"])] = {"place": p["id"], "variable": v["id"],
                                             "file": fname, "summary": summary(m)}
                sm = built[(p["id"], v["id"])]["summary"]
                flag = "significant" if sm["p"] < 0.05 else "not significant"
                print(f"  [{i}/{len(jobs)}] ✅ {p['id']:<22} {v['id']:<10} "
                      f"{sm['senPerDecade']:+.3g} {v['units']}/decade, p={sm['p']:.3f} ({flag})")
            except Exception as e:
                failed.append((p["id"], v["id"], str(e)))
                print(f"  [{i}/{len(jobs)}] ❌ {p['id']:<22} {v['id']:<10} {e}")

    # Only list places/variables that actually have data
    used_places = {k[0] for k in built}
    used_vars = {k[1] for k in built}
    all_places = {p["id"]: p for p in places}
    catalog = {
        "variables": [{k: v[k] for k in ("id", "name", "theme", "definition", "units", "sourceLabel")}
                      for v in VARIABLES if v["id"] in used_vars],
        "places": [{k: p[k] for k in ("id", "name", "lat", "lon", "preset")}
                   for pid, p in all_places.items() if pid in used_places],
        "series": sorted(built.values(), key=lambda s: (s["place"], s["variable"])),
    }
    (OUT / "catalog.json").write_text(json.dumps(catalog, indent=1, ensure_ascii=False))
    cases = [c for c in CASES if (c["place"], c["variable"]) in built]
    (OUT / "cases.json").write_text(json.dumps({"cases": cases}, indent=1, ensure_ascii=False))

    print(f"\nDone: {len(built)} series, {len(catalog['places'])} places, "
          f"{len(catalog['variables'])} variables, {len(cases)} case files → {OUT}")
    if failed:
        print(f"{len(failed)} failed (see ❌ above). Re-run to retry; successes are cached.")


if __name__ == "__main__":
    main()
