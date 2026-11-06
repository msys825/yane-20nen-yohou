"""気象庁「過去の気象データ検索」の1時間ごとのページから、全天日射量（MJ/m²、その時刻までの1時間）を集める

発電量の答え合わせ（tools/validate_tepco.py）で、その年の実際の日射量として使う。
サーバーに負担をかけないよう、1ページごとに間を空ける。途中で止まっても、取得済みの日は飛ばして続きから取る。

使い方:
  python3 tools/fetch_jma_radiation.py <出力フォルダ> <年> [観測所名 ...]
出力：<出力フォルダ>/<観測所名>_<年>.csv（列：日付, 時(1〜24), 全天日射量MJ/m²）
"""
from __future__ import annotations

import csv
import datetime as dt
import re
import sys
import time
import urllib.request
from pathlib import Path

# 東京電力エリアで全天日射量を観測している地点（府県番号, 地点番号）。横浜・千葉・熊谷・水戸は日射を観測していない
STATIONS = {
    "東京": (44, 47662), "館野": (40, 47646), "銚子": (45, 47648), "宇都宮": (41, 47615), "前橋": (42, 47624), "甲府": (49, 47638),
}
URL = "https://www.data.jma.go.jp/stats/etrn/view/hourly_s1.php?prec_no={p}&block_no={b}&year={y}&month={m}&day={d}&view="


def day_values(p: int, b: int, day: dt.date) -> list[float | None]:
    html = urllib.request.urlopen(URL.format(p=p, b=b, y=day.year, m=day.month, d=day.day), timeout=30).read().decode("utf-8")
    out: list[float | None] = []
    for row in re.findall(r'<tr class="mtx"[^>]*>(.*?)</tr>', html, re.S):
        cells = [re.sub("<[^>]+>", "", c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
        if cells and cells[0].isdigit():
            v = cells[11] if len(cells) > 11 else ""
            v = v.rstrip(")] ").replace("#", "")
            out.append(float(v) if re.fullmatch(r"[0-9.]+", v) else (0.0 if v in ("", "--") else None))
    return out


if __name__ == "__main__":
    out_dir, year = Path(sys.argv[1]), int(sys.argv[2])
    names = sys.argv[3:] or list(STATIONS)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in names:
        p, b = STATIONS[name]
        path = out_dir / f"{name}_{year}.csv"
        done = {r[0] for r in csv.reader(open(path))} if path.exists() else set()
        with open(path, "a", newline="") as f:
            w = csv.writer(f)
            day = dt.date(year, 1, 1)
            while day.year == year:
                if day.isoformat() not in done:
                    for attempt in range(3):
                        try:
                            vals = day_values(p, b, day)
                            break
                        except Exception:
                            time.sleep(5)
                    else:
                        vals = []
                    for h, v in enumerate(vals, start=1):
                        w.writerow([day.isoformat(), h, "" if v is None else v])
                    f.flush()
                    time.sleep(0.4)
                day += dt.timedelta(days=1)
        print(name, "done", flush=True)
