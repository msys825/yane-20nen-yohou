// 高度地区の斜線：北側の境界から、斜めに高さをおさえるルール（tools/zoning.py と同じ決まり）
// 種類（第1種〜第3種）は、PLATEAU の建物の属性「高度地区」から。0 は不明・指定なし（制限なし）

// 北側の敷地の境界は、建物（外形）の北の端からこれだけ北にあると置く [m]（敷地の境界のデータがないため）
export const BOUNDARY_SETBACK = 1.0;

// 北側の境界から真北方向に d [m] 離れた所で、建ててよい高さ [m]
export function slantLimit(kind: number, d: number): number {
  if (!kind) return Infinity;
  if (kind === 1) return 5 + 0.6 * d;
  const a = kind === 3 ? 10 : 5;
  return d <= 8 ? a + 1.25 * d : a + 10 + 0.6 * (d - 8);
}

const M_PER_DEG_LAT = 110950;

// 凸多角形を、緯度が lo 以上 hi 以下の帯で切り取る
function clipLat(ring: [number, number][], lo: number, hi: number): [number, number][] {
  const cut = (pts: [number, number][], keep: (lat: number) => boolean, at: number) => {
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ka = keep(a[1]);
      const kb = keep(b[1]);
      if (ka) out.push(a);
      if (ka !== kb) out.push([a[0] + ((b[0] - a[0]) * (at - a[1])) / (b[1] - a[1]), at]);
    }
    return out;
  };
  return cut(cut(ring, (lat) => lat >= lo, lo), (lat) => lat <= hi, hi);
}

// 建ちうる建物を、斜線で切った形にする。外形を北から南へ step [m] ごとの帯に分け、帯ごとの高さ（地盤面から）を返す
// 今の高さより低くはしない（建て替えなければ、今の高さのまま残る）。同じ高さが続く帯は、1つにまとめる
export function slantSteps(
  footprint: [number, number][],
  kind: number | undefined,
  nowHeight: number,
  maxHeight: number,
  step = 2,
): { ring: [number, number][]; height: number }[] {
  const k = kind ?? 0;
  const north = Math.max(...footprint.map((p) => p[1]));
  const south = Math.min(...footprint.map((p) => p[1]));
  const depth = (north - south) * M_PER_DEG_LAT;
  const heightAt = (d: number) => Math.round(Math.max(nowHeight, Math.min(maxHeight, slantLimit(k, d + BOUNDARY_SETBACK))) * 10) / 10;
  if (!k || heightAt(0) >= maxHeight) return [{ ring: footprint, height: maxHeight }];
  const bands: { from: number; to: number; height: number }[] = [];
  for (let d = 0; d < depth; d += step) {
    const to = Math.min(depth, d + step);
    const height = heightAt((d + to) / 2);
    const last = bands[bands.length - 1];
    if (last && last.height === height) last.to = to;
    else bands.push({ from: d, to, height });
  }
  return bands
    .map((b) => ({ ring: clipLat(footprint, north - b.to / M_PER_DEG_LAT, north - b.from / M_PER_DEG_LAT), height: b.height }))
    .filter((b) => b.ring.length >= 3);
}
