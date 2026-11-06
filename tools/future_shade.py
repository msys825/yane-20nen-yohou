"""将来の影：南側の建物が「建ててよい最大の高さ」まで建て替わったときの、屋根の発電量の変化を計算する"""
from __future__ import annotations

import glob
import json
import math
from pathlib import Path

import numpy as np
from pyproj import Transformer

from plateau_tiles import building_triangles, read_batch_table
from roof_from_pc import points_in_triangles, upward_triangles
from solar_engine import annual_generation, horizon_profile
from zoning import height_limits, max_buildable_height

_LL_TO_PLANE9 = Transformer.from_crs(4326, 6677, always_xy=True)
_PLANE9_TO_LL = Transformer.from_crs(6677, 4326, always_xy=True)


def build_index(lod2_dir: str, out_path: str) -> None:
    """PLATEAU のタイルにある全建物の位置と属性を 1 つの索引ファイルにまとめる"""
    rows = []
    for f in sorted(glob.glob(f"{lod2_dir}/*.b3dm")):
        bt = read_batch_table(f)
        n = len(bt.get("gml_id", []))
        for i in range(n):
            a = (bt.get("attributes") or [{}] * n)[i] or {}
            d = (a.get("uro:BuildingDetailAttribute") or [{}])[0]
            st = bt.get("bldg:storeysAboveGround", [None] * n)[i]
            rows.append({"tile": Path(f).name, "i": i, "gml_id": bt["gml_id"][i], "lon": bt["_x"][i], "lat": bt["_y"][i],
                         "h": bt.get("bldg:measuredHeight", [None] * n)[i], "st": st if st not in (9999, None) else None,
                         "usage": d.get("uro:detailedUsage") or bt.get("bldg:usage", [None] * n)[i],
                         "far": d.get("uro:specifiedFloorAreaRate"), "cov": d.get("uro:specifiedBuildingCoverageRate")})
    json.dump(rows, open(out_path, "w"), ensure_ascii=False)


class BuildingIndex:
    def __init__(self, index_path: str, lod2_dir: str):
        self.rows = json.load(open(index_path))
        self.lod2_dir = lod2_dir
        xs, ys = _LL_TO_PLANE9.transform([r["lon"] for r in self.rows], [r["lat"] for r in self.rows])
        self.xy = np.c_[xs, ys]

    def near(self, x: float, y: float, r: float) -> list[int]:
        d = np.hypot(self.xy[:, 0] - x, self.xy[:, 1] - y)
        return list(np.where(d < r)[0])

    def triangles(self, k: int) -> np.ndarray:
        r = self.rows[k]
        return building_triangles(f"{self.lod2_dir}/{r['tile']}", r["i"])


def future_volumes(index: BuildingIndex, house_k: int, ground: float, radius: float = 30.0) -> list[dict]:
    """南側（方位 100〜260 度）の建物のうち、今より 3m 以上高く建て替えられうるものと、その最大の高さ"""
    hx, hy = index.xy[house_k]
    out = []
    for k in index.near(hx, hy, radius):
        if k == house_k:
            continue
        dx, dy = index.xy[k] - (hx, hy)
        bearing = (math.degrees(math.atan2(dx, dy)) + 360) % 360
        if not 100 <= bearing <= 260:
            continue
        r = index.rows[k]
        lim = height_limits(r["lon"], r["lat"])
        h_max, why = max_buildable_height(lim, r.get("far"), r.get("cov"))
        if h_max is None or r["h"] is None or h_max < r["h"] + 3:
            continue
        out.append({"k": k, "gml_id": r["gml_id"], "now_h": r["h"], "max_h": h_max, "why": why,
                    "distance_m": round(float(math.hypot(dx, dy)), 1), "bearing": round(bearing), "zone": lim.get("zone")})
    return out


def volume_points(tris: np.ndarray, top_z: float, step: float = 0.5) -> np.ndarray:
    """建物の上面の範囲を、高さ top_z の点の集まりにする（影の計算用）"""
    top = upward_triangles(tris)
    xmin, ymin = top[:, :, 0].min(), top[:, :, 1].min()
    xmax, ymax = top[:, :, 0].max(), top[:, :, 1].max()
    gx, gy = np.meshgrid(np.arange(xmin, xmax + step, step), np.arange(ymin, ymax + step, step))
    x, y = gx.ravel(), gy.ravel()
    m = points_in_triangles(x, y, top)
    return np.c_[x[m], y[m], np.full(m.sum(), top_z)]


def future_generation(planes, obstacles: np.ndarray, index: BuildingIndex, house_k: int, ground: float,
                      weather: dict, lat: float, lon: float) -> dict:
    """今と、南側が最大まで建て替わったときの年間発電量"""
    now = annual_generation(planes, [horizon_profile(p.center, obstacles) for p in planes], weather, lat, lon)
    vols = future_volumes(index, house_k, ground)
    extra = [volume_points(index.triangles(v["k"]), ground + v["max_h"]) for v in vols]
    obs_future = np.concatenate([obstacles, *extra]) if extra else obstacles
    fut = annual_generation(planes, [horizon_profile(p.center, obs_future) for p in planes], weather, lat, lon)
    change = (fut["kwh"] - now["kwh"]) / now["kwh"] if now["kwh"] else 0.0
    return {"now": now, "future": fut, "change": round(change, 3), "volumes": vols}


def hull_lonlat(tris: np.ndarray) -> tuple[list[list[float]], float]:
    """建物の上面を真上から見た外形（凸包）を経度・緯度で。あわせて建物の底の高さ（楕円体高）"""
    top = upward_triangles(tris)
    pts = top[:, :, :2].reshape(-1, 2)
    pts = np.unique(np.round(pts, 2), axis=0)
    # 凸包（Andrew の方法）
    pts = sorted(map(tuple, pts))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    ring = lower[:-1] + upper[:-1]
    lon, lat = _PLANE9_TO_LL.transform([p[0] for p in ring], [p[1] for p in ring])
    return [[round(a, 7), round(b, 7)] for a, b in zip(lon, lat)], float(tris[:, :, 2].min())
