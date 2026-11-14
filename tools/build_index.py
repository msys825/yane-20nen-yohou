"""建物の一覧を作る：ダウンロードした PLATEAU のタイル（tools/fetch_tiles.py）から、全建物の属性を1つの JSON にまとめる

全戸の計算（scan_max_heights.py・simple_diagnosis.py など）は、この一覧の順番（k）で建物を指す。
  建物索引 JSON：[{tile, i, gml_id, lon, lat, h, st, usage, zone, far, cov, hd}, …]
      tile＝タイルのファイル（フォルダからの相対パス）、i＝タイルの中の番号、h＝計測の高さ、st＝地上の階数、
      usage＝くわしい用途（なければ用途）、zone＝用途地域、far＝容積率、cov＝建ぺい率、
      hd＝高度地区の種類（1・2・3。建物の属性「高度地区」から。不明・指定なしは 0）
  外枠 JSON：[[幅m, 奥行m, 屋根の面積m², 住所, 地面の高さ（標高）], …]（一覧と同じ順）
同じ建物が複数のタイルに入っているとき（タイルの境をまたぐ建物）は、最初の1つだけを使う。
使い方:
  python3 tools/build_index.py work/lod2 work/index.json work/bbox.json
"""
import glob
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from plateau_tiles import read_batch_table  # noqa: E402

lod2, index_path, bbox_path = sys.argv[1:4]


def num(v):
    return v if isinstance(v, (int, float)) and v not in (9999, -9999) else None


HD = {"第一種高度地区": 1, "第二種高度地区": 2, "第三種高度地区": 3}

rows, bbox, seen = [], [], set()
files = sorted(glob.glob(f"{lod2}/**/*.b3dm", recursive=True), key=lambda f: (len(f), f))
for f in files:
    bt = read_batch_table(f)
    ids = bt.get("gml_id", [])
    for i, g in enumerate(ids):
        if g in seen:
            continue
        seen.add(g)
        a = bt["attributes"][i] or {}
        if isinstance(a, str):
            a = json.loads(a)
        detail = (a.get("uro:BuildingDetailAttribute") or [{}])[0] or {}
        col = lambda k: bt[k][i] if k in bt else None  # noqa: E731
        hd = next((kv.get("uro:codeValue") for kv in a.get("uro:KeyValuePairAttribute") or [] if kv.get("uro:key") == "高度地区"), None)
        lon, lat = col("_x"), col("_y")
        rows.append({
            "tile": os.path.relpath(f, lod2), "i": i, "gml_id": g, "lon": lon, "lat": lat,
            "h": num(col("bldg:measuredHeight")), "st": num(col("bldg:storeysAboveGround")),
            "usage": detail.get("uro:detailedUsage") or col("bldg:usage"),
            "zone": detail.get("uro:districtsAndZonesType"),
            "far": num(detail.get("uro:specifiedFloorAreaRate")), "cov": num(detail.get("uro:specifiedBuildingCoverageRate")),
            "hd": HD.get(hd, 0),
        })
        w = (col("_xmax") - col("_xmin")) * 111320 * math.cos(math.radians(lat))
        d = (col("_ymax") - col("_ymin")) * 110950
        bbox.append([round(w, 1), round(d, 1), num(detail.get("uro:buildingRoofEdgeArea")), col("bldg:address"), col("_zmin")])
json.dump(rows, open(index_path, "w"), ensure_ascii=False, separators=(",", ":"))
json.dump(bbox, open(bbox_path, "w"), ensure_ascii=False, separators=(",", ":"))
print(len(rows), "buildings;", sum(1 for r in rows if r["usage"] == "独立住宅" and r["h"]), "detached houses with height")
