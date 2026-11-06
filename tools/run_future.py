"""検証用の家について、今と将来（南側が最大まで建て替わったとき）の発電量を計算して JSON に保存する

使い方:
  python3 tools/run_future.py <LOD2タイルのフォルダ> <点群の切り出しフォルダ> <建物索引JSON> <出力JSON> [No ...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from future_shade import BuildingIndex, future_generation  # noqa: E402
from roof_from_pc import fit_planes, obstacles_excluding, roof_points  # noqa: E402
from solar_engine import load_weather  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
lod2_dir, crop_dir, index_path, out_path = sys.argv[1:5]
targets = sys.argv[5:] or [str(n) for n in range(41, 51)]

houses = {str(h["no"]): h for h in json.load(open(ROOT / "data/validation/houses.json"))}
if (ROOT / "data/demo_houses.json").exists():
    houses.update({str(h["no"]): h for h in json.load(open(ROOT / "data/demo_houses.json"))})
weather = load_weather(ROOT)
index = BuildingIndex(index_path, lod2_dir)
by_gml = {r["gml_id"]: k for k, r in enumerate(index.rows)}

results = {}
for no in targets:
    h = houses[no]
    k = by_gml[h["gml_id"]]
    tris = index.triangles(k)
    crop = dict(np.load(Path(crop_dir) / f"{no}.npz"))
    P, ground = roof_points(crop, tris)
    planes = fit_planes(P) if len(P) >= 60 else []
    obstacles = obstacles_excluding(crop, tris, ground)
    r = future_generation(planes, obstacles, index, k, ground, weather, h["y"], h["x"])
    results[no] = {"kwh_now": r["now"]["kwh"], "kwh_future": r["future"]["kwh"], "change": r["change"], "kw": r["now"]["kw"],
                   "volumes": r["volumes"]}
    vols = [(v["distance_m"], v["bearing"], v["now_h"], v["max_h"]) for v in r["volumes"]]
    print(no, "今", r["now"]["kwh"], "将来", r["future"]["kwh"], f"変化 {r['change']*100:+.1f}%", "南側の建て替え候補(距離,方位,今の高さ,最大)", vols, flush=True)

json.dump(results, open(out_path, "w"), ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
