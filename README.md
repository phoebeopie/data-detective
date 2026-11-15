# 🔍 D² Detective — The Scots pine case

**A playable Earth-data investigation for the NASA Space Apps Challenge 2026: [Be An Earth System Trend Detective](https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/).**

You have one Scots pine seed. Examine NASA climate records for six regions, including the area around Berlin, and plant the seed in one of them. Then replay 2005–2024 to see how your choice held up. The verdict tells you what changed, where, by how much, and how strong the evidence is.

▶ **Play it:** https://phoebeopie.github.io/data-detective/

---

## How the game works

1. **Opening.** The detective is hired to find the best place to plant a tree.
2. **Confidential dispatch.** The case file introduces Scots pine (*Pinus sylvestris*) on a specimen card with a species guide and its sources. It also explains every warning sign the game checks (the T and W rules below).
3. **Evidence board.** A full-screen map with six pins. Each pin opens an evidence file showing all eight variables for that site, plus how it ranks against the other five.
   - **Values shown:** the 2000–2004 baseline (the five years before planting).
   - **The ⓘ button** on each variable shows its definition, the dataset link, the trend chart (seasonal cycle removed) and the statistical tests.
   - **Your clue:** you can pin one variable as the clue you trust most.
   - **Planting:** selecting any site enables **Plant your seed!**
