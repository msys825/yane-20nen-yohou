"""PLATEAU の都市計画決定情報（用途地域・高度地区, MVT）から、地点の高さの上限を調べる"""
from __future__ import annotations

import functools
import json
import math
import urllib.request

import mapbox_vector_tile as mvt

# 東京都練馬区 2025年度（出典：国土交通省 Project PLATEAU）
HEIGHT_DISTRICT_URL = "https://assets.cms.plateau.reearth.io/assets/19/7bba89-efa0-48d8-942e-90c530053797/13120_nerima-ku_pref_2025_citygml_1_op_urf_HeightControlDistrict_mvt_lod1/{z}/{x}/{y}.mvt"
USE_DISTRICT_URL = "https://assets.cms.plateau.reearth.io/assets/2d/4c8987-4f03-4e09-9c01-d1ab43bdfab3/13120_nerima-ku_pref_2025_citygml_1_op_urf_UseDistrict_mvt_lod1/{z}/{x}/{y}.mvt"
Z = 15


def _tile_xy(lon: float, lat: float) -> tuple[float, float]:
    n = 2 ** Z
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n


@functools.lru_cache(maxsize=512)
def _features(url: str, x: int, y: int) -> list[dict]:
    try:
        b = urllib.request.urlopen(url.format(z=Z, x=x, y=y), timeout=30).read()
    except Exception:
        return []
    d = mvt.decode(b, default_options={"y_coord_down": True})
    return [f for layer in d.values() for f in layer["features"]]


def _inside(pt: tuple[float, float], ring: list) -> bool:
    xx, yy = pt
    c = False
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[i - 1]
        if (y1 > yy) != (y2 > yy) and xx < (x2 - x1) * (yy - y1) / (y2 - y1) + x1:
            c = not c
    return c


def _lookup(url: str, lon: float, lat: float) -> dict | None:
    fx, fy = _tile_xy(lon, lat)
    x, y = int(fx), int(fy)
    p = ((fx - x) * 4096, (fy - y) * 4096)
    for f in _features(url, x, y):
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            if _inside(p, poly[0]) and not any(_inside(p, hole) for hole in poly[1:]):
                return f["properties"]
    return None


def height_limits(lon: float, lat: float) -> dict:
    """地点の用途地域・容積率・建ぺい率・高さの上限"""
    use = _lookup(USE_DISTRICT_URL, lon, lat) or {}
    hd = _lookup(HEIGHT_DISTRICT_URL, lon, lat) or {}
    use_attrs = json.loads(use.get("attributes", "{}")) if isinstance(use.get("attributes"), str) else {}
    return {
        "zone": use.get("urf_function"),
        "floor_area_rate": use.get("urf_floorAreaRate") or use_attrs.get("urf:floorAreaRate"),
        "coverage_rate": use.get("urf_buildingCoverageRate"),
        "zone_height_limit": use.get("urf_buildingHeightLimits") or use_attrs.get("urf:buildingHeightLimits"),
        "height_district": hd.get("urf_function"),
        "district_max_height": hd.get("urf_maximumBuildingHeight"),
    }


FLOOR_HEIGHT = 3.0  # 1階あたりの高さ（m）

# --- 高度地区の斜線（北側の境界からの、斜めの高さ制限） ---
# 種類（第1種〜第3種）は、PLATEAU の建物の属性「高度地区」に入っている（都市計画決定情報の地図には、最高限度しか入っていない）
BOUNDARY_SETBACK = 1.0  # 北側の敷地の境界は、建物（外形）の北の端からこれだけ北にあると置く [m]（敷地の境界のデータがないため）


def slant_limit(kind, d):
    """北側の境界から真北方向に d [m] 離れた所で、建ててよい高さ [m]（地盤面から）。kind・d は数でも numpy の配列でもよい
    第1種：5 + 0.6d ／ 第2種：8m まで 5 + 1.25d、その先 15 + 0.6(d−8) ／ 第3種：8m まで 10 + 1.25d、その先 20 + 0.6(d−8)
    種類が 0（不明・指定なし）の所は制限なし。出典：練馬区の高度地区の計画書（東京都の高度地区の標準の決まり）"""
    import numpy as np

    kind, d = np.asarray(kind), np.asarray(d, float)
    a = np.where(kind == 3, 10.0, 5.0)
    two_step = np.where(d <= 8, a + 1.25 * d, a + 10 + 0.6 * (d - 8))
    lim = np.where(kind == 1, 5 + 0.6 * d, two_step)
    return np.where(kind == 0, np.inf, lim)


def effective_max(max_h, kind, depth, now_h=0.0):
    """斜線で切ったあとの、いちばん高い所の高さ [m]。depth＝建物（外形）の南北の長さ [m]。今の高さより低くはしない"""
    import numpy as np

    return np.maximum(now_h, np.minimum(max_h, slant_limit(kind, np.asarray(depth, float) + BOUNDARY_SETBACK)))


def max_buildable_height(limits: dict, far: float | None = None, cov: float | None = None) -> tuple[float | None, str]:
    """建ててよい最大の高さ（m）と、何で決まったかの説明。斜線制限・日影規制は含めない（最大の目安）"""
    far = far or limits.get("floor_area_rate")
    cov = cov or limits.get("coverage_rate")
    cands = []
    if far and cov:
        floors = max(1, int(float(far) / float(cov)))
        cands.append((floors * FLOOR_HEIGHT, f"容積率{int(far)}%÷建ぺい率{int(cov)}%＝{floors}階相当"))
    if limits.get("zone_height_limit"):
        cands.append((float(limits["zone_height_limit"]), f"{limits['zone']}の高さの上限{limits['zone_height_limit']}m"))
    if limits.get("district_max_height"):
        cands.append((float(limits["district_max_height"]), f"高度地区の最高限度{limits['district_max_height']}m"))
    if not cands:
        return None, "上限が分からない"
    h, why = min(cands, key=lambda c: c[0])
    return h, why
