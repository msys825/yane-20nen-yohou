"""検証用の家の診断データを、アプリが読む JSON（app/public/data/houses/）に書き出す

使い方:
  python3 tools/export_app_data.py <LOD2タイルのフォルダ> <点群の切り出しフォルダ> <建物索引JSON>
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from future_shade import BuildingIndex, future_generation, hull_lonlat  # noqa: E402
from plateau_tiles import read_batch_table  # noqa: E402
from zoning import height_limits, max_buildable_height  # noqa: E402
from roof_from_pc import fit_planes, obstacles_excluding, roof_points  # noqa: E402
from solar_engine import load_weather  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app/public/data/houses"

lod2_dir, crop_dir, index_path = sys.argv[1:4]
houses = json.load(open(ROOT / "data/validation/houses.json"))
if (ROOT / "data/demo_houses.json").exists():
    houses += json.load(open(ROOT / "data/demo_houses.json"))  # 動画用のデモの家
weather = load_weather(ROOT)
index = BuildingIndex(index_path, lod2_dir)
by_gml = {r["gml_id"]: k for k, r in enumerate(index.rows)}


def building_zone(q: int) -> str | None:
    """建物ごとの属性にある用途地域（PLATEAU の用途地域の地図データより新しいことがある。例：北町五丁目の新しい道路沿い）"""
    r = index.rows[q]
    a = (read_batch_table(f"{lod2_dir}/{r['tile']}").get("attributes") or [{}])[r["i"]] or {}
    return ((a.get("uro:BuildingDetailAttribute") or [{}])[0]).get("uro:districtsAndZonesType")


def south_neighbor(k: int) -> dict | None:
    """真南（150〜210度、20m 以内）でいちばん近い建物：今の高さと、ルール上の最大の高さ（2軒を比べる画面で使う）"""
    hx, hy = index.xy[k]
    best = None
    for q in index.near(hx, hy, 20):
        if q == k:
            continue
        dx, dy = index.xy[q] - (hx, hy)
        b = (math.degrees(math.atan2(dx, dy)) + 360) % 360
        d = math.hypot(dx, dy)
        if 150 <= b <= 210 and (best is None or d < best[1]):
            best = (q, d, b)
    if best is None:
        return None
    q, d, b = best
    r = index.rows[q]
    h_max, why = max_buildable_height(height_limits(r["lon"], r["lat"]), r.get("far"), r.get("cov"))
    zone = building_zone(q)
    return {"gmlId": r["gml_id"], "usage": r["usage"], "storeys": r["st"], "nowHeight": r["h"], "maxHeight": h_max,
            "reason": why, "zone": zone, "floorAreaRate": r.get("far"), "coverageRate": r.get("cov"),
            "distance": round(float(d), 1), "bearing": round(b)}


OUT.mkdir(parents=True, exist_ok=True)
listing = []
for h in houses:
    no = str(h["no"])
    k = by_gml[h["gml_id"]]
    tris = index.triangles(k)
    crop = dict(np.load(Path(crop_dir) / f"{no}.npz"))
    P, ground = roof_points(crop, tris)
    planes = fit_planes(P) if len(P) >= 60 else []
    obstacles = obstacles_excluding(crop, tris, ground)
    r = future_generation(planes, obstacles, index, k, ground, weather, h["y"], h["x"])
    hull, base = hull_lonlat(tris)
    volumes = []
    for v in r["volumes"]:
        vt = index.triangles(v["k"])
        vh, vbase = hull_lonlat(vt)
        volumes.append({"gmlId": v["gml_id"], "footprint": vh, "baseHeight": round(vbase, 2), "nowHeight": v["now_h"],
                        "maxHeight": v["max_h"], "reason": v["why"], "distance": v["distance_m"], "bearing": v["bearing"],
                        "zone": building_zone(v["k"]) or v["zone"]})
    doc = {
        "no": int(no), "label": h.get("label"), "gmlId": h["gml_id"], "buildingId": h["bid"], "address": h["addr"],
        "lon": h["x"], "lat": h["y"], "footprint": hull, "baseHeight": round(base, 2),
        "storeys": h["st"], "height": h["h"], "zone": h["zone"], "floorAreaRate": h["far"], "coverageRate": h["cov"],
        "roof": {"planes": [{"tilt": p.tilt, "azimuth": p.azimuth, "area": p.area_m2, "usable": p.usable_m2} for p in planes],
                 "pointCount": int(len(P))},
        "now": {"kw": r["now"]["kw"], "kwh": r["now"]["kwh"], "kwhWithoutShade": r["now"]["kwh_without_shade"],
                "irradiance": r["now"]["irradiance_kwh_m2"]},
        "future": {"kwh": r["future"]["kwh"], "irradiance": r["future"]["irradiance_kwh_m2"], "change": r["change"]},
        "volumes": volumes,
        "southNeighbor": south_neighbor(k),
        "sources": ["国土交通省 Project PLATEAU（東京都練馬区 2025年度）", "東京都デジタルツイン実現プロジェクト 区部点群データ",
                    "NEDO 年間時別日射量データベース（METPV-11）東京"],
    }
    json.dump(doc, open(OUT / f"{h['gml_id']}.json", "w"), ensure_ascii=False)
    listing.append({"gmlId": h["gml_id"], "no": int(no), "label": h.get("label"), "lon": h["x"], "lat": h["y"], "change": r["change"],
                    "topHeight": round(base + (h["h"] or 0) + 2, 1)})
    print(no, r["now"]["kwh"], r["future"]["kwh"], len(volumes), flush=True)

json.dump(listing, open(OUT / "index.json", "w"), ensure_ascii=False)
print("saved", len(listing))
