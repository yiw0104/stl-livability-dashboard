#!/usr/bin/env python
"""
Curate a small set of example Street View panoramas for the dashboard.

For each built-environment feature the dashboard can display, this picks one
segment the model rated the feature *present* on and one it rated *absent*,
downsamples the panorama, and writes a manifest the page reads.

Only a handful of images are published — enough to show a reader what the model
was looking at, not a redistribution of the imagery corpus. Each is attributed to
Google on the page and carries a link to the live Street View location.

Usage:
    python build/panoramas.py --images "/path/to/Validation data/images"
"""

import argparse
import json
import os
import sys

import pandas as pd
from PIL import Image

DEFAULT_SRC = (
    "/Users/yi/Library/CloudStorage/Box-Box/Measuring Spatial Inequalities in "
    "Urban Communities/Quantitative_Analysis"
)
DEFAULT_IMAGES = (
    "/Users/yi/Library/CloudStorage/Box-Box/Measuring Spatial Inequalities in "
    "Urban Communities/Validation data/images"
)

OUT_W, OUT_H, QUALITY = 1400, 350, 68

# feature key -> (column, present value(s), absent value(s), corroborating filters)
#
# The corroborating filters bias selection toward unambiguous examples: a segment
# is only a candidate if a second, related rating agrees with the story the image
# is being asked to tell. Most are pinned to residential segments so the pair
# differs in the feature under discussion rather than in land use.
#
# Features are visited in RANK order — the scarcest first — because a rare
# feature has few candidates and should get first claim on them. No panorama is
# used twice across the whole set.
RANK = ["crossing", "curb_ramp", "streetlights", "no_hazard",
        "continuity", "pavement", "canopy", "facade"]

RESID = {"segment_type": "Residential"}
PAVED = {"pavement_presence": "Yes"}

SPECS = {
    "streetlights": ("streetlights", ["Ample"], ["No"],
                     {"present": {"segment_type": "Commercial", **PAVED}, "absent": dict(RESID)}),
    "facade":       ("building_maintenance", ["2"], ["0"],
                     {"present": dict(RESID, graffiti="No", **PAVED),
                      "absent":  dict(RESID, graffiti="Yes")}),
    "pavement":     ("pavement_presence", ["Yes"], ["No"],
                     {"present": dict(RESID, pavement_continuity="Yes"),
                      "absent":  dict(RESID)}),
    "continuity":   ("pavement_continuity", ["Yes"], ["No"],
                     {"present": dict(RESID, **PAVED), "absent": dict(RESID, **PAVED)}),
    "no_hazard":    ("pavement_trip_major", ["0"], ["1"],
                     {"present": dict(RESID, pavement_trip_minor="0", **PAVED),
                      "absent":  dict(RESID, pavement_trip_minor="1", **PAVED)}),
    "crossing":     ("ped_crossing", ["Yes"], ["No"],
                     {"present": {"walk_signal": "Yes"}, "absent": dict(RESID, **PAVED)}),
    "curb_ramp":    ("curb_ramp", ["Yes"], ["No"],
                     {"present": dict(ped_crossing="Yes", **PAVED),
                      "absent":  dict(RESID, **PAVED)}),
    "canopy":       ("tree_overhead", ["high"], ["low"],
                     {"present": dict(RESID, public_park="No", **PAVED),
                      "absent":  dict(RESID, **PAVED)}),
}

# Index into each slot's candidate pool. The pool is shuffled with a fixed seed,
# so the choice is stable across runs; bump a number to swap in a different
# example after eyeballing the contact sheet.
PICKS = {
    "streetlights": {"present": 1, "absent": 0},
    "facade":       {"present": 0, "absent": 0},
    "pavement":     {"present": 0, "absent": 0},
    "continuity":   {"present": 0, "absent": 0},
    "no_hazard":    {"present": 1, "absent": 0},
    "crossing":     {"present": 0, "absent": 0},
    "curb_ramp":    {"present": 2, "absent": 0},
    "canopy":       {"present": 0, "absent": 0},
}

# Explicit image_id pins, which beat PICKS. Street View imagery of St. Louis was
# largely captured with the trees bare, so a segment the model rated "high tree
# canopy" usually *looks* like bare branches. These two were chosen by scoring
# candidates on an excess-green index over the overhead band, so the published
# pair actually shows the contrast the rating is about.
OVERRIDES = {
    ("canopy", "present"): 5039,
    ("canopy", "absent"): 4668,
}

LABELS = {
    "streetlights": ("Ample street lighting", "No street lighting"),
    "facade":       ("Well-maintained facades", "Poorly maintained facades"),
    "pavement":     ("Pavement present", "No pavement"),
    "continuity":   ("Continuous pavement", "Discontinuous pavement"),
    "no_hazard":    ("No major tripping hazards", "Major tripping hazards"),
    "crossing":     ("Marked pedestrian crossing", "No marked crossing"),
    "curb_ramp":    ("Curb ramp present", "No curb ramp"),
    "canopy":       ("High tree canopy overhead", "Low tree canopy overhead"),
}


