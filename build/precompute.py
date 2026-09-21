#!/usr/bin/env python
"""
Build the dashboard's data layer from the analysis sources.

Reads the project sources (shapefiles + the VLM segment output), regenerates the
tract aggregates, refits every bivariate regression reported in Figures 1 and 2,
and writes the static files the dashboard loads.

The regression coefficients are recomputed here rather than transcribed, so the
figures on the page are the published figures by construction.

Usage:
    python build/precompute.py [--src PATH] [--out PATH]
"""

import argparse
import json
import os
import sys
from datetime import date

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy import stats

DEFAULT_SRC = (
    "/Users/yi/Library/CloudStorage/Box-Box/Measuring Spatial Inequalities in "
    "Urban Communities/Quantitative_Analysis"
)

# Tract-level columns: shapefile name -> (dashboard key, label, direction)
# direction: +1 where more is better, -1 where more is worse. Drives nothing in
# the color ramp (which stays sequential) but labels the scatter readout.
FEATURES = [
    ("ample_slig", "streetlights", "Ample street lighting", 1),
    ("well_maint", "facade",       "Well-maintained buildings", 1),
    ("paved",      "pavement",     "Pavement present", 1),
    ("c_paved",    "continuity",   "Continuous pavement", 1),
    ("no_mtrip",   "no_hazard",    "No major tripping hazards", 1),
    ("ped_crossi", "crossing",     "Marked pedestrian crossings", 1),
    ("curb_ramp",  "curb_ramp",    "Curb ramps", 1),
    ("h_tcanopy",  "canopy",       "High tree canopy coverage", 1),
]

CORRELATES = [
    ("pct_black",  "Non-Hispanic Black population", "%", "% of tract population"),
    ("medinck",    "Median household income",       "k", "$1,000s"),
    ("pct_vacant", "Vacant housing units",          "%", "% of tract housing units"),
]

# Segment-level descriptive table (Table 1 / Table S1). Each entry maps a column
# in merged_results.csv to the category counted as "present" for the prevalence
# bar, plus the validation status established in Table S2.
#
# status: "validated"     - comparable human item, AC1 > 0
#         "not_assessed"  - no equivalent item in the human instrument
#         "excluded_var"  - dropped: one category >= 95% of segments
#         "excluded_val"  - dropped: agreement with human audits no better than chance
SEGMENT_ITEMS = [
    ("streetlights",         "Ample street lighting",        {"Ample"},   "validated",    0.75, 80.5),
    ("building_maintenance", "Well-maintained buildings",    {"2"},       "validated",    0.71, 78.5),
    ("pavement_presence",    "Pavement present",             {"Yes"},     "validated",    0.54, 69.5),
    ("pavement_continuity",  "Continuous pavement",          {"Yes"},     "not_assessed", None, None),
    ("pavement_trip_major",  "Major tripping hazards",       {"1"},       "not_assessed", None, None),
    ("ped_crossing",         "Marked pedestrian crossings",  {"Yes"},     "validated",    0.95, 95.7),
    ("curb_ramp",            "Curb ramps",                   {"Yes"},     "not_assessed", None, None),
    ("tree_overhead",        "High tree canopy overhead",    {"high"},    "not_assessed", None, None),
    ("public_park",          "Public park nearby",           {"Yes"},     "validated",    0.89, 90.9),
    ("public_transit_stops", "Public transit stop nearby",   {"1", "2"},  "excluded_var", 0.93, 93.9),
    ("graffiti",             "Graffiti present",             {"Yes"},     "excluded_var", None, None),
    ("pavement_trip_minor",  "Minor tripping hazards",       {"1"},       "not_assessed", None, None),
    ("walk_signal",          "Walk signal",                  {"Yes"},     "excluded_var", None, None),
    ("benches",              "Benches",                      {"Yes"},     "excluded_var", None, None),
    ("pavement_width",       "Wide pavement",                {"2"},       "excluded_var", None, None),
    ("safe_walk_alt",        "Appears safe to walk",         {"Yes"},     "excluded_var", None, None),
    ("buffer_presence",      "Buffer present",               {"Yes"},     "excluded_val", -0.04, 39.6),
    ("buffer_width",         "Wide buffer",                  {"2"},       "excluded_var", None, None),
    ("buffer_majority",      "Buffer on majority of segment", {"Yes"},    "excluded_var", None, None),
    ("bike_path",            "Cycling infrastructure",       {"1", "2"},  "excluded_val", -0.88, 5.5),
]

