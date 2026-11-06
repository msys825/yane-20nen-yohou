"""簡易診断：練馬区のすべての戸建てについて、PLATEAU の建物データだけで、今と将来（南側が最大まで建ったとき）の発電量を出す

詳しい診断（点群で屋根を測る、tools/export_app_data.py）は 52 軒だけなので、ほかの家はこの簡易診断で示す。
  - 屋根：PLATEAU の屋根の面積（buildingRoofEdgeArea）× 係数 で、パネルを置ける量 [kW] を見積もる（係数は詳しい診断の家から決める）
         面は 真南・傾き25° と置き、1kW あたりの発電は詳しい診断の家に合わせて補正する
  - 今の影：60m 以内の建物（PLATEAU の外形と高さ）で、方位ごとの見上げ角を出す。木の影は含まない
  - 将来の影：南側（方位100〜260°、30m 以内）で、ルール上いまより 3m 以上高くできる建物を、最大の高さにして同じ計算
  - 日射：NEDO METPV-11（東京）。総合設計係数 0.85（このツールと同じ）

使い方:
  python3 tools/simple_diagnosis.py <LOD2タイルのフォルダ> <建物索引JSON> <最大の高さJSON> <外枠JSON> <作業フォルダ> <アプリの出力フォルダ>
  作業フォルダには、全建物の形のキャッシュと、全戸の結果 CSV を置く
"""
from __future__ import annotations

import csv
import glob
import json
import math
import sys
from collections import defaultdict
from multiprocessing import Pool
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from plateau_tiles import tile_building_triangles  # noqa: E402
from roof_from_pc import upward_triangles  # noqa: E402
from solar_engine import KPY, load_weather, sun_position  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TILT, AZIMUTH, ALBEDO = 25.0, 180.0, 0.15
NEIGHBOR_R, FUTURE_R = 60.0, 30.0
BINS = 72
EYE_DROP = float(__import__("os").environ.get("EYE_DROP", "2.0"))  # パネルの高さ＝屋上の高さ − この値 [m]。52軒の詳しい診断と最もよく合う値
# 詳しい診断（点群）の家から決めた係数（2026-11-05、比べた46軒）
KW_PER_ROOF_M2 = 0.045  # 屋根の面積 1m² あたり、パネルを置ける量 [kW]（中央値 0.0448）
OPEN_FACTOR = 0.92  # 1kW あたりの発電：真南25° と置いた値 → 実際の屋根の向きのばらつきに合わせる（1,072 ÷ 1,166）


def convex_hull(pts: np.ndarray) -> np.ndarray:
    pts = np.unique(np.round(pts, 1), axis=0)
    if len(pts) < 3:
        return pts
    pts = pts[np.lexsort((pts[:, 1], pts[:, 0]))]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in pts[::-1]:
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.array(lower[:-1] + upper[:-1])


def densify(hull: np.ndarray, step: float = 2.0) -> np.ndarray:
    """外形の辺に沿って 2m ごとに点を置く（見上げ角を辺の途中でも取るため）"""
    out = []
    for i in range(len(hull)):
        a, b = hull[i], hull[(i + 1) % len(hull)]
        n = max(1, int(np.hypot(*(b - a)) / step))
        out.append(a + (b - a) * np.arange(n)[:, None] / n)
    return np.concatenate(out) if out else hull


def build_geometry(lod2_dir: str, rows: list[dict], cache: Path) -> dict:
    """全建物の外形（平面直角座標）・地面の高さ・屋上の高さを、タイルを1回ずつ読んで作る"""
    if cache.exists():
        d = np.load(cache, allow_pickle=True)
        return {"pts": d["pts"], "owner": d["owner"], "base": d["base"], "top": d["top"], "cx": d["cx"], "cy": d["cy"]}
    by_tile = defaultdict(list)
    for k, r in enumerate(rows):
        by_tile[r["tile"]].append(k)
    n = len(rows)
    base = np.full(n, np.nan)
    top = np.full(n, np.nan)
    cx = np.full(n, np.nan)
    cy = np.full(n, np.nan)
    pts_all, owner_all = [], []
    for t, (tile, ks) in enumerate(sorted(by_tile.items())):
        tris = tile_building_triangles(f"{lod2_dir}/{tile}")
        for k in ks:
            tr = tris.get(rows[k]["i"])
            if tr is None or len(tr) == 0:
                continue
            upt = upward_triangles(tr)
            if len(upt) == 0:
                continue
            hull = convex_hull(upt[:, :, :2].reshape(-1, 2))
            if len(hull) < 3:
                continue
            base[k] = tr[:, :, 2].min()
            top[k] = tr[:, :, 2].max()
            cx[k], cy[k] = hull.mean(axis=0)
            d = densify(hull)
            pts_all.append(d)
            owner_all.append(np.full(len(d), k))
        if t % 20 == 0:
            print("geometry", t, len(by_tile), flush=True)
    pts = np.concatenate(pts_all).astype(np.float64)
    owner = np.concatenate(owner_all).astype(np.int32)
    np.savez_compressed(cache, pts=pts, owner=owner, base=base, top=top, cx=cx, cy=cy)
    return {"pts": pts, "owner": owner, "base": base, "top": top, "cx": cx, "cy": cy}


