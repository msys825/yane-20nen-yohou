"""発電量の答え合わせ：このツールと同じ式で計算した太陽光の発電と、東京電力エリアの実際の発電を比べる（2025年）

使うもの（すべて公開データ）
  - 実績：東京電力パワーグリッド「エリア需給実績」の 太陽光発電実績＋太陽光出力制御量（30分ごとの平均 MW）
  - 導入量：資源エネルギー庁「固定価格買取制度 情報公表用ウェブサイト」表A② 都道府県別導入容量（FIT・FIP、2024年末と2025年末の平均）
  - 日射量：気象庁「過去の気象データ検索」の全天日射量（1時間ごと、6地点。tools/fetch_jma_radiation.py で集める）
計算（このツールと同じ）
  - 全天日射を直達と散乱に分ける（Erbs の式）→ 傾いた面の日射（solar_engine.plane_irradiance と同じ式）→ × 総合設計係数 0.85
  - 面の向きと傾きは、エリアの平均として 真南・傾き20° とする（住宅の屋根は20〜30°、野立ては10〜20°が多い）
  - 地点ごとの発電を、都県の導入量で重み付けして平均する

使い方:
  python3 tools/validate_tepco.py <東京電力CSVのフォルダ> <導入量xlsxのフォルダ> <気象庁CSVのフォルダ> <出力フォルダ>
"""
from __future__ import annotations

import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from solar_engine import KPY, sun_position  # noqa: E402

YEAR = 2025
MJ_TO_WH = 1e6 / 3600
# 気象庁の地点 → 緯度・経度と、その地点で代表させる都県（割合）。全天日射量を観測している地点だけを使う
# 埼玉は東京と前橋の間なので半分ずつ。静岡県は富士川より東だけが東京電力エリアなので 0.35 を掛ける
STATIONS = {
    "東京": (35.6917, 139.7500, {"東京都": 1.0, "神奈川県": 1.0, "埼玉県": 0.5, "静岡県": 0.35}),
    "館野": (36.0567, 140.1250, {"茨城県": 1.0}),
    "銚子": (35.7383, 140.8567, {"千葉県": 1.0}),
    "宇都宮": (36.5483, 139.8683, {"栃木県": 1.0}),
    "前橋": (36.4050, 139.0600, {"群馬県": 1.0, "埼玉県": 0.5}),
    "甲府": (35.6667, 138.5550, {"山梨県": 1.0}),
}
TILT, AZIMUTH, ALBEDO = 20.0, 180.0, 0.15


def capacity_by_pref(fit_dir: Path) -> dict[str, float]:
    """都道府県別の太陽光の導入容量 [kW]（新規認定＋移行認定、2024年末と2025年末の平均）"""
    import openpyxl

    total: dict[str, float] = defaultdict(float)
    files = sorted(fit_dir.glob("A_*.xlsx"))
    for f in files:
        wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
        for sheet, cols in (("表A②－１", (1, 3)), ("表A②－２", (1, 2))):
            for row in wb[sheet].iter_rows(values_only=True):
                if row and isinstance(row[0], str) and row[0].endswith(("都", "道", "府", "県")):
                    total[row[0]] += (float(row[cols[0]] or 0) + float(row[cols[1]] or 0)) / len(files)
    return dict(total)


def tepco_hourly(tepco_dir: Path) -> dict[tuple[str, int], float]:
    """(日付, 時 1〜24) → その1時間の太陽光の発電 [MWh]（出力制御で抑えた分を足し戻す）。時は気象庁と同じ「h-1時〜h時」"""
    out: dict[tuple[str, int], float] = defaultdict(float)
    for f in sorted(tepco_dir.glob(f"{YEAR}??.csv")):
        rows = list(csv.reader(open(f, encoding="utf-8-sig")))
        head = rows[1]
        i_pv, i_cut = head.index("太陽光発電実績"), head.index("太陽光出力制御量")
        for r in rows[2:]:
            if len(r) <= i_cut or not r[0]:
                continue
            y, m, d = (int(x) for x in r[0].split("/"))
            hh, mm = (int(x) for x in r[1].split(":"))
            out[(f"{y:04d}-{m:02d}-{d:02d}", hh + 1)] += (float(r[i_pv] or 0) + float(r[i_cut] or 0)) * 0.5
    return dict(out)


