import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Diagnosis } from "@/lib/diagnosis";

export async function loadDiagnosis(gmlId: string): Promise<Diagnosis | null> {
  if (!/^[\w-]+$/.test(gmlId)) return null; // パスに使うので、英数字とハイフンだけ受け付ける
  try {
    const file = path.join(process.cwd(), "public", "data", "houses", `${gmlId}.json`);
    return JSON.parse(await readFile(file, "utf8")) as Diagnosis;
  } catch {
    return null;
  }
}

const DIR_JA = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
const dirJa = (deg: number) => DIR_JA[Math.round(deg / 45) % 8];

// 画面から送られる、簡易診断の家の補足（PLATEAU の属性と、地図で求めた南側の建物）。AI への説明にだけ使う
export type HouseContext = {
  address?: string;
  zone?: string;
  storeys?: number;
  height?: number;
  volumes?: { bearing: number; distance: number; nowHeight: number; maxHeight: number }[];
};

// AI（相談・見積書）に渡す家の情報。詳しい診断（点群）があればそれを、なければ簡易診断を使う
export type HouseForAi = {
  kind: "detailed" | "simple";
  kw: number;
  kwhNow: number;
  kwhFuture: number;
  summary: string;
};

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined);

export async function loadHouseForAi(gmlId: string, ctx?: HouseContext): Promise<HouseForAi | null> {
  const d = await loadDiagnosis(gmlId);
  if (d) return { kind: "detailed", kw: d.now.kw, kwhNow: d.now.kwh, kwhFuture: d.future.kwh, summary: diagnosisSummary(d) };
  if (!/^bldg_[\w-]+$/.test(gmlId)) return null;
  try {
    const file = path.join(process.cwd(), "public", "data", "simple", `${gmlId.slice(5, 7)}.json`);
    const shard = JSON.parse(await readFile(file, "utf8")) as Record<string, [number | null, number | null, number | null, number, number, number]>;
    const v = shard[gmlId];
    if (!v || !v[0] || !v[1] || !v[2]) return null;
    const [kw, kwhNow, kwhFuture] = v as [number, number, number, number, number, number];
    const vols = (Array.isArray(ctx?.volumes) ? ctx!.volumes : []).slice(0, 6).filter((x) => num(x?.distance) !== undefined);
    const lines = [
      "診断の種類：簡易診断（PLATEAU の建物の外形と高さだけで計算。屋根は真南・傾き25°と仮定。木の影は含まない）",
      `住所：${clip(ctx?.address, 60) ?? "練馬区"}（${num(ctx?.storeys) ?? "?"}階建て、高さ${num(ctx?.height) ?? "?"}m、${clip(ctx?.zone, 30) ?? "用途地域不明"}）`,
      `パネル容量の目安：${kw} kW（PLATEAU の屋根の面積から）`,
      `今の年間発電量の目安：${kwhNow} kWh`,
      `南側が最大まで建て替わったときの年間発電量：${kwhFuture} kWh（${Math.round(((kwhFuture - kwhNow) / kwhNow) * 100)}%）`,
      ...vols.map((x) => `南側の建物：${dirJa(num(x.bearing) ?? 180)}・距離${Math.round(num(x.distance) ?? 0)}m・今${num(x.nowHeight)}m→最大${num(x.maxHeight)}m`),
    ];
    return { kind: "simple", kw, kwhNow, kwhFuture, summary: lines.join("\n") };
  } catch {
    return null;
  }
}

// AI に渡す、家の診断の要約
export function diagnosisSummary(d: Diagnosis): string {
  const lines = [
    "診断の種類：詳しい診断（東京都の航空レーザー点群で屋根の形を測り、周りの建物と木の影を計算）",
    `住所：${d.address}（${d.storeys ?? "?"}階建て、高さ${d.height ?? "?"}m、${d.zone ?? "用途地域不明"}）`,
    `屋根（航空レーザー点群から計測）：${d.roof.planes
      .map((p) => `傾き${Math.round(p.tilt)}°・${dirJa(p.azimuth)}向き・置ける面積${p.usable}m²`)
      .join("／")}`,
    `パネル容量：${d.now.kw} kW`,
    `今の年間発電量：${d.now.kwh} kWh（周りの影がなければ ${d.now.kwhWithoutShade} kWh）`,
    `南側が最大まで建て替わったときの年間発電量：${d.future.kwh} kWh（${Math.round(d.future.change * 100)}%）`,
    ...d.volumes.slice(0, 5).map(
      (v) => `南側の建物：${dirJa(v.bearing)}・距離${Math.round(v.distance)}m・今${v.nowHeight}m→最大${v.maxHeight}m（${v.reason}）`,
    ),
  ];
  return lines.join("\n");
}
