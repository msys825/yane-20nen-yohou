"""詳しい診断の家（検証用の50軒とデモの家）について、東京都の航空レーザー点群から、家のまわり 60m を切り出す

点群は図郭（1区画が数十〜数百MB）ごとにダウンロードし、切り出したら元のファイルは消す。合計で約3.8GB を読む。
途中で止まっても、もう一度走らせれば、足りない家だけ取りに行く。
出典：東京都デジタルツイン実現プロジェクト 区部点群データ（CC BY 4.0）
使い方:
  python3 tools/fetch_crops.py work/crops
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
from pcindex import mesh_for  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
R = 60.0
_LL_TO_PLANE9 = Transformer.from_crs(4326, 6677, always_xy=True)

crop_dir = Path(sys.argv[1])
crop_dir.mkdir(parents=True, exist_ok=True)
houses = json.load(open(ROOT / "data/validation/houses.json"))
if (ROOT / "data/demo_houses.json").exists():
    houses += json.load(open(ROOT / "data/demo_houses.json"))

by_mesh: dict[tuple[str, str], list[dict]] = {}
for h in houses:
    if not (crop_dir / f"{h['no']}.npz").exists():
        by_mesh.setdefault(mesh_for(h["x"], h["y"]), []).append(h)
print(len(by_mesh), "meshes to fetch", flush=True)
for n, ((mesh, url), hs) in enumerate(by_mesh.items()):
    z = crop_dir / f"{mesh}.zip"
    urllib.request.urlretrieve(url, z)
    with zipfile.ZipFile(z) as zf:
        name = next(x for x in zf.namelist() if x.lower().endswith(".las"))
        zf.extract(name, crop_dir)
    las = laspy.read(crop_dir / name)
    X, Y, Zs, C = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z), np.asarray(las.classification)
    for h in hs:
        cx, cy = _LL_TO_PLANE9.transform(h["x"], h["y"])
        m = (np.abs(X - cx) < R) & (np.abs(Y - cy) < R)
        np.savez_compressed(crop_dir / f"{h['no']}.npz", x=X[m], y=Y[m], z=Zs[m].astype(np.float32), c=C[m],
                            center=np.array([cx, cy]), mesh=mesh)
    os.remove(z)
    os.remove(crop_dir / name)
    print(n + 1, "/", len(by_mesh), mesh, [h["no"] for h in hs], flush=True)
print("done")
