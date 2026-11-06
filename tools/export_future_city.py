"""「建ちうる未来の街」：ある範囲の建物を、ルール上の最大の高さまで建て替えた姿を、アプリが読む JSON に書き出す

範囲の中で、ルール上 今より 3m 以上高くできる建物について、外形（凸包）・地面の高さ・今の高さ・最大の高さを出す。
最大の高さは tools/scan_max_heights.py の結果（容積率÷建ぺい率の階数×3m、用途地域・高度地区の上限のうち最も低いもの）。

使い方:
  python3 tools/export_future_city.py <LOD2タイルのフォルダ> <建物索引JSON> <最大の高さJSON> <出力JSON> <経度> <緯度> <半径m>
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from future_shade import BuildingIndex, hull_lonlat  # noqa: E402
from plateau_tiles import tile_building_triangles  # noqa: E402

lod2_dir, index_path, max_path, out_path = sys.argv[1:5]
lon, lat, radius = float(sys.argv[5]), float(sys.argv[6]), float(sys.argv[7])
index = BuildingIndex(index_path, lod2_dir)
maxh = json.load(open(max_path))
from pyproj import Transformer  # noqa: E402

cx, cy = Transformer.from_crs(4326, 6677, always_xy=True).transform(lon, lat)
near = index.near(cx, cy, radius)
by_tile: dict[str, list[int]] = defaultdict(list)
for k in near:
    r = index.rows[k]
    m = maxh[k]
    if r["h"] and m and m[0] and m[0] >= r["h"] + 3:
        by_tile[r["tile"]].append(k)

buildings = []
added = 0.0
for tile, ks in by_tile.items():
    tris = tile_building_triangles(f"{lod2_dir}/{tile}")
    for k in ks:
        r = index.rows[k]
        t = tris.get(r["i"])
        if t is None or len(t) == 0:
            continue
        fp, base = hull_lonlat(t)
        if len(fp) < 3:
            continue
        xy = np.array(fp)
        area = 0.5 * abs(np.dot(xy[:, 0], np.roll(xy[:, 1], 1)) - np.dot(xy[:, 1], np.roll(xy[:, 0], 1))) * (111320 * math.cos(math.radians(lat))) * 110950
        added += area * (m := maxh[k][0]) - area * r["h"]
        fp = [[round(a, 6), round(b_, 6)] for a, b_ in fp]  # 約10cm の精度で十分（ファイルを小さくする）
        buildings.append({"f": fp, "b": round(base, 1), "h": r["h"], "m": m})
    print(tile, len(ks), flush=True)

doc = {"center": [lon, lat], "radiusM": radius, "count": len(buildings), "candidates": len(near),
       "addedVolumeM3": round(added), "buildings": buildings,
       "source": "国土交通省 Project PLATEAU（東京都練馬区 2025年度）建築物・都市計画決定情報。最大の高さは容積率・建ぺい率・用途地域・高度地区から出した目安（斜線制限・日影規制は含まない）"}
json.dump(doc, open(out_path, "w"), ensure_ascii=False, separators=(",", ":"))
print(len(buildings), "of", len(near), "buildings can grow; added volume m3", round(added))
