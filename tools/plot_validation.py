"""発電量の答え合わせ（tools/validate_tepco.py の出力）をグラフにする（スライド用の PNG）

  1. 月ごと：このツールの計算と実績（1kW あたり kWh）の棒
  2. 1週間の1時間ごと：晴れと曇りが入った週の線
  3. 1日ごと：365日の散布図（実績 ＝ 計算 の線つき）

使い方:
  python3 tools/plot_validation.py <validate_tepco.py の出力フォルダ>
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

out = Path(sys.argv[1])
summary = json.load(open(out / "summary.json"))
rows = list(csv.DictReader(open(out / "hourly.csv")))

# スライドと同じ色（色の見え方が違う人にも区別できることを確かめた組）
MODEL, ACTUAL = "#E8590C", "#1C6ED0"
INK, MUTED, GRID, BG = "#1E2733", "#5B6573", "#E2DCCF", "#FCFBF7"
plt.rcParams.update({"font.family": ["Hiragino Sans", "sans-serif"], "font.size": 15,
                     "axes.edgecolor": GRID, "axes.labelcolor": MUTED, "xtick.color": MUTED, "ytick.color": MUTED,
                     "text.color": INK, "figure.facecolor": BG, "axes.facecolor": BG, "savefig.facecolor": BG})


def style(ax):
    ax.grid(axis="y", color=GRID, linewidth=1)
    ax.set_axisbelow(True)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.tick_params(length=0)


# 1. 月ごと
m = summary["monthly_kwh_per_kw"]
months = np.arange(1, 13)
mv = np.array([m[str(i)]["model"] for i in months])
av = np.array([m[str(i)]["actual"] for i in months])
fig, ax = plt.subplots(figsize=(12, 5.4))
w = 0.38
ax.bar(months - w / 2 - 0.01, mv, w, color=MODEL, label="このツールの計算", zorder=2)
ax.bar(months + w / 2 + 0.01, av, w, color=ACTUAL, label="実際の発電（東京電力エリア）", zorder=2)
ax.set_xticks(months, [f"{i}月" for i in months])
ax.set_ylabel("1kWあたりの発電（kWh）")
style(ax)
ax.legend(frameon=False, loc="upper left", ncols=2)
fig.tight_layout()
fig.savefig(out / "monthly.png", dpi=200)

# 2. 1時間ごと：晴れと曇りの差が大きい週（実績の日量のばらつきが大きい7日）
dates = sorted({r["date"] for r in rows})
daily_a = {d: 0.0 for d in dates}
daily_m = {d: 0.0 for d in dates}
for r in rows:
    daily_a[r["date"]] += float(r["actual_kwh_per_kw"])
    daily_m[r["date"]] += float(r["model_kwh_per_kw"])
spring = [d for d in dates if "2025-04-01" <= d <= "2025-05-31"]
best = max(range(len(spring) - 6), key=lambda i: np.std([daily_a[d] for d in spring[i:i + 7]]))
week = spring[best:best + 7]
wr = [r for r in rows if r["date"] in week]
x = np.arange(len(wr))
fig, ax = plt.subplots(figsize=(12, 5.4))
ax.plot(x, [float(r["model_kwh_per_kw"]) for r in wr], color=MODEL, linewidth=2, label="このツールの計算")
ax.plot(x, [float(r["actual_kwh_per_kw"]) for r in wr], color=ACTUAL, linewidth=2, label="実際の発電（東京電力エリア）")
ax.set_xticks([i * 24 + 12 for i in range(7)], [f"{int(d[5:7])}/{int(d[8:])}" for d in week])
ax.set_ylabel("1kWあたりの発電（kWh／時）")
style(ax)
ax.legend(frameon=False, loc="upper left", ncols=2)
fig.tight_layout()
fig.savefig(out / "week.png", dpi=200)

# 3. 1日ごとの散布図
dm = np.array([daily_m[d] for d in dates])
da = np.array([daily_a[d] for d in dates])
fig, ax = plt.subplots(figsize=(6.4, 6))
lim = max(dm.max(), da.max()) * 1.05
ax.plot([0, lim], [0, lim * summary["ratio_actual_to_model"]], color=MUTED, linewidth=1, linestyle="--", zorder=1)
ax.scatter(dm, da, s=22, color=ACTUAL, edgecolors=BG, linewidths=0.8, zorder=2)
ax.set_xlim(0, lim)
ax.set_ylim(0, lim)
ax.set_xlabel("このツールの計算（kWh／日）")
ax.set_ylabel("実際の発電（kWh／日）")
ax.text(0.04, 0.95, f"365日  相関 r = {summary['daily_r']:.2f}", transform=ax.transAxes, va="top", fontsize=16, color=INK)
style(ax)
ax.grid(axis="x", color=GRID, linewidth=1)
fig.tight_layout()
fig.savefig(out / "daily.png", dpi=200)
print("saved", week)
