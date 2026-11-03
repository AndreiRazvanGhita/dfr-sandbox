"""Build the static data files the sandbox loads.

Pulls from DataSF (Socrata API), filters to 911-originated police calls,
re-assigns every call to the Oct 2026 police district boundaries, and writes
compact columnar JSON into public/data/. Standard library only (Python 3.9+).

    python3 -I pipeline/build_data.py                      # default months (Aug + Oct 2026)
    python3 -I pipeline/build_data.py --months 2026-09 --refresh
"""

import argparse
import datetime as dt
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data"
ASSUMPTIONS = json.loads((ROOT / "config" / "assumptions.json").read_text())

API = "https://data.sf.gov/resource"
CALLS_ID = ASSUMPTIONS["data"]["callsDataset"]["value"]
DISTRICTS_ID = ASSUMPTIONS["data"]["districtsDataset"]["value"]
STREETS_ID = ASSUMPTIONS["data"]["streetsDataset"]["value"]
CALL_FILTER = ASSUMPTIONS["data"]["callFilter"]["value"]

CALL_FIELDS = [
    "cad_number", "dup_cad_number", "received_datetime", "entry_datetime",
    "dispatch_datetime", "onscene_datetime", "close_datetime", "call_type_original",
    "call_type_original_desc", "priority_original", "disposition", "sensitive_call",
    "intersection_point",
]
PAGE = 50000


def fetch_bytes(url, cache_name, refresh):
    path = RAW / cache_name
    if path.exists() and not refresh:
        return path.read_bytes()
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json, text/csv"})
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            return body
        except Exception as e:  # network hiccups: retry with backoff
            if attempt == 3:
                raise
            print(f"  retry {attempt + 1} after error: {e}")
            time.sleep(2 ** attempt)


def fetch_json(url, cache_name, refresh):
    return json.loads(fetch_bytes(url, cache_name, refresh))


def soql_url(dataset, params, fmt="json"):
    return f"{API}/{dataset}.{fmt}?" + urllib.parse.urlencode(params)


# ---------- districts ----------

def round_coords(obj, nd=5):
    if isinstance(obj, list):
        if obj and isinstance(obj[0], (int, float)):
            return [round(v, nd) for v in obj]
        return [round_coords(o, nd) for o in obj]
    return obj


def build_districts(refresh):
    gj = fetch_json(soql_url(DISTRICTS_ID, {"$limit": 50}, "geojson"), "districts.geojson", refresh)
    feats = []
    for f in gj["features"]:
        feats.append({
            "type": "Feature",
            "properties": {"district": f["properties"]["district"].title()},
            "geometry": {"type": f["geometry"]["type"], "coordinates": round_coords(f["geometry"]["coordinates"])},
        })
    feats.sort(key=lambda f: f["properties"]["district"])
    out = {"type": "FeatureCollection", "features": feats,
           "source": f"DataSF {DISTRICTS_ID}, boundaries effective 2026-10-01 (PDDL)"}
    (OUT / "districts.geojson").write_text(json.dumps(out, separators=(",", ":")))
    print(f"districts: {len(feats)} features")
    return feats


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def make_district_lookup(feats):
    polys = []  # (name, bbox, [polygon rings])
    for f in feats:
        g = f["geometry"]
        parts = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        xs = [p[0] for part in parts for p in part[0]]
        ys = [p[1] for part in parts for p in part[0]]
        polys.append((f["properties"]["district"], (min(xs), min(ys), max(xs), max(ys)), parts))

    def lookup(x, y):
        for name, (x0, y0, x1, y1), parts in polys:
            if not (x0 <= x <= x1 and y0 <= y <= y1):
                continue
            for part in parts:
                if point_in_ring(x, y, part[0]) and not any(point_in_ring(x, y, h) for h in part[1:]):
                    return name
        return None

    return lookup


# ---------- calls ----------

def parse_ts(s):
    return dt.datetime.fromisoformat(s) if s else None


def fetch_month(month, refresh):
    y, m = map(int, month.split("-"))
    start = dt.date(y, m, 1)
    end = dt.date(y + (m == 12), m % 12 + 1, 1)
    where = f"{CALL_FILTER} AND received_datetime >= '{start}' AND received_datetime < '{end}'"
    rows, offset = [], 0
    while True:
        params = {"$select": ",".join(CALL_FIELDS), "$where": where,
                  "$order": "received_datetime,cad_number", "$limit": PAGE, "$offset": offset}
        page = fetch_json(soql_url(CALLS_ID, params), f"calls-{month}-{offset}.json", refresh)
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return rows


