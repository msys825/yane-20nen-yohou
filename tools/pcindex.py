import math,urllib.request,functools
import mapbox_vector_tile as mvt
@functools.lru_cache(maxsize=256)
def _tile(z,x,y):
    b=urllib.request.urlopen(f"https://gic-tokyo.s3.ap-northeast-1.amazonaws.com/2024/dig/Vectortile/23ku/lp/{z}/{x}/{y}.pbf",timeout=30).read()
    return mvt.decode(b,default_options={"y_coord_down":True})
def _inside(pt,poly):
    xx,yy=pt;c=False
    for i in range(len(poly)):
        x1,y1=poly[i];x2,y2=poly[i-1]
        if (y1>yy)!=(y2>yy) and xx<(x2-x1)*(yy-y1)/(y2-y1)+x1: c=not c
    return c
def mesh_for(lon,lat,z=16):
    """緯度経度を含む東京都区部点群の図郭（MESH_NO, URL）を返す"""
    n=2**z; fx=(lon+180)/360*n; fy=(1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*n
    x,y=int(fx),int(fy); d=_tile(z,x,y); p=((fx-x)*4096,(fy-y)*4096)
    for f in d.get("lp2",{}).get("features",[]):
        g=f["geometry"]; polys=[g["coordinates"]] if g["type"]=="Polygon" else g["coordinates"]
        if any(_inside(p,pp[0]) for pp in polys): return f["properties"]["MESH_NO"],f["properties"]["URL"]
    return None
