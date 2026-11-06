"""動画の冒頭用に「今はそっくり、でも20年後が違う2軒」を、練馬区の全独立住宅から探す

見た目で伝わるように、次の条件で選ぶ（数字は目安。最後は画面で見比べて決める）
  1. 今そっくり：独立住宅どうしで、高さの差 0.8m 以内・階数が同じ・屋根の面積が近い（0.75〜1.33倍）。15〜100m 以内に並ぶ
  2. 今の南隣もそっくり：どちらの真南（150〜210度、20m 以内）にも、同じくらいの低い建物がある
     → 今の南側の空の見え方（南の建物の見上げ角）も近い
  3. ルールだけが違う：家A の南隣はルール上 8m 以上高くできる。家B の南側はほとんど高くできない

使い方:
  python3 tools/find_pair.py <建物索引JSON> <最大の高さJSON> <外枠JSON> <出力JSON>
  最大の高さ JSON は tools/scan_max_heights.py の出力。外枠 JSON は [幅, 奥行, 屋根の面積, 住所, 地面の高さ] の配列
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict

import numpy as np
from pyproj import Transformer

index_path, max_path, bbox_path, out_path = sys.argv[1:5]
rows = json.load(open(index_path))
maxh = json.load(open(max_path))
bbox = json.load(open(bbox_path))
n = len(rows)

xs, ys = Transformer.from_crs(4326, 6677, always_xy=True).transform([r["lon"] for r in rows], [r["lat"] for r in rows])
xy = np.c_[xs, ys]
h = np.array([r["h"] or 0 for r in rows], float)
ground = np.array([b[4] for b in bbox], float)
size = np.array([(b[0] + b[1]) / 2 for b in bbox], float)  # 建物のおおよその差し渡し（m）
hmax = np.array([m[0] if m and m[0] is not None else 0 for m in maxh], float)
roof = [b[2] for b in bbox]

CELL = 25.0
grid: dict[tuple[int, int], list[int]] = defaultdict(list)
for k in range(n):
    grid[(int(xy[k, 0] // CELL), int(xy[k, 1] // CELL))].append(k)


def near(k: int, r: float) -> list[int]:
    cx, cy = int(xy[k, 0] // CELL), int(xy[k, 1] // CELL)
    m = int(math.ceil(r / CELL))
    out = []
    for i in range(cx - m, cx + m + 1):
        for j in range(cy - m, cy + m + 1):
            for q in grid.get((i, j), ()):
                if q != k and math.hypot(*(xy[q] - xy[k])) < r:
                    out.append(q)
    return out


def bearing(k: int, q: int) -> float:
    dx, dy = xy[q] - xy[k]
    return (math.degrees(math.atan2(dx, dy)) + 360) % 360


def south_profile(k: int) -> dict:
    """南側（120〜240度、30m 以内）の建物の見上げ角の最大（今／ルール上の最大まで建ったとき）と、真南の隣の建物"""
    top_k = ground[k] + h[k]
    now = fut = 0.0
    main = None
    for q in near(k, 30):
        b = bearing(k, q)
        if not 120 <= b <= 240:
            continue
        d = math.hypot(*(xy[q] - xy[k]))
        gap = max(d - 0.5 * size[q], 2.0)  # 屋根の中央から、南の建物の手前の壁まで（おおよそ）
        now = max(now, math.degrees(math.atan2(ground[q] + h[q] - top_k, gap)))
        fut = max(fut, math.degrees(math.atan2(ground[q] + max(h[q], hmax[q]) - top_k, gap)))
        if 150 <= b <= 210 and d < 20 and (main is None or d < main[1]):
            main = (q, d)
    return {"now": now, "fut": fut, "main": main[0] if main else None, "main_d": main[1] if main else None}


houses = [k for k, r in enumerate(rows)
          if r["usage"] == "独立住宅" and 5.5 <= h[k] <= 9.5 and roof[k] and 40 <= roof[k] <= 160]
print(len(houses), "houses", flush=True)
prof = {}
for c, k in enumerate(houses):
    prof[k] = south_profile(k)
    if c % 20000 == 0:
        print(c, flush=True)


def main_ok(k: int) -> bool:
    q = prof[k]["main"]
    return q is not None and h[q] <= h[k] + 1.5 and maxh[q][1] is not None  # 用途地域が分からない建物は除く


# 家A の候補：南隣がルール上大きく高くなる。家B の候補：南側がほとんど変わらない
cand_a = [k for k in houses if prof[k]["now"] <= 15 and prof[k]["fut"] - prof[k]["now"] >= 15 and main_ok(k)
          and hmax[prof[k]["main"]] - h[prof[k]["main"]] >= 8]
is_b = {k for k in houses if prof[k]["now"] <= 15 and prof[k]["fut"] - prof[k]["now"] <= 2 and main_ok(k)}
print(len(cand_a), "A candidates,", len(is_b), "B candidates", flush=True)

pairs = []
for a in cand_a:
    pa, ma = prof[a], prof[a]["main"]
    for b in near(a, 100):
        if b not in is_b:
            continue
        d = math.hypot(*(xy[b] - xy[a]))
        if d < 15 or abs(h[a] - h[b]) > 0.8:
            continue
        sa, sb = rows[a].get("st"), rows[b].get("st")
        if sa and sb and sa != sb:
            continue
        if not 0.75 <= roof[a] / roof[b] <= 1.33:
            continue
        pb, mb = prof[b], prof[b]["main"]
        if abs(pa["now"] - pb["now"]) > 4 or abs(h[ma] - h[mb]) > 1.5 or abs(pa["main_d"] - pb["main_d"]) > 4:
            continue
        side = abs(math.sin(math.radians(bearing(a, b))))  # 1 なら東西に並ぶ（同じ通りに並んで見える）
        score = (pa["fut"] - pa["now"]) - 3 * (pb["fut"] - pb["now"]) - 2 * abs(pa["now"] - pb["now"]) \
            + 6 * side - 0.05 * d + 0.5 * (hmax[ma] - h[ma])
        pairs.append({"score": round(score, 2), "a": int(a), "b": int(b), "dist": round(d, 1), "side_by_side": round(side, 2),
                      "h": [h[a], h[b]], "roof": [roof[a], roof[b]], "st": [sa, sb],
                      "now_deg": [round(pa["now"], 1), round(pb["now"], 1)], "fut_deg": [round(pa["fut"], 1), round(pb["fut"], 1)],
                      "south_now_h": [h[ma], h[mb]], "south_max_h": [hmax[ma], hmax[mb]],
                      "south_zone": [maxh[ma][1], maxh[mb][1]], "zone": [maxh[a][1], maxh[b][1]],
                      "addr": [bbox[a][3], bbox[b][3]], "gml": [rows[a]["gml_id"], rows[b]["gml_id"]],
                      "lonlat": [[rows[a]["lon"], rows[a]["lat"]], [rows[b]["lon"], rows[b]["lat"]]]})

# 同じ家A が何度も出ないよう、家A ごとに上位2組まで残す
by_a: dict[int, list[dict]] = defaultdict(list)
for p in sorted(pairs, key=lambda p: -p["score"]):
    if len(by_a[p["a"]]) < 2:
        by_a[p["a"]].append(p)
top = sorted((p for ps in by_a.values() for p in ps), key=lambda p: -p["score"])
json.dump(top[:300], open(out_path, "w"), ensure_ascii=False, indent=1, default=float)
print(len(pairs), "pairs,", len(by_a), "distinct A,", len(top), "kept")
for p in top[:25]:
    print(p["score"], p["dist"], p["side_by_side"], [float(x) for x in p["h"]], p["now_deg"], p["fut_deg"], [float(x) for x in p["south_now_h"]], [float(x) for x in p["south_max_h"]], p["south_zone"], p["addr"][0])