def erbs(ghi: np.ndarray, elev: np.ndarray, doy: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """全天日射を、法線面直達(DNI)と水平面散乱(DHI)に分ける（Erbs ほか 1982）"""
    sin_e = np.sin(np.radians(elev))
    i0 = 1367 * (1 + 0.033 * np.cos(2 * np.pi * doy / 365))
    kt = np.where(sin_e > 0.05, ghi / np.maximum(i0 * sin_e, 1e-6), 0)
    kt = np.clip(kt, 0, 1)
    fd = np.where(kt <= 0.22, 1 - 0.09 * kt,
                  np.where(kt <= 0.8, 0.9511 - 0.1604 * kt + 4.388 * kt**2 - 16.638 * kt**3 + 12.336 * kt**4, 0.165))
    dhi = ghi * fd
    dni = np.where(sin_e > 0.05, (ghi - dhi) / np.maximum(sin_e, 1e-6), 0)
    return dni, np.where(sin_e > 0.05, dhi, ghi)


def model_per_kw(jma_csv: Path, lat: float, lon: float) -> dict[tuple[str, int], float]:
    """1kW あたりの1時間の発電 [kWh]（このツールと同じ式、影なし）"""
    rows = [r for r in csv.reader(open(jma_csv)) if r[2] != ""]
    annual = sum(float(r[2]) for r in rows) / 3.6
    if annual < 800:  # 全天日射を観測していない地点は空欄（0）ばかりになる
        raise SystemExit(f"{jma_csv.name}：年間の全天日射量が {annual:.0f} kWh/m² しかない。日射を観測していない地点では？")
    keys = [(r[0], int(r[1])) for r in rows]
    ghi = np.array([float(r[2]) for r in rows]) * MJ_TO_WH  # Wh/m²（その1時間）
    t = np.array([np.datetime64(r[0]) + np.timedelta64(int(r[1]) * 60 - 30, "m") - np.timedelta64(9, "h") for r in rows]).astype("datetime64[m]")
    elev, az = sun_position(t, lat, lon)
    doy = np.array([(np.datetime64(r[0]) - np.datetime64(r[0][:4] + "-01-01")).astype(int) + 1 for r in rows])  # 1月1日=1
    dni, dhi = erbs(ghi, elev, doy)
    tt, pp = math.radians(TILT), math.radians(AZIMUTH)
    e, a = np.radians(elev), np.radians(az)
    cos_inc = np.sin(e) * math.cos(tt) + np.cos(e) * math.sin(tt) * np.cos(a - pp)
    poa = np.where((elev > 0) & (cos_inc > 0), dni * cos_inc, 0) + dhi * (1 + math.cos(tt)) / 2 + ghi * ALBEDO * (1 - math.cos(tt)) / 2
    kwh = poa / 1000 * KPY  # 1kW のパネル（1kW/m² で 1kW）の発電 [kWh]
    return dict(zip(keys, kwh))


if __name__ == "__main__":
    tepco_dir, fit_dir, jma_dir, out_dir = (Path(p) for p in sys.argv[1:5])
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = capacity_by_pref(fit_dir)
    weights = {s: sum(cap[p] * k for p, k in prefs.items()) for s, (_, _, prefs) in STATIONS.items()}
    area_kw = sum(weights.values())
    models = {s: model_per_kw(jma_dir / f"{s}_{YEAR}.csv", lat, lon) for s, (lat, lon, _) in STATIONS.items()}
    actual_mwh = tepco_hourly(tepco_dir)

    keys = sorted(set(actual_mwh) & set.intersection(*(set(m) for m in models.values())))
    model = np.array([sum(models[s][k] * weights[s] for s in STATIONS) / area_kw for k in keys])  # kWh/kW
    actual = np.array([actual_mwh[k] * 1000 / area_kw for k in keys])  # kWh/kW
    months = np.array([int(k[0][5:7]) for k in keys])
    days = np.array([k[0] for k in keys])

    day_list = sorted(set(days))
    dm = np.array([model[days == d].sum() for d in day_list])
    da = np.array([actual[days == d].sum() for d in day_list])
    summary = {
        "year": YEAR, "hours": len(keys), "days": len(day_list), "area_capacity_gw": round(area_kw / 1e6, 2),
        "station_weights_gw": {s: round(w / 1e6, 2) for s, w in weights.items()},
        "annual_kwh_per_kw": {"model": round(float(model.sum())), "actual": round(float(actual.sum()))},
        "ratio_actual_to_model": round(float(actual.sum() / model.sum()), 3),
        "hourly_r": round(float(np.corrcoef(model, actual)[0, 1]), 3),
        "daily_r": round(float(np.corrcoef(dm, da)[0, 1]), 3),
        "monthly_kwh_per_kw": {int(m): {"model": round(float(model[months == m].sum()), 1), "actual": round(float(actual[months == m].sum()), 1)}
                               for m in range(1, 13)},
        "assumptions": {"tilt": TILT, "azimuth": AZIMUTH, "kpy": KPY, "albedo": ALBEDO},
    }
    json.dump(summary, open(out_dir / "summary.json", "w"), ensure_ascii=False, indent=1)
    with open(out_dir / "hourly.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "hour", "model_kwh_per_kw", "actual_kwh_per_kw"])
        for k, m_, a_ in zip(keys, model, actual):
            w.writerow([k[0], k[1], round(float(m_), 4), round(float(a_), 4)])
    print(json.dumps({k: v for k, v in summary.items() if k != "monthly_kwh_per_kw"}, ensure_ascii=False))
    for m, v in summary["monthly_kwh_per_kw"].items():
        print(m, v)
