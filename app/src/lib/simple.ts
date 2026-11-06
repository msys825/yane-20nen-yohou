// 簡易診断（tools/simple_diagnosis.py）：PLATEAU の建物の外形・高さだけで、練馬区のすべての戸建ての今と将来の発電量を出したもの
// 詳しい診断（点群で屋根を測る）がない家に使う。木の影・屋根の形は含まない

export type SimpleDiagnosis = {
  kw: number | null; // パネルを置ける量の目安（屋根の面積から）
  kwhNow: number | null; // 今の年間発電量
  kwhFuture: number | null; // 南側が最大まで建ったときの年間発電量
  perKwNow: number; // 1kW あたり
  perKwFuture: number;
  change: number; // 将来の変化の割合
  volumes: number; // 南側で高くなりうる建物の数
};

const shards = new Map<string, Promise<Record<string, [number | null, number | null, number | null, number, number, number]>>>();

export async function fetchSimple(gmlId: string): Promise<SimpleDiagnosis | null> {
  if (!gmlId.startsWith("bldg_")) return null;
  const key = gmlId.slice(5, 7);
  if (!shards.has(key)) shards.set(key, fetch(`/data/simple/${key}.json`).then((r) => (r.ok ? r.json() : {})));
  const v = (await shards.get(key)!)[gmlId];
  if (!v) return null;
  const [kw, kwhNow, kwhFuture, perKwNow, perKwFuture, volumes] = v;
  return { kw, kwhNow, kwhFuture, perKwNow, perKwFuture, change: perKwNow ? (perKwFuture - perKwNow) / perKwNow : 0, volumes };
}
