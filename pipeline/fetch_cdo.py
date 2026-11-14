"""
Step 1b: download ONE monthly series from a NOAA weather station (Climate Data Online /
NCEI Access Data Service, "global-summary-of-the-month") and save it as CSV. No token needed.

Reuses the fetching/caching code in build_data.py.

Run (from the repository root):
    python3 pipeline/fetch_cdo.py st_temp SP000003195                  # -> cdo_SP000003195_st_temp.csv
    python3 pipeline/trend_analysis.py cdo_SP000003195_st_temp.csv "Madrid temperature" "°C"

Find station ids at https://www.ncei.noaa.gov/cdo-web/ (dataset: Global Summary of the Month).
Variable ids are the "cdo" entries in VARIABLES in build_data.py.
"""
import argparse

from build_data import VARIABLES, fetch_cdo, to_monthly


def main():
    cdo = {v["id"]: v for v in VARIABLES if v["source"] == "cdo"}
    ap = argparse.ArgumentParser()
    ap.add_argument("variable", choices=sorted(cdo))
    ap.add_argument("station", help="GHCN station id, e.g. SP000003195")
    ap.add_argument("out", nargs="?", help="output CSV (default cdo_<station>_<variable>.csv)")
    ap.add_argument("--offline", action="store_true", help="use cached downloads only")
    a = ap.parse_args()

    var = cdo[a.variable]
    m = to_monthly(fetch_cdo(var, a.station, a.offline), var)
    out = a.out or f"cdo_{a.station}_{a.variable}.csv"
    m.rename(f"{a.variable} ({var['units']})").to_csv(out, index_label="time")
    print(f"{var['name']} @ {a.station}: {m.notna().sum()} months "
          f"({m.index[0]:%Y-%m} to {m.index[-1]:%Y-%m}) -> {out}")


if __name__ == "__main__":
    main()