def prepare_sun(lat: float, lon: float) -> dict:
    """真南・傾き25° の面について、方位ビンごとに「太陽高度の高い順の直達の累積」を作る（見上げ角を当てはめるだけで影を出せる）"""
    w = load_weather(ROOT)
    elev, az = sun_position(w["time"], lat, lon)
    t, p = math.radians(TILT), math.radians(AZIMUTH)
    e, a = np.radians(elev), np.radians(az)
    cos_inc = np.sin(e) * math.cos(t) + np.cos(e) * math.sin(t) * np.cos(a - p)
    beam = np.where((elev > 0) & (cos_inc > 0), w["dni"] * cos_inc, 0.0)
    diffuse = float((w["dhi"] * (1 + math.cos(t)) / 2).sum())
    ground = float((w["ghi"] * ALBEDO * (1 - math.cos(t)) / 2).sum())
    b = (az / (360 / BINS)).astype(int) % BINS
    per_bin = []
    for i in range(BINS):
        m = (b == i) & (beam > 0)
        order = np.argsort(-elev[m])
        per_bin.append((elev[m][order], np.concatenate([[0.0], np.cumsum(beam[m][order])])))
    return {"bins": per_bin, "diffuse": diffuse, "ground": ground, "beam_total": float(beam.sum())}


SUN: dict = {}
G: dict = {}


def kwh_per_kw(horizon: np.ndarray) -> float:
    beam = 0.0
    for i, (el, cum) in enumerate(SUN["bins"]):
        # 見上げ角より高い太陽の時間だけ、直達が当たる（el は高い順）
        n = int(np.searchsorted(-el, -horizon[i], side="left"))
        beam += cum[n]
    svf = float(np.mean(np.cos(np.radians(horizon)) ** 2))
    return (beam + SUN["diffuse"] * svf + SUN["ground"]) / 1000 * KPY


def horizon_from(points: np.ndarray, tops: np.ndarray, x: float, y: float, eye: float) -> np.ndarray:
    dx, dy = points[:, 0] - x, points[:, 1] - y
    d = np.hypot(dx, dy)
    ok = (d > 1.5) & (d < NEIGHBOR_R)
    h = np.zeros(BINS)
    if not ok.any():
        return h
    ang = np.degrees(np.arctan2(tops[ok] - eye, d[ok]))
    az = (np.degrees(np.arctan2(dx[ok], dy[ok])) + 360) % 360
    b = (az / (360 / BINS)).astype(int) % BINS
    np.maximum.at(h, b, np.maximum(ang, 0))
    return h