4. **Replay 2005–2024.** Twenty annual records with Play, Pause and a year slider. These all move together: the simulated tree, that year's exact readings, the chart cursor, and a year log showing which research stress signals fired. You can switch the plotted variable without losing the year.
5. **Verdict: "What happened?"** It includes:
   - **The outcome** for your simulated pine.
   - **The clearest trends at your site,** with direction, rate, units and years, and significance explained in plain language.
   - **A key-years timeline,** with each event marked as **observed** (from NASA data) or **simulated** (the game's tree).
   - **A clickable ranking of all six sites,** under a stated rule.
   - **A satellite greenness check, what the research says,** and a "How this explanation works" section.
   - **Try another site** to test a different hypothesis.

**Suggested demo path** (real data, three beats):
1. **Pick Brandenburg** (home) and pin **root-zone soil moisture** as your clue.
2. **Pause on 2018.** A spring–summer drought (W4) and a dry root zone (W6) fire. Rainfall averages 43.7 mm/month against the 64.9 baseline, and root-zone moisture is 304 against 372 kg/m². The simulated canopy drops to 60%.
3. **Open the verdict.** It reads **Frequent stress**, with strong signals in 6 of 20 years. Potential evaporation is rising about **10.4 mm/month per decade**, which is statistically significant after correction (q < 0.001). The air is getting thirstier.

---

## The six regions

Values are averaged over each box (west, south, east, north).

| ID | Region | Box | Notes |
|---|---|---|---|
| `brandenburg` | Brandenburg, Germany 🏠 | 12.0°E–14.7°E, 51.5°N–53.4°N | Home site: the sandy country around Berlin |
| `scotland` | Scottish Highlands | 6.0°W–3.0°W, 56.3°N–58.0°N | Native Caledonian pinewoods |
| `lapland` | Finnish Lapland | 23.5°E–28.5°E, 66.5°N–68.5°N | Near the Arctic tree line |
| `valais` | Valais Alps, Switzerland | 6.9°E–8.3°E, 46.0°N–46.5°N | Mostly above 2,000 m |
| `spain` | Central Spain | 6.0°W–1.5°W, 38.6°N–42.0°N | High, dry plateau |
| `kazakh` | Kazakh steppe | 69.0°E–73.0°E, 50.5°N–52.5°N | Dry grassland; **no greenness (EVI) on file** |

## The eight variables

| ID | In the game | Units | Dataset variable |
|---|---|---|---|
| `temp` | Temperature | °C | GLDAS `Tair_f_inst` |
| `rain` | Rainfall | mm/month | GLDAS `Rainf_f_tavg` |
| `soil` | Root-zone soil moisture | kg/m² | GLDAS `RootMoist_inst` |
| `potevap` | Potential evaporation | mm/month | GLDAS `PotEvap_tavg` |
| `topsoil` | Topsoil moisture | kg/m² | GLDAS `SoilMoi0_10cm_inst` |
| `evap` | Evaporation | mm/month | GLDAS `Evap_tavg` |
| `sun` | Sunlight (low-confidence model input) | W/m² | GLDAS `SWdown_f_tavg` |
| `ndvi` | Vegetation greenness (EVI) | index | MODIS MOD13A3 EVI |

## Data

| Source | Access |
|---|---|
| [GLDAS Noah Land Surface Model L4, monthly 0.25°, v2.1 (GLDAS_NOAH025_M)](https://doi.org/10.5067/SXAVCZFAQLNO) | NASA GES DISC via [Giovanni](https://giovanni.gsfc.nasa.gov/) |
| [MODIS/Terra Vegetation Indices Monthly L3 Global 1 km, v6.1 (MOD13A3)](https://doi.org/10.5067/MODIS/MOD13A3.061) | NASA LP DAAC via AppEEARS |

- **The file:** `docs/data/game_data.json` holds monthly values, January 2000 – December 2024 (300 months), for each region and variable, with per-series quality notes.
- **Coverage:** 47 of 48 series are on file; satellite greenness for the Kazakh steppe is missing.
- **Cleaning:** physically impossible values are removed and gaps are **never filled**.
- **Definitions:** the [Giovanni variable glossary](https://giovanni.gsfc.nasa.gov/giovanni/doc/glossary/Giovanni_Variable_Definitions_Glossary.html).
- **Not in this repository yet:**
  - **The script that downloads and builds `game_data.json`.** `pipeline/build_data.py` here builds the data for the older explorer, not the game.
  - **The team's research notes on Scots pine growth conditions.**

  Add both so the data can be rebuilt from scratch.

## Methods

**Annual records and baseline.** An annual record is the mean of that year's monthly values, and only counts if at least 10 of the 12 months exist; otherwise the year is shown as a gap. The baseline is the mean of the 2000–2004 annual records.

**Trend tests**, on the full monthly record, 2000–2024 (`docs/stats.js`):
- The seasonal cycle is removed (each month is compared with that month's long-term average).
- **Mann-Kendall test with the Hamed-Rao correction** (12-month lag) for month-to-month persistence, plus **Sen's slope** for the rate.
- **Benjamini-Hochberg false-discovery-rate correction** across all 47 trend tests. A trend is called significant when q < 0.05.
- **A least-squares trend with a 95% interval and t-test,** as a second check. The game says when the two tests disagree.

**Stress rules** (warning signs from published Scots pine research, checked every year):

| Rule | Tier | Fires when | Source |
|---|---|---|---|
| T1 Cold late winter | A | Jan–Mar mean temperature ≤ 1.5 standard deviations below the region's normal | S3 |
| T6 Tree-line cold | C | Growing-season mean < 6.4 °C (months above 0 °C), or fewer than 3 such months | S13, S14 |
| W1 Dry late summer | A | Jul–Sep rainfall < 100 mm | S4 |
| W4 Spring–summer drought | A | Mar–Aug water balance (rain − potential evaporation) ≤ 1.5 SD below normal (an SPEI-style approximation) | S3 |
| W5 Multi-year drought | B | W4 in two or more consecutive years | S5 |
| W6 Dry root zone | C | Jun–Aug relative root-zone wetness < 0.25 (0 = driest month on record, 1 = wettest) | S11 |

**Evidence tiers:**
- **A:** Scots pine, measured threshold.
- **B:** Scots pine, direction only.
- **C:** other species or general context.

**Can't be checked with monthly data:** single frost nights (T2, T3) and air dryness (A1, vapour-pressure deficit).

**Testing the rules against greenness.** For each rule, greenness in years when it fired is compared with greenness in years when it didn't. This uses April–September EVI anomalies, pooled over all regions, in the same year and the year after. The test is a one-sided Welch t-test, with false-discovery-rate correction across all tests. Only W6 is supported by this data.

**Simulated tree.** It only visualises the stress signals; it is **not a survival forecast**.
- **Canopy condition** each year = previous condition − 0.35 × (tier-weighted stress) + 0.12, kept between 15% and 100%.
- **Growth** adds up to one unit per year, and less in stressed years.

**Ranking rule (the game's model).** Every year a stress signal fires, a site scores its tier weight: A = 1, B = 0.5, C = 0.2. These are the research's suggested starting weights, not a published value. A lower total is calmer. The same rules, years and records are applied to every site, and ties are shown as ties.

**Temperature cross-check.** The GLDAS temperature trends are compared with [Copernicus ERA5, European State of the Climate 2025](https://climate.copernicus.eu/esotc/2025/why-europe-warming-faster).

**Who writes the explanations.** No AI model is connected. All text in the verdict is assembled by fixed rules in `game/game_logic.js`, from numbers the code computes.

### Known limitations

- **GLDAS warming looks too fast.** In Central Spain the GLDAS warming rate is about twice ERA5's, and the game flags it with a red ⚠ note. An earlier check against the Madrid weather station also found GLDAS warming several times faster, so treat GLDAS temperature *rates* with caution.
- **Greenness covers all vegetation,** not only pines.
- **Not in the data:** CO₂, nitrogen, soil depth, slope and pests, all of which matter in real forests.

---

## Repository layout

```
data-detective/
├── game/                    # source of the game
│   ├── game_src.html        # page markup + all CSS
│   ├── game_logic.js        # data handling, statistics glue, stress rules, map, replay, verdict
│   ├── land.json            # world land outline (Natural Earth 110m) for the map
│   └── build_game.py        # builds docs/index.html (inlines stats.js, land.json, game_logic.js)
├── docs/                    # what GitHub Pages serves
│   ├── index.html           # the game (GENERATED, do not edit by hand)
│   ├── stats.js             # Mann-Kendall, Sen's slope, t-test, deseasonalising
│   ├── assets/              # the team's illustrations (detective, magnifying glass, Scots pine)
│   ├── data/game_data.json  # the game's data
│   ├── investigate.html     # the earlier free-form explorer (uses app.js + data/catalog.json)
│   ├── app.js
│   └── data/catalog.json, cases.json, series/
├── pipeline/                # Python for the earlier explorer's data
│   ├── build_data.py        # builds docs/data/catalog.json, cases.json, series/
│   ├── fetch_giovanni.py    # one Giovanni series at a point → CSV
│   ├── fetch_cdo.py         # one NOAA weather-station series → CSV
│   ├── trend_analysis.py    # stand-alone analysis of one CSV + chart
│   └── requirements.txt
└── README.md
```

## Run it locally

The game loads its data with `fetch`, so it needs a local web server. Opening the file directly won't work.

```bash
python3 game/build_game.py          # after any change in game/
cd docs && python3 -m http.server   # then open http://localhost:8000
```

Edit `game/game_src.html` (markup and styles) and `game/game_logic.js` (behaviour), then rebuild. Never edit `docs/index.html` directly.

To rebuild the earlier explorer's data (needs an Earthdata Login token in `~/.edl_token`):

```bash
pip3 install -r pipeline/requirements.txt
python3 pipeline/build_data.py
```

## Publish

Go to **Settings → Pages**, choose **Deploy from a branch**, then branch `main` and folder **`/docs`**.

## Design and accessibility

- **Look:** a hand-drawn case-file style, with Instrument Serif headings, DM Sans body text, Courier Prime and Space Mono labels, cobalt blue and lime.
- **Keyboard:** everything works with the keyboard. Map pins take Tab and Enter, and Escape closes an evidence file. Focus rings are clearly visible.
- **Contrast:** text contrast is at least 4.5:1, and the page passes an automated WCAG 2 A/AA scan (axe-core).
- **Phones:** the layout works down to 375 px wide, and the evidence file becomes a bottom sheet.
- **Reduced motion:** with `prefers-reduced-motion`, final states show immediately and nothing animates.

## Sources

- **S3** Janecka et al. 2022, *Forests* 13:477 — Scots pine on south Baltic coastal dunes ([PDF](https://mdpi-res.com/d_attachment/forests/forests-13-00477/article_deploy/forests-13-00477.pdf))
- **S4** Scots pine defoliation and climate in the Valais, *Frontiers in Forests and Global Change* 2022 ([link](https://www.frontiersin.org/articles/10.3389/ffgc.2022.874100))
- **S5** Drought as an inciting mortality factor in Scots pine stands of the Valais ([link](https://doc.rero.ch/record/317644?ln=de))
- **S11** Bolte et al. 2016, *Frontiers in Plant Science* — beech seedling drought experiment ([PDF](https://www.frontiersin.org/articles/10.3389/fpls.2016.00751/pdf))
- **S13** Körner & Paulsen — worldwide high-altitude treeline temperatures, 46 sites ([link](https://openpolar.no/Record/crwiley:10.1111%2Fj.1365-2699.2003.01043.x))
- **S14** Treeline review on sink versus carbon limitation ([link](https://pmc.ncbi.nlm.nih.gov/articles/PMC3535059))
- **S15** EUFORGEN species profile, *Pinus sylvestris* ([link](https://euforgen.org/species/pinus-sylvestris))

## Credits

- **Illustrations** © the D² Detective team.
- **Data:** NASA GES DISC (GLDAS, via Giovanni) and NASA LP DAAC (MODIS, via AppEEARS).
- **Map outline:** Natural Earth.
- **Libraries:** [d3](https://d3js.org/) and [Plotly](https://plotly.com/javascript/).
- Built for the NASA Space Apps Challenge.
