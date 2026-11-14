# 🔍 Earth Data Detective

**Is it really changing — or is it just noise?**

Earth Data Detective is a small website for students and curious people. Pick a place and an Earth-science variable (soil moisture, rainfall, snow, temperature…). The site shows how it changed over time and tests whether the trend is **statistically significant** or could just be random year-to-year variation.

It was built in 48 hours for a hackathon.

## What you can do

- **Investigate.** Choose a theme (water, heat, …), a place on the map or from the list, and a "clue" (variable). You get:
  - the raw monthly data,
  - the same data with the seasons removed, plus a trend line,
  - a plain-language verdict ("Significantly falling", "Slightly rising — not proven yet", …),
  - two trend tests side by side, with an explanation when they disagree,
  - a slider to change the start year and see whether a longer record changes the verdict.
- **Case files.** Worked investigations, such as *Is Spain drying out?*, *Is the snow in the Alps disappearing?* and *Is Delhi heating up?*
- **How it works.** Four short explainers: trends, seasonal anomalies, p-values and the Mann-Kendall test.
- **Trend map.** Map dots are coloured green (significantly rising), red (significantly falling) or grey (not significant) for the selected variable.

## Repository layout

```
data-detective/
├── pipeline/                # Python: downloads data and builds the website's JSON
│   ├── build_data.py        # builds everything in docs/data/ (edit the CONFIG section)
│   ├── fetch_giovanni.py    # one NASA Giovanni series at a point  -> CSV
│   ├── fetch_cdo.py         # one NOAA weather-station series      -> CSV
│   ├── trend_analysis.py    # stand-alone analysis of one CSV + chart (trend_plot.png)
│   └── requirements.txt
├── docs/                    # the website (GitHub Pages serves this folder)
│   ├── index.html
│   ├── app.js               # map, charts, guided flow
│   ├── stats.js             # Mann-Kendall, Sen's slope, t-test, deseasonalize
│   └── data/                # JSON produced by the pipeline
│       ├── catalog.json     #   variables, places, which series exist (+ trend summary)
│       ├── cases.json       #   the case files
│       └── series/*.json    #   one monthly time series per (place, variable)
└── README.md
```

## Data sources

| Source | What we use | Access |
|---|---|---|
| [NASA Giovanni](https://giovanni.gsfc.nasa.gov/) — GLDAS Noah 0.25° monthly (`GLDAS_NOAH025_M_2_1`) | Topsoil and root-zone soil moisture, rainfall, evaporation, snow water equivalent, air temperature, 2000–2024 | Giovanni Time Series API; needs a free [Earthdata Login](https://urs.earthdata.nasa.gov/) token |
| [NOAA Climate Data Online](https://www.ncei.noaa.gov/cdo-web/) — Global Summary of the Month | Station temperature (TAVG) and precipitation (PRCP) | NCEI Access Data Service; no token needed |
| Your own CSVs | Any `date,value` export, e.g. a Giovanni website "Area-Averaged Time Series" | Add to `CSV_SERIES` in `build_data.py` |

Unit conversions: GLDAS fluxes (kg m⁻² s⁻¹) × 86 400 → mm/day; temperature K − 273.15 → °C.

## Method

Every series goes through the same steps. They're done in the browser (`docs/stats.js`) and in Python (`pipeline/`), and both give the same numbers.

1. **Monthly series.** Raw values are averaged to calendar months, and fill values (< −9000) are dropped. Series with fewer than about 10 years of valid months are skipped.
2. **Remove the seasons.** anomaly = value − the long-term mean for that calendar month.
3. **Straight-line trend.** Least-squares regression of the anomalies on time (in years), with a two-sided t-test and a 95 % confidence interval on the slope. This mirrors `scipy.stats.linregress`.
4. **Mann-Kendall test with the Hamed & Rao (1998) correction.** Neighbouring months aren't independent, so the test's variance is inflated using the significant autocorrelations of the detrended, ranked anomalies up to a **12-month lag**. In our simulations on trendless data, using all lags (the pymannkendall default) gave about 10–19 % false positives; a 12-month lag brought that down to about 6–7 %. This mirrors `pymannkendall.hamed_rao_modification_test(x, lag=12)`.
5. **Sen's slope.** The median of all pairwise slopes, converted to units per decade.
6. **Verdict.** Significance uses Mann-Kendall at α = 0.05. When the t-test and Mann-Kendall disagree, the site explains why.

Note: `trend_analysis.py` calls `hamed_rao_modification_test` with pymannkendall's default (all lags), so its p-values can be smaller than the website's. Pass `lag=12` to match.

## How to run

### 1. Look at the website locally

The site loads JSON with `fetch`, so it needs a local web server. Opening `index.html` directly won't work.

```bash
cd docs
python3 -m http.server 8000
# open http://localhost:8000
```

### 2. Build the data

```bash
pip3 install -r pipeline/requirements.txt
echo "YOUR_EARTHDATA_TOKEN" > ~/.edl_token      # only needed for Giovanni variables

python3 pipeline/build_data.py                  # build everything in the config
python3 pipeline/build_data.py --only spain     # just places whose id contains "spain"
python3 pipeline/build_data.py --offline        # rebuild from cached downloads only
```

Downloads are cached in `pipeline/cache/`, which git ignores. Re-running is fast and works offline. To add variables, places, map grids or case files, edit the `CONFIG` section at the top of `build_data.py`.

### 3. Analyse a single series (no website needed)

```bash
python3 pipeline/fetch_giovanni.py soilmoist 40.4 -3.7
python3 pipeline/trend_analysis.py gldas_soilmoist_monthly.csv "Topsoil moisture (0-10 cm)" "kg/m²"

python3 pipeline/fetch_cdo.py st_temp SP000003195
python3 pipeline/trend_analysis.py cdo_SP000003195_st_temp.csv "Madrid temperature" "°C"
```

### 4. Publish with GitHub Pages

Go to the repository's **Settings → Pages**, set **Source: Deploy from a branch**, branch `main`, folder **`/docs`**, then **Save**. Commit `docs/data/` after each build so the live site has data.

## Credits

Data from NASA GES DISC / Giovanni (GLDAS) and NOAA NCEI (Climate Data Online). Map tiles © OpenStreetMap contributors © CARTO. Built with [Leaflet](https://leafletjs.com/) and [Plotly](https://plotly.com/javascript/).
