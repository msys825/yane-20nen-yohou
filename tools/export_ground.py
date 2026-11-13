"""地図の地面の高さの表を作る（背景の地図を、建物の足もとの高さまで持ち上げるため）

区全体の「建ちうる建物」のデータ（export_future_city.py の出力）にある、建物の底の高さ（楕円体高）を使う。
100m おきの格子に、近くの建物の底の高さの中央値を入れる。建物がないマスは、まわりの値で埋める。
使い方:
  python3 tools/export_ground.py app/public/data/future_city/nerima.json app/public/data/ground.json
"""
import json
import math
import statistics
import sys

src, out_path = sys.argv[1:3]
CELL_M = 100
pts = []
for b in json.load(open(src))["buildings"]:
    f = b["f"]
    pts.append((sum(p[0] for p in f) / len(f), sum(p[1] for p in f) / len(f), b["b"]))

d_lat = CELL_M / 110950
d_lon = CELL_M / (111320 * math.cos(math.radians(35.745)))
lon0 = min(p[0] for p in pts) - d_lon
lat0 = min(p[1] for p in pts) - d_lat
nx = int((max(p[0] for p in pts) - lon0) / d_lon) + 3
ny = int((max(p[1] for p in pts) - lat0) / d_lat) + 3

cells: dict[tuple[int, int], list[float]] = {}
for lon, lat, h in pts:
    cells.setdefault((round((lon - lon0) / d_lon), round((lat - lat0) / d_lat)), []).append(h)
grid: list[list[float | None]] = [[None] * nx for _ in range(ny)]
for (i, j), v in cells.items():
    grid[j][i] = statistics.median(v)
while any(v is None for row in grid for v in row):
    nxt = [row[:] for row in grid]
    for j in range(ny):
        for i in range(nx):
            if grid[j][i] is None:
                near = [grid[y][x] for y in range(max(0, j - 1), min(ny, j + 2)) for x in range(max(0, i - 1), min(nx, i + 2))
                        if grid[y][x] is not None]
                if near:
                    nxt[j][i] = sum(near) / len(near)
    grid = nxt

# h は南西の角から、西→東、南→北の順
json.dump({"lon0": round(lon0, 6), "lat0": round(lat0, 6), "dLon": round(d_lon, 8), "dLat": round(d_lat, 8), "nx": nx, "ny": ny,
           "h": [round(v, 1) for row in grid for v in row],
           "note": "地面の高さ（楕円体高、m）。建物の底の高さから作った目安"},
          open(out_path, "w"), ensure_ascii=False, separators=(",", ":"))
print(nx, "x", ny, "=", nx * ny, "points from", len(pts), "buildings")
