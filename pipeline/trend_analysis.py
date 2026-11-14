"""
Step 2: trend analysis on a monthly time series.

  - removes the seasonal cycle (anomalies vs. each calendar month's average)
  - linear regression slope + 95% confidence interval + t-test p-value
  - Mann-Kendall test (Hamed-Rao modified, corrects for autocorrelation)
  - Sen's slope (robust trend rate)
  - plain-language verdict + chart

Install once:  pip3 install pandas matplotlib scipy pymannkendall
Run:           python3 trend_analysis.py  [csv_file]  ["Variable name"]  ["units"]
"""
import sys
import warnings
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy import stats
import pymannkendall as mk

warnings.filterwarnings("ignore")

CSV = sys.argv[1] if len(sys.argv) > 1 else "gldas_soilmoist_monthly.csv"
NAME = sys.argv[2] if len(sys.argv) > 2 else "Topsoil moisture (0-10 cm)"
UNITS = sys.argv[3] if len(sys.argv) > 3 else "kg/m²"
ALPHA = 0.05


def load(path):
    df = pd.read_csv(path, index_col=0, parse_dates=True)
    return df.iloc[:, 0].astype(float).dropna()


def deseasonalize(s):
    climatology = s.groupby(s.index.month).transform("mean")
    return s - climatology


def linear_trend(anom):
    t_years = (anom.index - anom.index[0]).days / 365.25
    res = stats.linregress(t_years, anom.values)
    tcrit = stats.t.ppf(1 - ALPHA / 2, len(anom) - 2)
    return {
        "slope_per_decade": res.slope * 10,
        "ci_per_decade": (tcrit * res.stderr * 10),
        "p": res.pvalue,
        "intercept": res.intercept,
        "t_years": t_years,
    }


def mann_kendall(anom):
    r = mk.hamed_rao_modification_test(anom.values)
    # Sen's slope from mk is per time step (= per month) -> per decade
    return {"trend": r.trend, "p": r.p, "sen_per_decade": r.slope * 120}


def verdict(s, lin, mkr):
    mean = s.mean()
    sen = mkr["sen_per_decade"]
    pct = 100 * sen / mean if mean else float("nan")
    direction = "rising" if sen > 0 else "falling"
    years = (s.index[-1] - s.index[0]).days / 365.25
    ptxt = "p < 0.001" if mkr["p"] < 0.001 else f"p = {mkr['p']:.3f}"
    if mkr["p"] < ALPHA:
        sig = (f"This trend is statistically significant (Mann-Kendall {ptxt}): "
               f"it is very unlikely to be just random year-to-year variation.")
    else:
        sig = (f"This trend is NOT statistically significant (Mann-Kendall {ptxt}). "
               f"It could be random variation, or the record ({years:.0f} years) may be "
               f"too short to tell yet.")
    return (f"{NAME} is {direction} by about {abs(sen):.2f} {UNITS} per decade "
            f"({abs(pct):.1f}% of its average per decade). {sig}")


def plot(s, anom, lin, mkr, text):
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 7), sharex=True,
                                   gridspec_kw={"height_ratios": [1, 1]})
    ax1.plot(s.index, s.values, color="#4a7ab0", lw=1)
    ax1.set_title(f"{NAME}: raw monthly values", loc="left", fontsize=11)
    ax1.set_ylabel(UNITS)

    ax2.axhline(0, color="#999", lw=0.8)
    ax2.plot(anom.index, anom.values, color="#8a8a8a", lw=0.9, label="Anomaly (seasonal cycle removed)")
    trend_line = lin["intercept"] + (lin["slope_per_decade"] / 10) * lin["t_years"]
    color = "#c0392b" if mkr["sen_per_decade"] < 0 else "#1f7a4d"
    ax2.plot(anom.index, trend_line, color=color, lw=2.2,
             label=f"Linear trend: {lin['slope_per_decade']:+.2f} ± {lin['ci_per_decade']:.2f} {UNITS}/decade")
    ax2.set_title("Anomalies and trend", loc="left", fontsize=11)
    ax2.set_ylabel(f"Δ {UNITS}")
    ax2.legend(loc="lower left", fontsize=9, frameon=False)

    for ax in (ax1, ax2):
        ax.spines[["top", "right"]].set_visible(False)
        ax.grid(axis="y", alpha=0.25)

    fig.text(0.01, 0.005, text, wrap=True, fontsize=9.5, va="bottom")
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    out = "trend_plot.png"
    fig.savefig(out, dpi=150)
    return out


if __name__ == "__main__":
    s = load(CSV)
    anom = deseasonalize(s)
    lin = linear_trend(anom)
    mkr = mann_kendall(anom)
    text = verdict(s, lin, mkr)

    print(f"\n{NAME}  |  {s.index[0]:%Y-%m} to {s.index[-1]:%Y-%m}  |  n = {len(s)} months")
    print("-" * 70)
    print(f"Linear trend   : {lin['slope_per_decade']:+.3f} ± {lin['ci_per_decade']:.3f} {UNITS}/decade "
          f"(95% CI), t-test p = {lin['p']:.4f}")
    print(f"Sen's slope    : {mkr['sen_per_decade']:+.3f} {UNITS}/decade")
    print(f"Mann-Kendall   : {mkr['trend']}, p = {mkr['p']:.4f} (Hamed-Rao, autocorrelation-corrected)")
    print("-" * 70)
    print("VERDICT:", text)
    print(f"\nChart saved: {plot(s, anom, lin, mkr, text)}")
