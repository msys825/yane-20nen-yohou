import csv,sys,datetime as dt
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt, numpy as np
rows=list(csv.DictReader(open(sys.argv[1])))
MODEL,ACTUAL="#E8590C","#1C6ED0"; INK,MUTED,GRID,BG="#1E2733","#5B6573","#E2DCCF","#FCFBF7"
plt.rcParams.update({"font.family":["Hiragino Sans","sans-serif"],"font.size":22,"axes.edgecolor":GRID,"xtick.color":MUTED,"ytick.color":MUTED,"text.color":INK,"figure.facecolor":BG,"axes.facecolor":BG,"savefig.facecolor":BG})
start=dt.date(2025,5,12); wk=[r for r in rows if start<=dt.date.fromisoformat(r["date"])<start+dt.timedelta(days=7)]
t=np.arange(len(wk)); wm=np.array([float(r["model_kwh_per_kw"]) for r in wk]); wa=np.array([float(r["actual_kwh_per_kw"]) for r in wk])
fig,ax=plt.subplots(figsize=(11,5.4),dpi=150)
ax.fill_between(t,wa,color=ACTUAL,alpha=0.12)
ax.plot(t,wa,color=ACTUAL,lw=4,label="実際の発電（東京電力エリア）")
ax.plot(t,wm,color=MODEL,lw=3,ls=(0,(4,2)),label="このツールの計算")
ax.set_xticks(np.arange(12,len(wk),24)); ax.set_xticklabels([f"5/{(start+dt.timedelta(days=i)).day}" for i in range(7)])
ax.set_ylim(0,0.98); ax.set_yticks([]); 
for s in ("top","right","left"): ax.spines[s].set_visible(False)
ax.tick_params(length=0)
peak=lambda d: (d*24+12, max(wa[d*24:(d+1)*24].max(), wm[d*24:(d+1)*24].max()))
for d,lab in ((1,"晴れ"),(5,"くもり")):
    x,y=peak(d); ax.annotate(lab,(x,y+0.03),ha="center",va="bottom",fontsize=24,color=INK,fontweight="bold")
ax.legend(loc="upper right",frameon=False,fontsize=21,handlelength=2.2)
fig.tight_layout()
fig.savefig(sys.argv[2])