def one(k: int) -> tuple | None:
    base, top, cx, cy = G["base"], G["top"], G["cx"], G["cy"]
    if not np.isfinite(top[k]):
        return None
    x, y = cx[k], cy[k]
    cell = (int(x // 60), int(y // 60))
    idx = np.concatenate([G["cell_pts"].get((cell[0] + i, cell[1] + j), np.zeros(0, int)) for i in (-1, 0, 1) for j in (-1, 0, 1)])
    idx = idx[G["owner"][idx] != k]
    pts = G["pts"][idx]
    own = G["owner"][idx]
    tops_now = top[own]
    eye = top[k] - EYE_DROP  # パネルの高さ：屋上より少し下（勾配屋根の中ほど）
    now = kwh_per_kw(horizon_from(pts, tops_now, x, y, eye))
    # 将来：南側 30m 以内で、ルール上いまより 3m 以上高くできる建物を最大の高さに
    tops_fut = tops_now.copy()
    grow = G["grow"]
    dx, dy = cx[own] - x, cy[own] - y
    dist = np.hypot(dx, dy)
    bear = (np.degrees(np.arctan2(dx, dy)) + 360) % 360
    m = (dist < FUTURE_R) & (bear >= 100) & (bear <= 260) & (grow[own] > 0)
    tops_fut[m] = base[own[m]] + G["maxh"][own[m]]
    fut = kwh_per_kw(horizon_from(pts, tops_fut, x, y, eye)) if m.any() else now
    n_vol = len(set(own[m].tolist()))
    return (k, now, fut, n_vol)


def init(g: dict, sun: dict) -> None:
    G.update(g)
    SUN.update(sun)


if __name__ == "__main__":
    lod2_dir, index_path, max_path, bbox_path, work_dir, out_dir = sys.argv[1:7]
    work, out = Path(work_dir), Path(out_dir)
    work.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    rows = json.load(open(index_path))
    maxh = json.load(open(max_path))
    bbox = json.load(open(bbox_path))
    geo = build_geometry(lod2_dir, rows, work / "geometry.npz")
    h = np.array([r["h"] or 0 for r in rows], float)
    mh = np.array([m[0] if m and m[0] is not None else 0 for m in maxh], float)
    grow = (mh >= h + 3) & (h > 0)
    cell_pts = defaultdict(list)
    for i, (px, py) in enumerate(geo["pts"]):
        cell_pts[(int(px // 60), int(py // 60))].append(i)
    cell_pts = {c: np.array(v) for c, v in cell_pts.items()}
    g = {**geo, "cell_pts": cell_pts, "grow": grow, "maxh": mh}
    lats = [r["lat"] for r in rows]
    lons = [r["lon"] for r in rows]
    sun = prepare_sun(float(np.mean(lats)), float(np.mean(lons)))
    init(g, sun)
    print("open kWh/kW (south 25°)", round(kwh_per_kw(np.zeros(BINS))), flush=True)

    houses = [k for k, r in enumerate(rows) if r["usage"] == "独立住宅" and r["h"]]
    print(len(houses), "houses", flush=True)
    with Pool(8, initializer=init, initargs=(g, sun)) as pool:
        res = [r for r in pool.imap_unordered(one, houses, chunksize=500) if r]
    print(len(res), "computed", flush=True)

    with open(work / "simple_all.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["k", "gml_id", "lon", "lat", "roof_area", "kwh_per_kw_now", "kwh_per_kw_future", "n_volumes"])
        for k, now, fut, nv in sorted(res):
            r = rows[k]
            w.writerow([k, r["gml_id"], r["lon"], r["lat"], bbox[k][2] or "", round(now, 1), round(fut, 1), nv])
    print("saved", work / "simple_all.csv")

    # アプリ用：gml_id の先頭2文字（bldg_ の後）で 256 個に分けた JSON。値は [kW, 今の年間kWh, 将来の年間kWh, 南側で高くなりうる建物の数]
    shards: dict[str, dict] = defaultdict(dict)
    for k, now, fut, nv in res:
        r = rows[k]
        roof = bbox[k][2]
        kw = round(roof * KW_PER_ROOF_M2, 2) if roof else None
        now_k, fut_k = now * OPEN_FACTOR, fut * OPEN_FACTOR
        shards[r["gml_id"][5:7]][r["gml_id"]] = [kw, round(kw * now_k) if kw else None, round(kw * fut_k) if kw else None,
                                                  round(now_k), round(fut_k), nv]
    for key, d in shards.items():
        json.dump(d, open(out / f"{key}.json", "w"), separators=(",", ":"))
    meta = {"method": "簡易診断：PLATEAU の建物の外形・高さだけで、周りの建物の影を計算（木の影・屋根の形は含まない）",
            "kwPerRoofM2": KW_PER_ROOF_M2, "openFactor": OPEN_FACTOR, "eyeDrop": EYE_DROP, "tilt": TILT, "azimuth": AZIMUTH,
            "houses": len(res), "fields": ["kW", "今の年間kWh", "将来の年間kWh", "今の1kWあたりkWh", "将来の1kWあたりkWh", "南側で高くなりうる建物の数"]}
    json.dump(meta, open(out / "meta.json", "w"), ensure_ascii=False, indent=1)
    print("shards", len(shards))
