"""PLATEAU の建物の 3D Tiles（練馬区 LOD2・テクスチャなし）を、手元にダウンロードする

全戸の計算（tools/simple_diagnosis.py など）は、このフォルダのタイルを読む。約1.3GB、260枚。
途中で止まっても、もう一度走らせれば、足りない分だけ取りに行く。
使い方:
  python3 tools/fetch_tiles.py work/lod2
"""
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

# 出典：国土交通省 Project PLATEAU（東京都練馬区 2025年度）。アプリの地図（app/src/lib/plateau.ts）と同じもの
BASE = "https://assets.cms.plateau.reearth.io/assets/e2/1a7f05-4810-4330-a66d-24956da0040b/13120_nerima-ku_pref_2025_citygml_1_op_bldg_3dtiles_13120_nerima-ku_lod2_no_texture"

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
ts_path = os.path.join(out, "tileset.json")
if not os.path.exists(ts_path):
    urllib.request.urlretrieve(f"{BASE}/tileset.json", ts_path)
uris: list[str] = []


def walk(node: dict) -> None:
    c = node.get("content") or {}
    u = c.get("uri") or c.get("url")
    if u:
        uris.append(u)
    for ch in node.get("children", []):
        walk(ch)


walk(json.load(open(ts_path))["root"])


def fetch(u: str) -> int:
    dst = os.path.join(out, u)
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return 0
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    for attempt in range(4):
        try:
            urllib.request.urlretrieve(f"{BASE}/{u}", dst + ".part")
            os.replace(dst + ".part", dst)
            return os.path.getsize(dst)
        except Exception as e:  # 通信の失敗は、少し待ってやり直す
            if attempt == 3:
                print("失敗", u, e, flush=True)
    return 0


with ThreadPoolExecutor(6) as ex:
    got = list(ex.map(fetch, uris))
have = sum(1 for u in uris if os.path.exists(os.path.join(out, u)))
print(f"{have}/{len(uris)} 枚。今回 {sum(got) / 1e6:.0f} MB をダウンロード")