# Table S2 Panel A - the human-human ceiling this task can attain.
HUMAN_BENCHMARK = [
    ("Public transit stop present", 16, 100.0, 1.00),
    ("Streetlights present",        16,  93.8, 0.92),
    ("Public park present",         16,  93.8, 0.92),
    ("Buildings well maintained",   10,  90.0, 0.87),
    ("Bike path present",           16,  81.2, 0.77),
    ("Pedestrian crossing present", 16,  81.2, 0.77),
    ("Sidewalk/pavement present",   16,  75.0, 0.51),
    ("Buffer present",              16,  68.8, 0.43),
]

# Table S2 Panel B - VLM against the human reference audits.
VLM_VALIDATION = [
    ("Marked pedestrian crossing", 164,  6.1,   6.7, 95.7,  0.95,  70.0, 97.4, "validated"),
    ("Public transit stop",        164,  4.3,   3.0, 93.9,  0.93,  14.3, 97.5, "validated"),
    ("Public park",                164,  6.1,  12.8, 90.9,  0.89,  80.0, 91.6, "validated"),
    ("Streetlights",               164, 78.7,  95.7, 80.5,  0.75,  98.4, 14.3, "validated"),
    ("Buildings well maintained",  130, 86.9,  83.8, 78.5,  0.71,  85.8, 29.4, "validated"),
    ("Sidewalk/pavement present",  164, 65.2,  92.1, 69.5,  0.54,  97.2, 17.5, "validated"),
    ("Buffer present",             164, 39.6, 100.0, 39.6, -0.04, 100.0,  0.0, "excluded_val"),
    ("Bike path present",          164,  5.5, 100.0,  5.5, -0.88, 100.0,  0.0, "excluded_val"),
]

# Table S2 Panels C/D - internal coherence.
COHERENCE = [
    ("High tree canopy",           "Residential", 55.0, "Commercial", 39.4, "land use"),
    ("Buildings well maintained",  "Residential", 78.1, "Commercial", 68.8, "land use"),
    ("Graffiti present",           "Residential",  2.7, "Commercial",  7.7, "land use"),
    ("Transit stop present",       "Residential",  1.3, "Commercial",  5.2, "land use"),
    ("Marked pedestrian crossing", "Residential",  6.1, "Commercial", 10.8, "land use"),
    ("Graffiti present",           "Well-maintained facade", 2.4, "Poorly maintained", 8.1, "inter-item"),
    ("High tree canopy",           "Park present", 57.8, "No park", 50.2, "inter-item"),
]

