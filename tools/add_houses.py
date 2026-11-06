"""検証用の50軒以外の家（動画用のデモの家など）を追加する。
点群をダウンロードして家のまわりを切り出し、data/demo_houses.json に家の情報を書き足す。

使い方:
  python3 tools/add_houses.py <LOD2タイルのフォルダ> <建物索引JSON> <点群の切り出しフォルダ> <gml_id> [<gml_id> ...]
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
from future_shade import BuildingIndex  # noqa: E402
from pcindex import mesh_for  # noqa: E402
from plateau_tiles import read_batch_table  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "data/demo_houses.json"
R = 60.0
_LL_TO_PLANE9 = Transformer.from_crs(4326, 6677, always_xy=True)

lod2_dir, index_path, crop_dir = sys.argv[1:4]
gml_ids = sys.argv[4:]
index = BuildingIndex(index_path, lod2_dir)
by_gml = {r["gml_id"]: k for k, r in enumerate(index.rows)}
demo = json.load(open(DEMO)) if DEMO.exists() else []
known = {h["gml_id"] for h in demo}
next_no = max([h["no"] for h in demo], default=100) + 1

new = []
for g in gml_ids:
    if g in known:
        continue
    r = index.rows[by_gml[g]]
    bt = read_batch_table(f"{lod2_dir}/{r['tile']}")
    a = (bt.get("attributes") or [{}])[r["i"]] or {}
    d = (a.get("uro:BuildingDetailAttribute") or [{}])[0]
    new.append({"no": next_no, "gml_id": g, "bid": (a.get("uro:BuildingIDAttribute") or [{}])[0].get("uro:buildingID"),
                "addr": a.get("bldg:address") or "東京都練馬区", "x": r["lon"], "y": r["lat"], "h": r["h"], "st": r["st"],
                "zone": d.get("uro:districtsAndZonesType"), "far": r["far"], "cov": r["cov"], "group": "D_デモ"})
    next_no += 1

# 点群：図郭ごとにまとめて 1 回だけダウンロードする
os.makedirs(crop_dir, exist_ok=True)
by_mesh: dict[tuple[str, str], list[dict]] = {}
for h in new:
    if not (Path(crop_dir) / f"{h['no']}.npz").exists():
        by_mesh.setdefault(mesh_for(h["x"], h["y"]), []).append(h)
for (mesh, url), hs in by_mesh.items():
    z = Path(crop_dir) / f"{mesh}.zip"
    urllib.request.urlretrieve(url, z)
    with zipfile.ZipFile(z) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".las"))
        zf.extract(name, crop_dir)
    las = laspy.read(Path(crop_dir) / name)
    X, Y, Zs, C = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z), np.asarray(las.classification)
    for h in hs:
        cx, cy = _LL_TO_PLANE9.transform(h["x"], h["y"])
        m = (np.abs(X - cx) < R) & (np.abs(Y - cy) < R)
        np.savez_compressed(Path(crop_dir) / f"{h['no']}.npz", x=X[m], y=Y[m], z=Zs[m].astype(np.float32), c=C[m],
                            center=np.array([cx, cy]), mesh=mesh)
    os.remove(z)
    os.remove(Path(crop_dir) / name)
    print(mesh, len(hs), flush=True)

json.dump(demo + new, open(DEMO, "w"), ensure_ascii=False, indent=1)
print("added", [(h["no"], h["gml_id"]) for h in new])
