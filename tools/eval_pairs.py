"""find_pair.py の候補（上位 N 組）について、本番と同じ計算で今と将来の発電量を出す

点群（図郭ごとに 1 回だけダウンロード）から屋根を測り、周りの建物・木の影と、南側が最大まで建ったときの影で計算する。

使い方:
  python3 tools/eval_pairs.py <LOD2タイルのフォルダ> <建物索引JSON> <候補JSON> <点群の切り出しフォルダ> <出力JSON> [N]
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

import laspy
import numpy as np
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).parent))
from future_shade import BuildingIndex, future_generation  # noqa: E402
from pcindex import mesh_for  # noqa: E402
from roof_from_pc import fit_planes, obstacles_excluding, roof_points  # noqa: E402
from solar_engine import load_weather  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
R = 60.0
_LL_TO_PLANE9 = Transformer.from_crs(4326, 6677, always_xy=True)

lod2_dir, index_path, pairs_path, crop_dir, out_path = sys.argv[1:6]
N = int(sys.argv[6]) if len(sys.argv) > 6 else 20
pairs = json.load(open(pairs_path))[:N]
# すでに計算した組は飛ばす（出力に追記していく）
done = json.load(open(out_path)) if Path(out_path).exists() else []
seen = {(p["a"], p["b"]) for p in done}
pairs = [p for p in pairs if (p["a"], p["b"]) not in seen]
index = BuildingIndex(index_path, lod2_dir)
weather = load_weather(ROOT)
os.makedirs(crop_dir, exist_ok=True)


def crop_path(k: int) -> Path:
    return Path(crop_dir) / f"k{k}.npz"


# 点群の切り出し（図郭ごとにまとめる）
need: dict[tuple[str, str], list[int]] = {}
for p in pairs:
    for k in (p["a"], p["b"]):
        if not crop_path(k).exists():
            r = index.rows[k]
            need.setdefault(mesh_for(r["lon"], r["lat"]), []).append(k)
for (mesh, url), ks in need.items():
    z = Path(crop_dir) / f"{mesh}.zip"
    urllib.request.urlretrieve(url, z)
    with zipfile.ZipFile(z) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".las"))
        zf.extract(name, crop_dir)
    las = laspy.read(Path(crop_dir) / name)
    X, Y, Zs, C = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z), np.asarray(las.classification)
    for k in set(ks):
        cx, cy = index.xy[k]
        m = (np.abs(X - cx) < R) & (np.abs(Y - cy) < R)
        np.savez_compressed(crop_path(k), x=X[m], y=Y[m], z=Zs[m].astype(np.float32), c=C[m], center=np.array([cx, cy]), mesh=mesh)
    os.remove(z)
    os.remove(Path(crop_dir) / name)
    print("点群", mesh, len(ks), flush=True)


def evaluate(k: int) -> dict:
    r = index.rows[k]
    tris = index.triangles(k)
    crop = dict(np.load(crop_path(k)))
    P, ground = roof_points(crop, tris)
    planes = fit_planes(P) if len(P) >= 60 else []
    obstacles = obstacles_excluding(crop, tris, ground)
    g = future_generation(planes, obstacles, index, k, ground, weather, r["lat"], r["lon"])
    kw = g["now"]["kw"]
    return {"kw": kw, "kwh_now": g["now"]["kwh"], "kwh_future": g["future"]["kwh"], "change": g["change"],
            "per_kw_now": round(g["now"]["kwh"] / kw) if kw else None, "per_kw_future": round(g["future"]["kwh"] / kw) if kw else None,
            "planes": [(round(p.tilt), round(p.azimuth), round(p.usable_m2, 1)) for p in planes],
            "volumes": [(v["distance_m"], v["bearing"], v["now_h"], v["max_h"]) for v in g["volumes"]]}


out = done
for n, p in enumerate(pairs):
    try:
        ea, eb = evaluate(p["a"]), evaluate(p["b"])
    except Exception as e:  # 屋根が測れない家などは飛ばす
        print(n, "skip", e, flush=True)
        continue
    out.append({**p, "eval": [ea, eb]})
    print(n, p["addr"][0], "A", ea["per_kw_now"], "→", ea["per_kw_future"], f"{ea['change']*100:+.0f}%", ea["kw"], "kW",
          "| B", eb["per_kw_now"], "→", eb["per_kw_future"], f"{eb['change']*100:+.0f}%", eb["kw"], "kW", flush=True)
    json.dump(out, open(out_path, "w"), ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
