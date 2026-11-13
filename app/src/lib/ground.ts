// 地面の高さの表（tools/export_ground.py）。背景の地図を、建物の足もとの高さまで持ち上げるのに使う
// PLATEAU の建物は楕円体高で置かれている（練馬区の地面は高さ約51〜95m）。地図を高さ0mのままにすると、ななめから見たときに建物とずれる

export type Ground = { lon0: number; lat0: number; dLon: number; dLat: number; nx: number; ny: number; h: number[] };

let loading: Promise<Ground> | null = null;
export function fetchGround(): Promise<Ground> {
  if (!loading) loading = fetch("/data/ground.json").then((r) => r.json());
  return loading;
}

// その場所の地面の高さ（m）。表の外は、いちばん近い端の値
export function groundAt(g: Ground, lon: number, lat: number): number {
  const x = Math.min(Math.max((lon - g.lon0) / g.dLon, 0), g.nx - 1.001);
  const y = Math.min(Math.max((lat - g.lat0) / g.dLat, 0), g.ny - 1.001);
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const at = (ii: number, jj: number) => g.h[jj * g.nx + ii];
  return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
}