def build_month(month, district_of, district_names, refresh):
    rows = fetch_month(month, refresh)
    days, day_idx = [], {}
    types, type_idx = [], {}
    dists = sorted(district_names)
    dist_idx = {d: i for i, d in enumerate(dists)}
    dispos, dispo_idx = [], {}
    cols = {k: [] for k in ["day", "t", "entry", "disp", "onscene", "close", "lon", "lat",
                            "type", "prio", "dist", "dispo", "dup"]}
    stats = {"rows": len(rows), "noPoint": 0, "sensitive": 0, "noOnscene": 0, "badOrder": 0}

    def tidx(code, desc):
        code = code or "?"
        if code not in type_idx:
            type_idx[code] = len(types)
            types.append([code, (desc or "").strip().upper()])
        return type_idx[code]

    for r in rows:
        rec = parse_ts(r["received_datetime"])
        day = rec.date().isoformat()
        if day not in day_idx:
            day_idx[day] = len(days)
            days.append(day)
        midnight = dt.datetime.combine(rec.date(), dt.time())

        def off(field):
            v = parse_ts(r.get(field))
            if v is None:
                return None
            s = int((v - rec).total_seconds())
            return s if s >= 0 else None

        entry, disp, onscene = off("entry_datetime"), off("dispatch_datetime"), off("onscene_datetime")
        close = off("close_datetime")
        if onscene is None:
            stats["noOnscene"] += 1
        if r.get("onscene_datetime") and onscene is None:
            stats["badOrder"] += 1

        pt = r.get("intersection_point")
        sens = bool(r.get("sensitive_call"))
        stats["sensitive"] += sens
        if pt and not sens:
            lon, lat = round(pt["coordinates"][0], 5), round(pt["coordinates"][1], 5)
            d = district_of(lon, lat)
        else:
            lon = lat = d = None
            stats["noPoint"] += 1

        dispo = r.get("disposition") or "?"
        if dispo not in dispo_idx:
            dispo_idx[dispo] = len(dispos)
            dispos.append(dispo)

        cols["day"].append(day_idx[day])
        cols["t"].append(int((rec - midnight).total_seconds()))
        cols["entry"].append(entry)
        cols["disp"].append(disp)
        cols["onscene"].append(onscene)
        cols["close"].append(close)
        cols["lon"].append(lon)
        cols["lat"].append(lat)
        cols["type"].append(tidx(r.get("call_type_original"), r.get("call_type_original_desc")))
        cols["prio"].append((r.get("priority_original") or "?")[:1])
        cols["dist"].append(dist_idx[d] if d else None)
        cols["dispo"].append(dispo_idx[dispo])
        cols["dup"].append(1 if r.get("dup_cad_number") else 0)

    out = {
        "month": month,
        "source": f"DataSF {CALLS_ID} (PDDL), filter: {CALL_FILTER}. Locations geo-masked to intersections by DataSF. "
                  "Times are local (America/Los_Angeles); offsets are seconds after received_datetime.",
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "days": days,
        "types": types,
        "districts": dists,
        "dispositions": dispos,
        "stats": stats,
        "cols": cols,
    }
    (OUT / f"calls-{month}.json").write_text(json.dumps(out, separators=(",", ":")))
    per_day = [0] * len(days)
    for d in cols["day"]:
        per_day[d] += 1
    print(f"calls {month}: {len(rows)} rows, {len(days)} days, stats={stats}")
    return {"month": month, "days": [{"date": d, "calls": n} for d, n in zip(days, per_day)]}


# ---------- streets (for officer cars on the map) ----------

DRIVABLE = ("STREETS", "FREEWAYS", "UPROW", "PARKS", "PARKS_NPS_PRESIDIO", "PARKS_NPS_FTMASON",
            "STREETS_HUNTERSP", "STREETS_TI", "STREETS_YBI")


def build_streets(refresh):
    """Street graph: nodes are intersections, edges are centerline segments with their shape and one-way flag."""
    layers = ",".join(f"'{l}'" for l in DRIVABLE)
    rows, offset = [], 0
    while True:
        params = {"$select": "cnn,f_node_cnn,t_node_cnn,oneway,line", "$where": f"active = true AND layer in ({layers})",
                  "$order": "cnn", "$limit": PAGE, "$offset": offset}
        page = fetch_json(soql_url(STREETS_ID, params), f"streets-{offset}.json", refresh)
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    node_idx, nodes, edges = {}, [], []

    def node(cnn, pt):
        if cnn not in node_idx:
            node_idx[cnn] = len(nodes)
            nodes.append([round(pt[0], 5), round(pt[1], 5)])
        return node_idx[cnn]

    for r in rows:
        line = r.get("line")
        if not line or not r.get("f_node_cnn") or not r.get("t_node_cnn"):
            continue
        pts = line["coordinates"]
        if line["type"] == "MultiLineString":
            pts = [p for part in pts for p in part]
        if len(pts) < 2:
            continue
        a, b = node(r["f_node_cnn"], pts[0]), node(r["t_node_cnn"], pts[-1])
        if a == b:
            continue
        way = {"F": 1, "T": -1}.get(r.get("oneway"), 0)  # 1: from->to only, -1: to->from only, 0: both
        mid = [c for p in pts[1:-1] for c in (round(p[0], 5), round(p[1], 5))]
        edges.append([a, b, way, mid])
    out = {"source": f"DataSF {STREETS_ID} (PDDL), active drivable centerlines", "nodes": nodes, "edges": edges}
    (OUT / "streets.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"streets: {len(nodes)} intersections, {len(edges)} segments")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", nargs="+", default=["2026-08", "2026-10"])
    ap.add_argument("--refresh", action="store_true", help="ignore the raw download cache")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    feats = build_districts(args.refresh)
    district_names = [f["properties"]["district"] for f in feats]
    district_of = make_district_lookup(feats)
    build_streets(args.refresh)

    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"months": []}
    keep = {m["month"]: m for m in manifest["months"]}
    for month in args.months:
        keep[month] = build_month(month, district_of, district_names, args.refresh)

    manifest = {
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "months": [keep[k] for k in sorted(keep)],
        "attribution": "Data: DataSF (PDDL). Imagery: Esri World Imagery (Esri, Vantor, Earthstar Geographics, and the GIS User Community). "
                       "Labels and streets basemap: OpenStreetMap contributors via OpenFreeMap.",
    }
    manifest_path.write_text(json.dumps(manifest, indent=1))
    print("manifest:", [m["month"] for m in manifest["months"]])


if __name__ == "__main__":
    main()
