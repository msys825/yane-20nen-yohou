"""屋根の発電量を計算するエンジン（検証・前処理用）

入力
- 屋根の面（傾き・方位・面積）：東京都の航空レーザー点群から推定したもの
- 周りの点群：影を落とす建物・木
- 1時間ごとの日射量（法線面直達 DNI・水平面散乱 DHI）

計算
- 屋根の面の中心から見た「方角ごとの地平線の高さ（周りの建物・木がふさぐ角度）」を点群から作る
- 太陽が地平線より低い時間は直達日射を 0 にする
- 散乱日射は、空が見える割合（天空率）で減らす
- 発電量 = 容量[kW] × 年間日射量[kWh/m2] × 総合設計係数 0.85（屋根台帳・JIS C 8907 と同じ式）
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

KPY = 0.85  # 総合設計係数（東京ソーラー屋根台帳と同じ値）
KW_PER_M2 = 0.1  # 10m2 で 1kW（同上）
AZ_BINS = 72  # 地平線を 5 度刻みで持つ


@dataclass
class RoofPlane:
    tilt: float  # 度
    azimuth: float  # 度（北=0, 東=90, 南=180, 西=270）
    area_m2: float  # 屋根の面の面積（斜面の実面積）
    center: np.ndarray  # (x, y, z) 平面直角座標系第9系
    usable_m2: float = 0.0  # 屋根の端から 0.5m 内側の、パネルを置ける面積


def sun_position(times_utc: np.ndarray, lat: float, lon: float) -> tuple[np.ndarray, np.ndarray]:
    """太陽の高度・方位（度）。NOAA の簡易式。times_utc は numpy datetime64[m]"""
    t = times_utc.astype("datetime64[m]")
    doy = (t.astype("datetime64[D]") - t.astype("datetime64[Y]")).astype(int) + 1
    hour = (t - t.astype("datetime64[D]")).astype(int) / 60.0
    g = 2 * math.pi / 365 * (doy - 1 + (hour - 12) / 24)
    eqt = 229.18 * (0.000075 + 0.001868 * np.cos(g) - 0.032077 * np.sin(g) - 0.014615 * np.cos(2 * g) - 0.040849 * np.sin(2 * g))
    decl = (0.006918 - 0.399912 * np.cos(g) + 0.070257 * np.sin(g) - 0.006758 * np.cos(2 * g)
            + 0.000907 * np.sin(2 * g) - 0.002697 * np.cos(3 * g) + 0.00148 * np.sin(3 * g))
    tst = hour * 60 + eqt + 4 * lon
    ha = np.radians(tst / 4 - 180)
    la = math.radians(lat)
    cosz = np.sin(la) * np.sin(decl) + np.cos(la) * np.cos(decl) * np.cos(ha)
    zen = np.arccos(np.clip(cosz, -1, 1))
    elev = 90 - np.degrees(zen)
    az = np.degrees(np.arctan2(np.sin(ha), np.cos(ha) * np.sin(la) - np.tan(decl) * np.cos(la))) + 180
    return elev, az % 360


def horizon_profile(center: np.ndarray, obstacles: np.ndarray, max_dist: float = 60.0, min_dist: float = 1.5) -> np.ndarray:
    """屋根の中心から見た、方角ごとの地平線の高さ（度）。obstacles は (N,3)"""
    d = obstacles - center
    dist = np.hypot(d[:, 0], d[:, 1])
    m = (dist > min_dist) & (dist < max_dist) & (d[:, 2] > 0)
    if not m.any():
        return np.zeros(AZ_BINS)
    ang = np.degrees(np.arctan2(d[m, 2], dist[m]))
    az = (np.degrees(np.arctan2(d[m, 0], d[m, 1])) + 360) % 360
    b = (az / (360 / AZ_BINS)).astype(int) % AZ_BINS
    h = np.zeros(AZ_BINS)
    np.maximum.at(h, b, ang)
    return h


def sky_view_factor(horizon: np.ndarray) -> float:
    """地平線の高さから、空が見える割合（水平面に対する天空率）を出す"""
    return float(np.mean(np.cos(np.radians(horizon)) ** 2))


def plane_irradiance(plane: RoofPlane, horizon: np.ndarray, elev: np.ndarray, az: np.ndarray,
                     dni: np.ndarray, dhi: np.ndarray, ghi: np.ndarray, albedo: float = 0.15) -> dict:
    """屋根の面が 1 年に受ける日射量 [kWh/m2]（影なし・影ありの両方）"""
    t, p = math.radians(plane.tilt), math.radians(plane.azimuth)
    e, a = np.radians(elev), np.radians(az)
    cos_inc = np.sin(e) * math.cos(t) + np.cos(e) * math.sin(t) * np.cos(a - p)
    up = elev > 0
    beam = np.where(up & (cos_inc > 0), dni * cos_inc, 0.0)
    hz = horizon[(az / (360 / AZ_BINS)).astype(int) % AZ_BINS]
    sunlit = elev > hz
    svf = sky_view_factor(horizon)
    diffuse = dhi * (1 + math.cos(t)) / 2
    ground = ghi * albedo * (1 - math.cos(t)) / 2
    open_sky = (beam + diffuse + ground).sum() / 1000
    shaded = (np.where(sunlit, beam, 0) + diffuse * svf + ground).sum() / 1000
    return {"open_kwh_m2": float(open_sky), "kwh_m2": float(shaded), "sunlit_ratio": float(
        (np.where(sunlit, beam, 0).sum() / beam.sum()) if beam.sum() > 0 else 1.0), "svf": svf}


def usable(plane: RoofPlane) -> bool:
    """パネルを置く対象の面（屋根台帳と同じ：傾き3度未満の面、または東〜南〜西向きの面）"""
    return plane.tilt < 3 or (plane.tilt < 60 and 90 <= plane.azimuth <= 270)


def annual_generation(planes: list[RoofPlane], horizons: list[np.ndarray], weather: dict, lat: float, lon: float) -> dict:
    """屋根全体の設置容量と年間発電量"""
    elev, az = sun_position(weather["time"], lat, lon)
    total_kw = total_kwh = total_open = 0.0
    faces = []
    for pl, hz in zip(planes, horizons):
        if not usable(pl) or pl.usable_m2 < 2:
            continue
        r = plane_irradiance(pl, hz, elev, az, weather["dni"], weather["dhi"], weather["ghi"])
        kw = pl.usable_m2 * KW_PER_M2
        total_kw += kw
        total_kwh += kw * r["kwh_m2"] * KPY
        total_open += kw * r["open_kwh_m2"] * KPY
        faces.append({"tilt": pl.tilt, "azimuth": pl.azimuth, "area_m2": pl.area_m2, "usable_m2": pl.usable_m2,
                      "kw": round(kw, 2), **{k: round(v, 3) for k, v in r.items()}})
    area = sum(f["usable_m2"] for f in faces)
    return {"kw": round(total_kw, 2), "kwh": round(total_kwh), "kwh_without_shade": round(total_open),
            "irradiance_kwh_m2": round(sum(f["kwh_m2"] * f["usable_m2"] for f in faces) / area) if area else 0, "faces": faces}


MJ_TO_WH = 1e6 / 3600  # 1 MJ/m2 = 277.8 Wh/m2


def load_metpv11(path: str, lat: float, lon: float) -> dict:
    """NEDO 年間時別日射量データベース（METPV-11）の 1 地点・代表年のファイルを読む。

    1 日ごとに要素 1〜9 の行があり、1 行に 1 時間ごとの 24 の値（h 列目＝h-1 時〜h 時、日本標準時）。
    要素 1＝水平面全天日射量、2＝水平面直達日射量、3＝水平面散乱日射量（単位 0.01 MJ/m2）。
    各値の最後の 1 桁は品質の記号なので取り除く。1 月 1 日の値で 直達＋散乱＝全天 を確かめてある。
    """
    rows: dict[int, list[list[float]]] = {1: [], 2: [], 3: []}
    with open(path, encoding="cp932") as f:
        next(f)  # 1 行目は地点の情報
        for line in f:
            tok = line.split()
            elem = int(tok[0])
            if elem in rows:
                rows[elem].append([int(t[:-1] or 0) * 0.01 for t in tok[4:28]])
    ghi = np.array(rows[1]).ravel() * MJ_TO_WH
    bh = np.array(rows[2]).ravel() * MJ_TO_WH  # 水平面の直達
    dhi = np.array(rows[3]).ravel() * MJ_TO_WH
    # 時刻：日本標準時の「h-1 時〜h 時」の値なので、その真ん中（h-0.5 時）を UTC に直して太陽の位置を取る
    days = np.arange(np.datetime64("2021-01-01"), np.datetime64("2022-01-01"))
    times = (days[:, None] + np.arange(24)[None, :] * np.timedelta64(60, "m") + np.timedelta64(30, "m")
             - np.timedelta64(9, "h")).ravel().astype("datetime64[m]")
    elev, _ = sun_position(times, lat, lon)
    sin_e = np.sin(np.radians(elev))
    # 法線面の直達は 水平面の直達 ÷ sin(太陽高度)。太陽がとても低い時間は散乱として扱う
    low = sin_e < np.sin(np.radians(3))
    dni = np.where(low, 0.0, bh / np.maximum(sin_e, 1e-6))
    dhi = np.where(low, dhi + bh, dhi)
    return {"time": times, "ghi": ghi, "dni": dni, "dhi": dhi}


def load_weather(root) -> dict:
    """NEDO METPV-11（東京 44132）があればそれを、なければ PVGIS を使う"""
    from pathlib import Path
    nedo = Path(root) / "data/irradiance/nedo/mea44132.txt"
    if nedo.exists():
        return load_metpv11(str(nedo), 35.69, 139.76)
    return load_pvgis_tmy(str(Path(root) / "data/irradiance/pvgis_tmy_nerima.json"))


def load_pvgis_tmy(path: str) -> dict:
    import json
    h = json.load(open(path))["outputs"]["tmy_hourly"]
    # PVGIS の時刻は UTC の正時。日射量はその 1 時間の値なので、30 分ずらして太陽位置を取る
    times = np.array([np.datetime64(f"2021-{x['time(UTC)'][4:6]}-{x['time(UTC)'][6:8]}T{x['time(UTC)'][9:11]}:30") for x in h])
    return {"time": times, "ghi": np.array([x["G(h)"] for x in h]), "dni": np.array([x["Gb(n)"] for x in h]), "dhi": np.array([x["Gd(h)"] for x in h])}
