"""区全体の予報マップ：簡易診断（tools/simple_diagnosis.py の simple_all.csv）を、アプリの地図に置く点のデータにする

将来、発電が1割以上減りうる家（risk）と、それ以外の家（safe）に分け、[経度, 緯度, 屋根の高さ] を平らに並べる。
使い方:
  python3 tools/export_forecast_points.py <simple_all.csv> <建物索引JSON> <外枠JSON> <出力JSON>
"""
import csv
import json
import sys

src, index_path, bbox_path, out_path = sys.argv[1:5]
rows = json.load(open(index_path))
bbox = json.load(open(bbox_path))
risk, safe = [], []
for r in csv.DictReader(open(src)):
    k = int(r["k"])
    now, fut = float(r["kwh_per_kw_now"]), float(r["kwh_per_kw_future"])
    change = (fut - now) / now if now else 0
    top = round((bbox[k][4] or 0) + (rows[k]["h"] or 0) + 1)
    p = [round(float(r["lon"]), 5), round(float(r["lat"]), 5), top]
    (risk if change <= -0.1 else safe).extend(p)
json.dump({"houses": (len(risk) + len(safe)) // 3, "risk": risk, "safe": safe,
           "note": "簡易診断：南側が最大まで建ったとき、発電が1割以上減りうる家を risk とした"},
          open(out_path, "w"), separators=(",", ":"))
print(len(risk) // 3, "risk,", len(safe) // 3, "safe")