# Table 2 - published quotes, paired with the quantitative result each speaks to.
EVIDENCE = [
    {
        "quote": "Sidewalks just end; the bike lane disappears after two blocks.",
        "source": "P1", "theme": "1.3 Spatial disparities in the built environment",
        "pairs_with": "The VLM classified cycling infrastructure as present on 87.8% of "
                      "segments. Against human audits it agreed on 5.5% of panoramas "
                      "(AC1 -0.88) and was excluded from all analyses.",
        "kind": "diverge",
    },
    {
        "quote": "North City feels forgotten—bad housing, no grocery, heavy traffic.",
        "source": "P10", "theme": "3.4 Mapping unhealthy environments",
        "pairs_with": "Each 1-point rise in a tract's share of Black residents predicts "
                      "0.24 fewer percentage points of well-maintained buildings and "
                      "0.24 fewer of continuous pavement (both p < 0.001).",
        "kind": "converge",
    },
    {
        "quote": "Tower Grove has shade, cafés, safe crossings—everything works together.",
        "source": "P8", "theme": "3.5 What healthy looks like",
        "pairs_with": "Related features do cluster as the quotation describes: high tree "
                      "canopy is more common on segments with a park nearby (57.8% vs 50.2%), "
                      "and graffiti is rarer where facades are well maintained (2.4% vs 8.1%).",
        "kind": "converge",
    },
    {
        "quote": "The architecture is stunning, but the next street looks bombed-out.",
        "source": "P6", "theme": "1.2 Beauty and blight",
        "pairs_with": "Facade maintenance has the widest tract-level spread of any retained "
                      "feature: tract values run from 26.5% to 100% well-maintained.",
        "kind": "converge",
    },
    {
        "quote": "There are 90 municipalities here. Nobody wants to work together—"
                 "it's city versus city.",
        "source": "P12", "theme": "4.2 Structural & cultural barriers",
        "pairs_with": "Fragmented governance is offered as the mechanism behind the "
                      "spatial pattern; the audit measures the outcome, not the cause.",
        "kind": "context",
    },
    {
        "quote": "We use tree canopy maps and overlay them with ER visits and asthma "
                 "rates—it makes the inequities visible.",
        "source": "P8", "theme": "4.3 Data-driven facilitators",
        "pairs_with": "Tree canopy runs opposite to every other feature: +0.10 points per "
                      "1-point rise in Black population share (p < 0.01). Tract vacancy "
                      "is the likely confound—switch the comparison to vacancy to see it.",
        "kind": "diverge",
    },
]

NOTE_CANOPY = (
    "Tree canopy is the one feature that rises with Black population share. The paper "
    "reads this as unmanaged vegetation on vacant lots rather than urban greening - "
    "compare against vacant housing units to see the confound."
)


def stars(p):
    return "***" if p < 0.001 else "**" if p < 0.01 else "*" if p < 0.05 else ""


def fit(x, y):
    """OLS fit plus the 95% confidence band for the mean response."""
    d = pd.DataFrame({"x": x, "y": y}).dropna()
    n = len(d)
    r = stats.linregress(d["x"], d["y"])
    xs = np.linspace(d["x"].min(), d["x"].max(), 60)
    resid = d["y"] - (r.intercept + r.slope * d["x"])
    dof = n - 2
    s_err = np.sqrt(np.sum(resid ** 2) / dof)
    xbar = d["x"].mean()
    sxx = np.sum((d["x"] - xbar) ** 2)
    tval = stats.t.ppf(0.975, dof)
    half = tval * s_err * np.sqrt(1.0 / n + (xs - xbar) ** 2 / sxx)
    ys = r.intercept + r.slope * xs
    return {
        "slope": round(float(r.slope), 4),
        "intercept": round(float(r.intercept), 3),
        "r": round(float(r.rvalue), 4),
        "r2": round(float(r.rvalue ** 2), 4),
        "p": float(r.pvalue),
        "stars": stars(r.pvalue),
        "n": int(n),
        "band": {
            "x": [round(float(v), 3) for v in xs],
            "y": [round(float(v), 3) for v in ys],
            "lo": [round(float(v), 3) for v in (ys - half)],
            "hi": [round(float(v), 3) for v in (ys + half)],
        },
    }


def pole_of_inaccessibility(poly, steps=48):
    """Centre of the largest circle that fits inside the polygon.

    Used to anchor neighbourhood labels. A representative point or centroid gets
    pulled toward narrow spurs — North City's northern arm drags its label to the
    top of the shape — whereas this lands in the widest part of the body, which is
    where a reader expects the name to sit.

    Binary-searches the inward buffer distance: the last non-empty erosion of the
    polygon is its innermost core.
    """
    minx, miny, maxx, maxy = poly.bounds
    lo, hi = 0.0, max(maxx - minx, maxy - miny) / 2.0
    best = poly.representative_point()
    for _ in range(steps):
        mid = (lo + hi) / 2.0
        eroded = poly.buffer(-mid)
        if eroded.is_empty:
            hi = mid
        else:
            part = (max(eroded.geoms, key=lambda g: g.area)
                    if eroded.geom_type == "MultiPolygon" else eroded)
            best, lo = part.centroid, mid
    return best


