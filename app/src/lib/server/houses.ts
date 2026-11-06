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

// AI に渡す、家の診断の要約
export function diagnosisSummary(d: Diagnosis): string {
  const lines = [
    `住所：${d.address}（${d.storeys ?? "?"}階建て、高さ${d.height ?? "?"}m、${d.zone ?? "用途地域不明"}）`,
    `屋根（航空レーザー点群から計測）：${d.roof.planes
      .map((p) => `傾き${Math.round(p.tilt)}°・方位${Math.round(p.azimuth)}°・置ける面積${p.usable}m²`)
      .join("／")}`,
    `パネル容量：${d.now.kw} kW`,
    `今の年間発電量：${d.now.kwh} kWh（周りの影がなければ ${d.now.kwhWithoutShade} kWh）`,
    `南側が最大まで建て替わったときの年間発電量：${d.future.kwh} kWh（${Math.round(d.future.change * 100)}%）`,
    ...d.volumes.slice(0, 5).map(
      (v) => `南側の建物：方位${v.bearing}°・距離${Math.round(v.distance)}m・今${v.nowHeight}m→最大${v.maxHeight}m（${v.reason}）`,
    ),
  ];
  return lines.join("\n");
}