def index_images(images_dir):
    """Map image_id -> filename. Names look like '1000_panorama_<lat>_<lon>.jpg'."""
    out = {}
    for name in os.listdir(images_dir):
        if not name.endswith(".jpg"):
            continue
        head = name.split("_", 1)[0]
        if head.isdigit():
            out[int(head)] = name
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--images", default=DEFAULT_IMAGES)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data"))
    ap.add_argument("--contact-sheet", default=None,
                    help="also write a single contact sheet here for review")
    args = ap.parse_args()

    if not os.path.isdir(args.images):
        sys.exit("images directory not found: " + args.images)

    out = os.path.abspath(args.out)
    img_out = os.path.join(out, "panoramas")
    os.makedirs(img_out, exist_ok=True)

    seg = pd.read_csv(os.path.join(args.src, "rawdata", "merged_results.csv"), dtype=str)
    seg["image_id"] = seg["image_id"].astype(int)
    available = index_images(args.images)
    seg = seg[seg["image_id"].isin(available)]

    manifest, sheet_items = {}, []
    used = set()
    for key in RANK:
        col, present_vals, absent_vals, clarity = SPECS[key]
        manifest[key] = {}
        for slot, vals in (("present", present_vals), ("absent", absent_vals)):
            pool = seg[seg[col].isin(vals)]
            strict = pool
            for k, v in clarity.get(slot, {}).items():
                strict = strict[strict[k] == v]
            if len(strict) == 0:
                strict = pool          # fall back if the filters are too tight
            # Shuffle first, then drop already-used images. Doing it the other way
            # round makes the permutation depend on what earlier slots consumed,
            # so a PICKS index would silently point at a different panorama
            # whenever an unrelated slot changed.
            pool = strict.sample(frac=1.0, random_state=20260921)
            pool = pool[~pool["image_id"].isin(used)].reset_index(drop=True)
            if len(pool) == 0:
                sys.exit("no unused candidate for %s/%s" % (key, slot))

            pin = OVERRIDES.get((key, slot))
            if pin is not None:
                match = seg[seg["image_id"] == pin]
                if len(match) == 0:
                    sys.exit("pinned image %d not found for %s/%s" % (pin, key, slot))
                row = match.iloc[0]
            else:
                row = pool.iloc[PICKS[key][slot] % len(pool)]
            used.add(int(row["image_id"]))
            src_name = available[int(row["image_id"])]
            dst_name = "%s_%s.jpg" % (key, slot)

            with Image.open(os.path.join(args.images, src_name)) as im:
                im = im.convert("RGB").resize((OUT_W, OUT_H), Image.LANCZOS)
                im.save(os.path.join(img_out, dst_name), "JPEG",
                        quality=QUALITY, optimize=True, progressive=True)
                sheet_items.append((key, slot, im.copy()))

            lat, lon = float(row["lat"]), float(row["lon"])
            manifest[key][slot] = {
                "file": "data/panoramas/" + dst_name,
                "label": LABELS[key][0 if slot == "present" else 1],
                "image_id": int(row["image_id"]),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "streetview": ("https://www.google.com/maps/@?api=1&map_action=pano"
                               "&viewpoint=%.6f,%.6f" % (lat, lon)),
            }

    with open(os.path.join(out, "panoramas.json"), "w") as fh:
        json.dump({
            "attribution": "Imagery © Google",
            "note": ("These are real photographs from the study, not illustrations. Each one "
                     "links to the same spot in Street View today \u2014 Google may have "
                     "re-photographed the street since, so it might not look the same."),
            "items": manifest,
        }, fh, indent=1)

    if args.contact_sheet:
        cols, pad = 2, 8
        rows = (len(sheet_items) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (OUT_W + pad), rows * (OUT_H + pad)), "white")
        for i, (_, _, im) in enumerate(sheet_items):
            sheet.paste(im, ((i % cols) * (OUT_W + pad), (i // cols) * (OUT_H + pad)))
        sheet.save(args.contact_sheet, "JPEG", quality=70, optimize=True)
        print("contact sheet: " + args.contact_sheet)
        for i, (k, s, _) in enumerate(sheet_items):
            print("  cell %2d (row %d, %s): %s / %s" % (i + 1, i // cols + 1,
                  "left" if i % cols == 0 else "right", k, s))

    total = sum(os.path.getsize(os.path.join(img_out, f)) for f in os.listdir(img_out))
    print("\nwrote %d panoramas, %.1f KB total" % (len(sheet_items), total / 1024))


if __name__ == "__main__":
    main()
