// 前処理（tools/export_app_data.py）で作った、家ごとの診断データ
export type FutureVolume = {
  gmlId: string;
  footprint: [number, number][]; // [経度, 緯度]
  baseHeight: number; // 建物の底の楕円体高（m）
  nowHeight: number; // 今の高さ（m）
  maxHeight: number; // 建ててよい最大の高さ（m）
  reason: string; // 最大の高さが何で決まったか
  distance: number; // 家からの距離（m）
  bearing: number; // 家から見た方位（度、北=0）
  zone: string | null;
};

export type Diagnosis = {
  no: number;
  label?: string | null;
  gmlId: string;
  buildingId: string;
  address: string;
  lon: number;
  lat: number;
  footprint: [number, number][];
  baseHeight: number;
  storeys: number | null;
  height: number | null;
  zone: string | null;
  roof: { planes: { tilt: number; azimuth: number; area: number; usable: number }[]; pointCount: number };
  now: { kw: number; kwh: number; kwhWithoutShade: number; irradiance: number };
  future: { kwh: number; irradiance: number; change: number };
  volumes: FutureVolume[];
  // 真南でいちばん近い建物（2軒を比べる画面で、今の南隣とルール上の最大を見せる）
  southNeighbor?: {
    gmlId: string;
    usage: string | null;
    storeys: number | null;
    nowHeight: number | null;
    maxHeight: number | null;
    reason: string;
    zone: string | null;
    floorAreaRate: number | null;
    coverageRate: number | null;
    distance: number;
    bearing: number;
  } | null;
  sources: string[];
};

export type DiagnosisListing = {
  gmlId: string;
  no: number;
  label?: string | null; // 動画用のデモの家の名前（家A・家B）
  lon: number;
  lat: number;
  change: number;
  topHeight: number; // 屋根の上の楕円体高（m）。目印を置く高さ
}[];

export async function fetchListing(): Promise<DiagnosisListing> {
  const res = await fetch("/data/houses/index.json");
  return res.json();
}

export async function fetchDiagnosis(gmlId: string): Promise<Diagnosis | null> {
  const res = await fetch(`/data/houses/${gmlId}.json`);
  return res.ok ? res.json() : null;
}

export function azimuthLabel(az: number): string {
  const names = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  return names[Math.round(az / 45) % 8];
}
