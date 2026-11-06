"""東京都の航空レーザー点群から、建物の屋根の面（傾き・方位・面積・中心）を推定する"""
from __future__ import annotations

import math

import numpy as np

from solar_engine import RoofPlane


def points_in_triangles(x: np.ndarray, y: np.ndarray, tris: np.ndarray) -> np.ndarray:
    """点 (x, y) が、三角形群 tris を真上から見た範囲に入るか"""
    inside = np.zeros(len(x), bool)
    for t in tris:
        (x1, y1), (x2, y2), (x3, y3) = t[:, 0:2]
        d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
        if abs(d) < 1e-9:
            continue
        a = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / d
        b = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / d
        inside |= (a >= 0) & (b >= 0) & (1 - a - b >= 0)
    return inside


def upward_triangles(tris: np.ndarray) -> np.ndarray:
    """建物の三角形のうち、上を向いた面（屋根・上面）だけを返す"""
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    up = np.abs(n[:, 2]) / np.maximum(np.linalg.norm(n, axis=1), 1e-9) > 0.3
    return tris[up]


def projected_area(P: np.ndarray, cell: float = 0.5) -> float:
    """点がある 0.5m 格子のマス数から、真上から見た面積を概算する"""
    return len(set(map(tuple, np.floor(P[:, :2] / cell).astype(int)))) * cell * cell


def setback_area(Q: np.ndarray, cell: float = 0.5, setback_cells: int = 1) -> float:
    """面の点がある 0.5m 格子を、外周から setback_cells マス削った残りの面積（真上から見た面積）"""
    occ = set(map(tuple, np.floor(Q[:, :2] / cell).astype(int)))
    for _ in range(setback_cells):
        occ = {(i, j) for (i, j) in occ if {(i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)} <= occ}
    return len(occ) * cell * cell


def fit_planes(P: np.ndarray, min_pts: int = 60, thr: float = 0.08, iters: int = 400, max_planes: int = 6,
               seed: int = 0) -> list[RoofPlane]:
    """屋根の点群から平面を順に取り出す（RANSAC）"""
    rng = np.random.default_rng(seed)
    density = len(P) / max(projected_area(P), 1e-6)
    planes: list[RoofPlane] = []
    rest = P.copy()
    while len(rest) >= min_pts and len(planes) < max_planes:
        best = None
        for _ in range(iters):
            s = rest[rng.choice(len(rest), 3, replace=False)]
            n = np.cross(s[1] - s[0], s[2] - s[0])
            nn = np.linalg.norm(n)
            if nn < 1e-6:
                continue
            n = n / nn
            if abs(n[2]) < 0.3:  # 壁は除く
                continue
            inl = np.abs((rest - s[0]) @ n) < thr
            if best is None or inl.sum() > best.sum():
                best = inl
        if best is None or best.sum() < min_pts:
            break
        Q = rest[best]
        c = Q.mean(0)
        n = np.linalg.svd(Q - c)[2][2]
        if n[2] < 0:
            n = -n
        tilt = math.degrees(math.acos(min(1.0, n[2])))
        az = (math.degrees(math.atan2(n[0], n[1])) + 360) % 360
        # 真上から見た面積 ÷ cos(傾き) ＝ 斜面の面積
        cos_t = max(math.cos(math.radians(tilt)), 0.2)
        area = len(Q) / density / cos_t
        usable_area = setback_area(Q) / cos_t
        planes.append(RoofPlane(tilt=round(tilt, 1), azimuth=round(az), area_m2=round(area, 1), center=c,
                                usable_m2=round(usable_area, 1)))
        rest = rest[~best]
    return planes


def roof_points(crop: dict, building_tris: np.ndarray, above_ground: float = 2.5) -> tuple[np.ndarray, float]:
    """建物の上面の範囲に入り、地面より above_ground m 以上高い点を返す（あわせて地面の高さ）"""
    top = upward_triangles(building_tris)
    x, y, z, c = crop["x"], crop["y"], crop["z"], crop["c"]
    near = (x > top[:, :, 0].min() - 1) & (x < top[:, :, 0].max() + 1) & (y > top[:, :, 1].min() - 1) & (y < top[:, :, 1].max() + 1)
    idx = np.where(near)[0]
    ins = idx[points_in_triangles(x[idx], y[idx], top)]
    ground = float(np.median(z[c == 2])) if (c == 2).any() else float(z.min())
    P = np.c_[x[ins], y[ins], z[ins]]
    return P[P[:, 2] > ground + above_ground], ground


def obstacles_excluding(crop: dict, building_tris: np.ndarray, ground: float, min_height: float = 1.0) -> np.ndarray:
    """自分の建物以外で、影を落としうる点（地面より min_height m 以上高い点）"""
    top = upward_triangles(building_tris)
    x, y, z = crop["x"], crop["y"], crop["z"]
    high = z > ground + min_height
    idx = np.where(high)[0]
    own = points_in_triangles(x[idx], y[idx], top)
    keep = idx[~own]
    return np.c_[x[keep], y[keep], z[keep]]
