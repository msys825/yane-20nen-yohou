"""検証：点群から推定した屋根と発電量を、PLATEAU LOD2 の屋根と東京ソーラー屋根台帳の予測値と比べる

使い方:
  python3 tools/validate_roofs.py <LOD2タイルのフォルダ> <点群の切り出しフォルダ> <出力CSV>
"""
from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from plateau_tiles import building_triangles, roof_faces_from_triangles  # noqa: E402
from roof_from_pc import fit_planes, obstacles_excluding, roof_points  # noqa: E402
from solar_engine import annual_generation, horizon_profile, load_weather  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
lod2_dir, crop_dir, out_csv = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])

houses = {str(h["no"]): h for h in json.load(open(ROOT / "data/validation/houses.json"))}
tiles = json.load(open(ROOT / "data/validation/house_lod2tile.json"))
weather = load_weather(ROOT)
ledger = {r["No"]: r for r in csv.DictReader(open(ROOT / "validation/屋根台帳_記録表.csv", encoding="utf-8-sig"))}


def col(row: dict, prefix: str) -> str:
    return next(v for k, v in row.items() if k.startswith(prefix))


def az_diff(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return min(d, 360 - d)


rows = []
for no in sorted(houses, key=int):
    h = houses[no]
    if not (crop_dir / f"{no}.npz").exists():
        print(no, "点群なし（スキップ）")
        continue
    tile, idx = tiles[no]
    tris = building_triangles(str(lod2_dir / tile), idx)
    crop = dict(np.load(crop_dir / f"{no}.npz"))
    P, ground = roof_points(crop, tris)
    planes = fit_planes(P) if len(P) >= 60 else []
    obstacles = obstacles_excluding(crop, tris, ground)
    horizons = [horizon_profile(p.center, obstacles) for p in planes]
    gen = annual_generation(planes, horizons, weather, h["y"], h["x"])

    row = {"No": no, "group": h["group"], "roof_points": len(P),
           "pc_main_tilt": planes[0].tilt if planes else "", "pc_main_azimuth": planes[0].azimuth if planes else "",
           "pc_main_area": planes[0].area_m2 if planes else "",
           "pc_kw": gen["kw"], "pc_kwh": gen["kwh"], "pc_kwh_without_shade": gen["kwh_without_shade"],
           "pc_irradiance": gen["irradiance_kwh_m2"]}
    if h.get("lod") == 2:
        truth = roof_faces_from_triangles(tris)
        t = truth[0]
        row.update(lod2_main_tilt=round(t["tilt"], 1), lod2_main_azimuth=round(t["azimuth"]), lod2_main_area=round(t["area_m2"], 1))
        if planes:
            row["tilt_error"] = round(planes[0].tilt - t["tilt"], 1)
            row["azimuth_error"] = round(az_diff(planes[0].azimuth, t["azimuth"])) if t["tilt"] >= 5 else ""
    lg = ledger.get(no, {})
    row.update(ledger_suitability=col(lg, "適合度") if lg else "", ledger_irradiance=col(lg, "年間予測日射量") if lg else "",
               ledger_kw=col(lg, "設置可能システム容量") if lg else "", ledger_kwh=col(lg, "年間予測発電量") if lg else "")
    if row["ledger_irradiance"] and gen["irradiance_kwh_m2"]:
        row["irradiance_ratio"] = round(gen["irradiance_kwh_m2"] / float(row["ledger_irradiance"]), 3)
    rows.append(row)
    print(no, {k: row.get(k) for k in ("pc_main_tilt", "lod2_main_tilt", "pc_irradiance", "ledger_irradiance", "pc_kw", "ledger_kw")}, flush=True)

keys = sorted({k for r in rows for k in r}, key=lambda k: list(rows[0].keys()).index(k) if k in rows[0] else 99)
with open(out_csv, "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=keys)
    w.writeheader()
    w.writerows(rows)
print("saved", out_csv)
