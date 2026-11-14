"""
Step 1a: download ONE monthly series from NASA Giovanni at a single point and save it as CSV.

Reuses the fetching/caching code in build_data.py, so downloads are shared with the site build.
Needs an Earthdata Login token in ~/.edl_token (or the EDL_TOKEN environment variable).

Run (from the repository root):
    python3 pipeline/fetch_giovanni.py soilmoist 40.4 -3.7              # -> gldas_soilmoist_monthly.csv
    python3 pipeline/fetch_giovanni.py tair 28.6 77.2 delhi_tair.csv
    python3 pipeline/trend_analysis.py gldas_soilmoist_monthly.csv "Topsoil moisture" "kg/m²"

Variable ids are the "giovanni" entries in VARIABLES in build_data.py.
"""
import argparse

from build_data import VARIABLES, fetch_giovanni, to_monthly


def main():
    gio = {v["id"]: v for v in VARIABLES if v["source"] == "giovanni"}
    ap = argparse.ArgumentParser()
    ap.add_argument("variable", choices=sorted(gio))
    ap.add_argument("lat", type=float)
    ap.add_argument("lon", type=float)
    ap.add_argument("out", nargs="?", help="output CSV (default gldas_<variable>_monthly.csv)")
    ap.add_argument("--offline", action="store_true", help="use cached downloads only")
    a = ap.parse_args()

    var = gio[a.variable]
    m = to_monthly(fetch_giovanni(var, a.lat, a.lon, a.offline), var)
    out = a.out or f"gldas_{a.variable}_monthly.csv"
    m.rename(f"{a.variable} ({var['units']})").to_csv(out, index_label="time")
    print(f"{var['name']} @ {a.lat}, {a.lon}: {m.notna().sum()} months "
          f"({m.index[0]:%Y-%m} to {m.index[-1]:%Y-%m}) -> {out}")


if __name__ == "__main__":
    main()
