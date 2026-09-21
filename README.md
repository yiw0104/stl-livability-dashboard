# Spatial inequities and livability in St. Louis — interactive companion

An interactive dashboard accompanying:

> Favarão Leão AL, Wang Y, Banda BF, Balogun M, Xing E, Gudapati S, Rios-Hernandez M,
> Jacobs N, Reis RS. **Exploring spatial inequities and livability: a mixed-methods study
> using artificial intelligence and community insights.** *Journal of Urban Health*, 2026.

**Live dashboard → https://yiw0104.github.io/stl-livability-dashboard/**

A vision–language model (LLaVA-7B, prompted via LLaMA-generated instructions) rated
micro-scale built-environment features on **7,848 Google Street View street segments**
across the City of St. Louis. This page puts those ratings beside the census-tract
demographics they track, beside the feature-level validation against human audits, and
beside the resident and stakeholder quotations published in the paper.

## What's here

| Panel | What it shows |
|---|---|
| **Where the gaps are** | Two linked tract choropleths — any feature against any tract characteristic |
| **How closely they track** | The bivariate OLS fits from Figures 1 and 2, with confidence bands and a data-table view |
| **Every feature the model rated** | All 20 items, including those excluded, each carrying its validation status |
| **How far to trust the model** | Table S2: agreement, Gwet's AC1, sensitivity and specificity against human audits |
| **What residents and stakeholders said** | Published quotations paired with the quantitative result each speaks to |

## Typography

Headings, controls, tables and chart labels are set in Franklin Gothic, falling back to
the self-hosted [Libre Franklin](vendor/README.md) where it is not installed. Descriptions,
captions and quotations are set in Georgia, italic for captions and pull-quotes.

The page follows the reader's system light/dark setting; there is no in-page theme control.

## Reproducing the data layer

Everything under `data/` is generated. The regression coefficients are **recomputed from
the source data** rather than transcribed, so the slopes shown on the page are the
published ones by construction.

```bash
python build/precompute.py --src "/path/to/Quantitative_Analysis"
```

Requires `geopandas`, `pandas`, `numpy`, `scipy`. The script prints every fitted slope
and intercept on completion; these should match Figures 1 and 2 of the paper exactly.

Sources consumed:

- `shp/simg_tract.shp` — 104 census tracts with aggregated features and ACS demographics
- `rawdata/merged_results.csv` — 7,848 segments with the model's per-feature ratings
- `rawdata/selected_neighborhoods/` — the four neighbourhoods named in the paper

## Viewing locally

The page loads its data with `fetch`, which browsers block on `file://`. Serve the
folder over HTTP:

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

## Data files

| File | Rows | Contents |
|---|---|---|
| `data/tract_stats.csv` | 104 | Tract aggregates: feature percentages, ACS demographics, segments audited |
| `data/segments.csv` | 7,848 | Per-segment model ratings with coordinates and tract assignment |
| `data/tracts.geojson` | 104 | Tract boundaries (WGS 84), simplified, with the attributes above |
| `data/neighborhoods.geojson` | 4 | Outlines for North City, Central West End, Tower Grove, Dutchtown |
| `data/dashboard.json` | — | Everything the page renders, including all fitted models |

## How to read these numbers

- **Associations are tract-level.** They describe places, not individuals. Reading them
  as individual experience is an ecological fallacy.
- **Validation is against virtual human audits, not field audits.** The reference standard
  is independent human rating of the same panoramas — itself imperfect. Four features
  carried into the analyses (pavement continuity, major tripping hazards, curb ramps,
  tree canopy) had no comparable item in the human instrument and could not be externally
  validated.
- **Model error is systematic.** Sensitivity is high and specificity low across features:
  the model tends to report features as *present*. Two measures (buffer presence, cycling
  infrastructure) agreed no better than chance and were excluded entirely.
- **Tree canopy runs opposite to every other feature.** The paper attributes this to
  unmanaged vegetation on vacant lots rather than urban greening; compare against vacant
  housing units in the dashboard to see the confound.

## Data sources and vintage

- Built-environment features: Google Street View imagery, Street View Static API
- Demographics: American Community Survey 2018–2022 5-year estimates, via IPUMS NHGIS
- Boundaries: City of St. Louis Open Data; census tracts from TIGER/Line 2020

## Ethics

Interviews were conducted under Washington University in St. Louis IRB #202406091. No
transcript material beyond the quotations already published in the paper appears in this
repository, and no participant identifiers of any kind are included.

## Licence

Code (`index.html`, `app.js`, `build/`): MIT — see [LICENSE](LICENSE).
Data (`data/`): CC BY 4.0 — attribute the paper above.
Vendored [D3](https://d3js.org) v7.9.0 is ISC-licensed; see [vendor/README.md](vendor/README.md).