def quantize(geom, nd=5):
    """Round coordinates in a GeoJSON geometry dict to nd decimals (~1 m at this latitude)."""
    def walk(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], nd), round(c[1], nd)]
        return [walk(p) for p in c]
    geom["coordinates"] = walk(geom["coordinates"])
    return geom


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC, help="analysis source directory")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data"))
    args = ap.parse_args()

    src, out = args.src, os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    if not os.path.isdir(src):
        sys.exit(f"source directory not found: {src}\nPass --src to point at it.")

    # ---------------------------------------------------------------- tracts
    tracts = gpd.read_file(os.path.join(src, "shp", "simg_tract.shp")).to_crs(4326)
    tracts["GEOID"] = tracts["GEOID"].astype("int64").astype(str)

    # ------------------------------------------------------------- segments
    seg = pd.read_csv(os.path.join(src, "rawdata", "merged_results.csv"))
    seg_gdf = gpd.GeoDataFrame(
        seg, geometry=gpd.points_from_xy(seg.lon, seg.lat), crs=4326
    )
    joined = gpd.sjoin(seg_gdf, tracts[["GEOID", "geometry"]], how="left", predicate="within")
    counts = joined.groupby("GEOID").size().rename("n_seg")
    tracts = tracts.merge(counts, left_on="GEOID", right_index=True, how="left")
    tracts["n_seg"] = tracts["n_seg"].fillna(0).astype(int)

    # -------------------------------------------------------- tract geojson
    geo = json.loads(
        tracts.set_geometry(tracts.geometry.simplify(0.00008, preserve_topology=True)).to_json()
    )
    keep = ["GEOID", "pop", "pct_black", "pct_vacant", "medinck", "n_seg"] + [c for c, _, _, _ in FEATURES]
    for f in geo["features"]:
        props = {}
        for k in keep:
            v = f["properties"].get(k)
            if v is None or (isinstance(v, float) and np.isnan(v)):
                props[k] = None
            elif k in ("GEOID",):
                props[k] = str(v)
            elif k in ("pop", "n_seg"):
                props[k] = int(v)
            else:
                props[k] = round(float(v), 2)
        f["properties"] = props
        f.pop("id", None)
        quantize(f["geometry"])
    with open(os.path.join(out, "tracts.geojson"), "w") as fh:
        json.dump(geo, fh, separators=(",", ":"))

    # ------------------------------------------------- neighborhood overlay
    hoods = gpd.read_file(
        os.path.join(src, "rawdata", "selected_neighborhoods", "selected_neighborhoods.shp")
    ).to_crs(4326)
    hgeo = json.loads(hoods.set_geometry(hoods.geometry.simplify(0.0002, preserve_topology=True)).to_json())
    for f in hgeo["features"]:
        pt = pole_of_inaccessibility(hoods.loc[int(f["id"]), "geometry"])
        f["properties"] = {
            "name": f["properties"]["NHD_NAME"],
            "cx": round(pt.x, 5),
            "cy": round(pt.y, 5),
        }
        f.pop("id", None)
        quantize(f["geometry"], 4)
    with open(os.path.join(out, "neighborhoods.geojson"), "w") as fh:
        json.dump(hgeo, fh, separators=(",", ":"))

    # ----------------------------------------------------- tract stats CSV
    stats_cols = ["GEOID", "n_seg", "pop", "pct_black", "pct_vacant", "medinck"] + [c for c, _, _, _ in FEATURES]
    rename = {c: k for c, k, _, _ in FEATURES}
    csv = tracts[stats_cols].rename(columns=rename).round(2)
    csv.to_csv(os.path.join(out, "tract_stats.csv"), index=False)

    # ------------------------------------------------------- segments CSV
    seg_out = seg.copy()
    seg_out["lat"] = seg_out["lat"].round(5)
    seg_out["lon"] = seg_out["lon"].round(5)
    seg_out["GEOID"] = joined["GEOID"].values
    seg_out.to_csv(os.path.join(out, "segments.csv"), index=False)

    # ------------------------------------------- segment prevalence (Table 1)
    inventory = []
    for col, label, present, status, ac1, agree in SEGMENT_ITEMS:
        vals = seg[col].astype(str)
        n_present = int(vals.isin(present).sum())
        inventory.append({
            "key": col,
            "label": label,
            "pct": round(100.0 * n_present / len(seg), 1),
            "n": n_present,
            "total": int(len(seg)),
            "status": status,
            "ac1": ac1,
            "agreement": agree,
        })
    inventory.sort(key=lambda d: -d["pct"])

    # -------------------------------------------------------- associations
    assoc = {}
    for xcol, xlabel, xunit, xaxis in CORRELATES:
        for ycol, ykey, ylabel, _ in FEATURES:
            assoc[f"{ykey}|{xcol}"] = fit(tracts[xcol], tracts[ycol])

    points = []
    for _, row in tracts.iterrows():
        rec = {"g": row["GEOID"], "n": int(row["n_seg"])}
        for xcol, *_ in CORRELATES:
            v = row[xcol]
            rec[xcol] = None if pd.isna(v) else round(float(v), 2)
        for ycol, ykey, *_ in FEATURES:
            rec[ykey] = round(float(row[ycol]), 2)
        points.append(rec)

    meta = {
        "generated": date.today().isoformat(),
        "n_segments": int(len(seg)),
        "n_tracts": int(len(tracts)),
        "n_tracts_income": int(tracts["medinck"].notna().sum()),
        "features": [{"key": k, "label": l, "col": c} for c, k, l, _ in FEATURES],
        "correlates": [
            {"key": c, "label": l, "unit": u, "axis": a} for c, l, u, a in CORRELATES
        ],
        "headline": {
            "hero": {"value": int(len(seg)), "label": "street segments audited"},
            "tiles": [
                {"key": "streetlights", "label": "Ample street lighting", "pct": 84.9},
                {"key": "continuity",   "label": "Continuous pavement",   "pct": 77.4},
                {"key": "curb_ramp",    "label": "Curb ramps",            "pct": 9.7},
                {"key": "crossing",     "label": "Marked crossings",      "pct": 7.1},
            ],
        },
        "notes": {"canopy": NOTE_CANOPY},
    }

    payload = {
        "meta": meta,
        "points": points,
        "assoc": assoc,
        "inventory": inventory,
        "validation": {
            "human": [
                {"feature": f, "n": n, "agreement": a, "ac1": k}
                for f, n, a, k in HUMAN_BENCHMARK
            ],
            "vlm": [
                {"feature": f, "n": n, "human_pct": hp, "vlm_pct": vp,
                 "agreement": a, "ac1": k, "sens": se, "spec": sp, "status": st}
                for f, n, hp, vp, a, k, se, sp, st in VLM_VALIDATION
            ],
            "coherence": [
                {"feature": f, "group_a": ga, "pct_a": pa, "group_b": gb, "pct_b": pb, "kind": kind}
                for f, ga, pa, gb, pb, kind in COHERENCE
            ],
            "pooled_human_agreement": 85.2,
            "pooled_human_n": 122,
        },
        "evidence": EVIDENCE,
    }
    with open(os.path.join(out, "dashboard.json"), "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))

    # ------------------------------------------------------------- report
    print(f"wrote {out}")
    for name in sorted(os.listdir(out)):
        size = os.path.getsize(os.path.join(out, name))
        print(f"  {name:24s} {size/1024:8.1f} KB")
    print(f"\n{len(seg):,} segments -> {len(tracts)} tracts "
          f"(median {int(tracts['n_seg'].median())} segments/tract, "
          f"min {int(tracts['n_seg'].min())}, max {int(tracts['n_seg'].max())})")
    print("\nRegression check (should match Figures 1 and 2):")
    for xcol, xlabel, _, _ in CORRELATES[:2]:
        print(f"  {xlabel}")
        for ycol, ykey, ylabel, _ in FEATURES:
            a = assoc[f"{ykey}|{xcol}"]
            print(f"    {ylabel:32s} slope {a['slope']:+.2f}{a['stars']:3s} "
                  f"intercept {a['intercept']:6.2f}  n={a['n']}")


if __name__ == "__main__":
    main()
