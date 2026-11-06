"""練馬区の全建物について「ルール上の最大の高さ」を調べて保存する（そっくりな2軒を全件から探すための下準備）

使い方:
  python3 tools/scan_max_heights.py <建物索引JSON> <出力JSON>
出力は建物索引と同じ順の配列：[最大の高さ(m) or null, 用途地域, 何で決まったか]
"""
from __future__ import annotations

import json
import math
import sys
from multiprocessing import Pool
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from zoning import height_limits, max_buildable_height  # noqa: E402


def work(chunk: list[tuple[int, float, float, float | None, float | None]]) -> list[tuple[int, float | None, str | None, str]]:
    out = []
    for k, lon, lat, far, cov in chunk:
        lim = height_limits(lon, lat)
        h, why = max_buildable_height(lim, far, cov)
        out.append((k, h, lim.get("zone"), why))
    return out


if __name__ == "__main__":
    index_path, out_path = sys.argv[1:3]
    rows = json.load(open(index_path))
    # 同じ地図タイルの建物をまとめて処理する（タイルの読み込みを減らす）
    keyed = sorted(range(len(rows)), key=lambda k: (int((rows[k]["lon"] + 180) / 360 * 2 ** 15), int(rows[k]["lat"] * 2000)))
    items = [(k, rows[k]["lon"], rows[k]["lat"], rows[k].get("far"), rows[k].get("cov")) for k in keyed]
    size = 3000
    chunks = [items[i:i + size] for i in range(0, len(items), size)]
    result: list = [None] * len(rows)
    with Pool(8) as pool:
        for n, part in enumerate(pool.imap_unordered(work, chunks)):
            for k, h, zone, why in part:
                result[k] = [h, zone, why]
            print(f"{n + 1}/{len(chunks)}", flush=True)
    json.dump(result, open(out_path, "w"), ensure_ascii=False)
    print("done", math.fsum(1 for r in result if r and r[0] is not None), "with limits")
