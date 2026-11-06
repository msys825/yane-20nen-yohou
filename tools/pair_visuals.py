"""eval_pairs.py で計算した候補から、動画に向く組を条件で絞り、画面で見比べるための形（輪郭・将来の建物）を書き出す

絞る条件（どれも「今はそっくり、将来だけ違う」が数字でも言えるため）
  - 2軒ともパネルを置ける量が 1.8kW 以上で、置ける量の差が 1.6 倍以内
  - 今の 1kW あたりの発電量の差が 7% 以内
  - 家A は南側が最大まで建つと 30% 以上減り、家B はほとんど変わらない（3% 以内）
見た目の物差し（並べる順に使う）
  - 家A のオレンジ（将来の建物）が少ないほど、何が起きるか一目で分かる
  - 2軒のまわり 40m の今の建物の高さがそろっているほど、「今は同じ条件」に見える
  - 2軒が東西に並ぶほど、同じ向きで比べられる

使い方:
  python3 tools/pair_visuals.py <LOD2タイルのフォルダ> <建物索引JSON> <評価JSON> <出力JSON>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from future_shade import BuildingIndex, future_volumes, hull_lonlat  # noqa: E402

lod2_dir, index_path, eval_path, out_path = sys.argv[1:5]
index = BuildingIndex(index_path, lod2_dir)
pairs = json.load(open(eval_path))


def good(p: dict) -> bool:
    a, b = p["eval"]
    if not (a["per_kw_now"] and b["per_kw_now"]) or min(a["kw"], b["kw"]) < 1.8:
        return False
    if max(a["kw"], b["kw"]) / min(a["kw"], b["kw"]) > 1.6:
        return False
    if abs(a["per_kw_now"] - b["per_kw_now"]) / max(a["per_kw_now"], b["per_kw_now"]) > 0.07:
        return False
    return a["change"] <= -0.30 and b["change"] >= -0.03


def tallest_near(k: int, r: float = 40.0) -> float:
    hx, hy = index.xy[k]
    return max([index.rows[q]["h"] or 0 for q in index.near(hx, hy, r) if q != k] or [0])


def visual_score(p: dict) -> float:
    a, b = p["eval"]
    return (-a["change"] * 20 - 1.5 * max(0, len(a["volumes"]) - 1) - 0.8 * abs(p["tall"][0] - p["tall"][1])
            - 0.5 * max(0, max(p["tall"]) - 10) + 4 * p["side_by_side"] - 0.03 * p["dist"])


picked = [p for p in pairs if good(p)]
for p in picked:
    p["tall"] = [tallest_near(p["a"]), tallest_near(p["b"])]
    p["visual_score"] = round(visual_score(p), 2)
picked.sort(key=lambda p: -p["visual_score"])
out = []
for n, p in enumerate(picked):
    houses = []
    for label, k in (("家A", p["a"]), ("家B", p["b"])):
        fp, base = hull_lonlat(index.triangles(k))
        houses.append({"label": label, "footprint": fp, "baseHeight": round(base, 2), "height": index.rows[k]["h"],
                       "lon": index.rows[k]["lon"], "lat": index.rows[k]["lat"]})
    volumes = []
    for k in (p["a"], p["b"]):
        for v in future_volumes(index, k, 0.0):
            vf, vb = hull_lonlat(index.triangles(v["k"]))
            volumes.append({"footprint": vf, "baseHeight": round(vb, 2), "nowHeight": v["now_h"], "maxHeight": v["max_h"]})
    a, b = p["eval"]
    out.append({"id": n, "addr": p["addr"][0], "dist": p["dist"], "visual_score": p["visual_score"], "tall": p["tall"],
                "side_by_side": p["side_by_side"], "houses": houses, "volumes": volumes,
                "summary": f"A {a['per_kw_now']}→{a['per_kw_future']} ({a['change']*100:+.0f}%) {a['kw']}kW / "
                           f"B {b['per_kw_now']}→{b['per_kw_future']} ({b['change']*100:+.0f}%) {b['kw']}kW",
                "a": p["a"], "b": p["b"], "gml": p["gml"]})
    print(n, p["visual_score"], p["addr"][0], out[-1]["summary"], len(volumes), "volumes", "tall", p["tall"],
          "side", p["side_by_side"], "dist", p["dist"], flush=True)
json.dump(out, open(out_path, "w"), ensure_ascii=False, indent=1)
