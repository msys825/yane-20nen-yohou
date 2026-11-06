"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { BuildingInfo } from "@/lib/plateau";
import { azimuthLabel, fetchListing, type Diagnosis } from "@/lib/diagnosis";
import AdvisorChat from "@/components/AdvisorChat";
import type { FutureCity, ForecastMap } from "@/components/CesiumMap";
import { fetchSimple, type SimpleDiagnosis } from "@/lib/simple";
import QuoteCheck from "@/components/QuoteCheck";

const CesiumMap = dynamic(() => import("@/components/CesiumMap"), { ssr: false });

// 冬至の日の時刻（日本時間）。影がいちばん長くなる日
const WINTER_SOLSTICE = "2026-12-21";

function jstToUtcIso(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const utc = new Date(Date.UTC(2026, 11, 21, h - 9, m));
  return utc.toISOString();
}

export default function Home() {
  const [building, setBuilding] = useState<BuildingInfo | null>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [showFuture, setShowFuture] = useState(true);
  const [hour, setHour] = useState(12);
  const timeIso = useMemo(() => jstToUtcIso(hour), [hour]);
  const [pairIds, setPairIds] = useState<string[]>([]);
  const [compare, setCompare] = useState<{ gmlIds: string[]; requestedAt: number } | null>(null);
  const [pair, setPair] = useState<Diagnosis[] | null>(null);
  // 2軒を比べるときは、まず「今」だけを見せ、ボタンで「20年後に建ちうる建物」を見せる
  const [pairStage, setPairStage] = useState<"now" | "future">("now");
  // 「建ちうる未来の街」（練馬区全体）
  const [futureCityReq, setFutureCityReq] = useState<{ url: string; requestedAt: number } | null>(null);
  const [city, setCity] = useState<FutureCity | null>(null);
  // 詳しい診断がない家の簡易診断
  const [simple, setSimple] = useState<SimpleDiagnosis | null>(null);
  // 区全体の予報マップ
  const [forecastReq, setForecastReq] = useState<{ requestedAt: number } | null>(null);
  const [forecast, setForecast] = useState<ForecastMap | null>(null);
  const futureVisible = showFuture && !(pair && pairStage === "now");
  const volumeCount = (pair ?? (diagnosis ? [diagnosis] : [])).reduce((n, d) => n + d.volumes.length, 0);

  // 動画用のデモの2軒（家A・家B）
  useEffect(() => {
    fetchListing().then((l) => setPairIds(l.filter((h) => h.label).sort((a, b) => a.no - b.no).map((h) => h.gmlId)));
  }, []);

  return (
    <main className="flex h-screen flex-col md:flex-row">
      <div className="relative h-[55vh] shrink-0 md:h-auto md:flex-1">
        <CesiumMap
          onSelect={(info, diag) => {
            setBuilding(info);
            setDiagnosis(diag);
            setSimple(null);
            setForecast(null);
            if (!diag && info?.gmlId) fetchSimple(info.gmlId).then(setSimple);
            setPair(null);
            setCity(null);
            setFutureCityReq(null);
          }}
          onCompare={(diags) => {
            setCity(null);
            setFutureCityReq(null);
            setPair(diags);
            setPairStage("now");
            setDiagnosis(null);
            setBuilding(null);
          }}
          compare={compare}
          showFuture={futureVisible}
          timeIso={timeIso}
          forecastMap={forecastReq}
          onForecastMap={(m) => {
            setForecast(m);
            setCity(null);
            setPair(null);
            setDiagnosis(null);
            setBuilding(null);
          }}
          futureCity={futureCityReq}
          onFutureCity={(c) => {
            setCity(c);
            setPair(null);
            setDiagnosis(null);
            setBuilding(null);
          }}
        />
        {(city || (futureVisible && (volumeCount > 0 || (simple?.volumes ?? 0) > 0))) && (
          <div className="absolute right-4 top-4 max-w-xs rounded-lg bg-white/95 p-3 text-sm text-neutral-900 shadow">
            <p className="flex items-center gap-2 font-bold">
              <span className="inline-block h-4 w-4 shrink-0 rounded-sm border-2 border-[#e8590c] bg-[#e8590c]/45" />
              南側に、ルール上建ちうる最大の建物
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              今の建物が、容積率・用途地域などのルールで建てられるいちばん高い姿に建て替わった場合（目安）。
            </p>
          </div>
        )}
        <div className="absolute left-4 top-4 flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => {
              setForecastReq(null);
              setForecast(null);
              setFutureCityReq({ url: "/data/future_city/nerima.json", requestedAt: Date.now() });
            }}
            className="rounded-lg bg-white/95 px-3 py-2 text-sm font-bold text-neutral-900 shadow"
          >
            建ちうる未来の街を見る
          </button>
          <button
            type="button"
            onClick={() => {
              setFutureCityReq(null);
              setCity(null);
              setForecastReq({ requestedAt: Date.now() });
            }}
            className="rounded-lg bg-white/95 px-3 py-2 text-sm font-bold text-neutral-900 shadow"
          >
            区全体の予報マップを見る
          </button>
          {pairIds.length === 2 && (
            <button
              type="button"
              onClick={() => setCompare({ gmlIds: pairIds, requestedAt: Date.now() })}
              className="rounded-lg bg-white/95 px-3 py-2 text-sm font-bold text-neutral-900 shadow"
            >
              そっくりな2軒を比べる
            </button>
          )}
        </div>
        <div className="absolute bottom-4 left-4 right-4 rounded-lg bg-white/90 p-3 text-sm text-neutral-900 shadow md:right-auto md:w-96">
          <label className="flex items-center justify-between gap-3">
            <span>
              冬至（{WINTER_SOLSTICE.slice(5).replace("-", "/")}）の {String(Math.floor(hour)).padStart(2, "0")}:
              {String(Math.round((hour % 1) * 60)).padStart(2, "0")}
            </span>
            <input
              type="range"
              min={8}
              max={16}
              step={0.25}
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              className="flex-1"
            />
          </label>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={showFuture} onChange={(e) => setShowFuture(e.target.checked)} />
            南側に「建ちうる最大の建物」を表示
          </label>
        </div>
      </div>
      <aside className="min-h-0 w-full flex-1 overflow-y-auto border-l border-neutral-200 bg-white p-5 text-neutral-900 md:w-[30rem] md:flex-none">
        <h1 className="text-xl font-bold">屋根の20年予報</h1>
        <p className="mt-1 text-sm text-neutral-500">その太陽光、20年後も得ですか？</p>

        {forecast ? (
          <ForecastPanel m={forecast} />
        ) : city ? (
          <CityPanel city={city} />
        ) : pair ? (
          <PairPanel pair={pair} stage={pairStage} onReveal={() => setPairStage("future")} />
        ) : diagnosis ? (
          <DiagnosisPanel d={diagnosis} />
        ) : building && simple ? (
          <SimplePanel b={building} s={simple} />
        ) : building ? (
          <p className="mt-6 text-sm text-neutral-600">
            この建物の診断データはまだありません（{building.detailedUsage ?? building.usage ?? "用途不明"}・
            {building.storeys ?? "?"}階）。地図の青・オレンジの点の家を選んでください。
          </p>
        ) : (
          <p className="mt-6 text-sm text-neutral-600">
            地図の点の家をクリックしてください。オレンジの点は、将来の影で発電量が1割以上減りうる家です。
          </p>
        )}

        <p className="mt-10 text-xs leading-relaxed text-neutral-400">
          建物・都市計画：国土交通省 Project PLATEAU（東京都練馬区 2025年度）。屋根・影：東京都デジタルツイン実現プロジェクト
          区部点群データ。日射量：NEDO 年間時別日射量データベース（METPV-11）東京。背景地図：国土地理院。
        </p>
      </aside>
    </main>
  );
}

// 1kWあたりの年間発電量で比べる（屋根の大きさの違いを除くため）
function perKw(kwh: number, kw: number) {
  return kw ? Math.round(kwh / kw) : 0;
}

function SimplePanel({ b, s }: { b: BuildingInfo; s: SimpleDiagnosis }) {
  const pct = Math.round(s.change * 100);
  const watch = pct <= -10;
  return (
    <div className="mt-6 space-y-5 text-sm">
      <section>
        <p className="inline-block rounded bg-neutral-100 px-2 py-0.5 text-xs font-bold text-neutral-600">簡易診断</p>
        <p className="mt-2 text-neutral-500">{(b.address ?? "").replace("東京都", "")}</p>
        <p className="mt-1">
          {b.storeys ? `${b.storeys}階建て・` : ""}高さ{b.height ?? "?"}m ／ {b.zone ?? "用途地域不明"}
        </p>
      </section>
      <section className={`rounded-lg border p-4 ${watch ? "border-orange-300 bg-orange-50" : "border-sky-200 bg-sky-50"}`}>
        <p className="text-base font-bold">{watch ? "将来の影に気をつけたい家です" : "将来の影の心配はほとんどありません"}</p>
        <p className="mt-1 text-neutral-700">
          {watch
            ? `南側の建物がルール上の最大まで建て替わると、発電量が約${-pct}%減りえます。`
            : s.volumes > 0
              ? `南側に高くなりうる建物はありますが、発電量への影響は${-pct}%ほどです。`
              : "南側に、ルール上いまより大きく高くなる建物はありません。"}
        </p>
      </section>
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-neutral-200 p-3">
          <p className="text-neutral-500">今の発電量の目安（1年）</p>
          <p className="mt-1 text-2xl font-bold">{s.kwhNow ? `${s.kwhNow.toLocaleString()} kWh` : "—"}</p>
          <p className="text-neutral-500">{s.kw ? `パネル約${s.kw}kW` : ""}（1kWあたり{s.perKwNow.toLocaleString()}kWh）</p>
        </div>
        <div className={`rounded-lg border p-3 ${watch ? "border-orange-300" : "border-neutral-200"}`}>
          <p className="text-neutral-500">南側が最大まで建ったら</p>
          <p className={`mt-1 text-2xl font-bold ${watch ? "text-orange-700" : ""}`}>
            {s.kwhFuture ? `${s.kwhFuture.toLocaleString()} kWh` : "—"}
          </p>
          <p className="text-neutral-500">
            {pct > 0 ? "+" : ""}
            {pct}%（南側の{s.volumes}棟）
          </p>
        </div>
      </section>
      <p className="text-xs leading-relaxed text-neutral-500">
        簡易診断は、PLATEAUの建物の外形と高さだけで、周りの建物の影を計算した目安です（木の影と屋根の形は含みません。屋根は真南・傾き25°と仮定）。点群で屋根を測った詳しい診断の46軒と比べると、「将来1割以上減りうる家」の見分けは45軒で一致しました。AIとの相談と見積書のチェックは、今回の試作では詳しい診断の家で使えます。
      </p>
    </div>
  );
}

function ForecastPanel({ m }: { m: ForecastMap }) {
  const risk = m.risk.length / 3;
  const pct = ((risk / m.houses) * 100).toFixed(1);
  return (
    <div className="mt-6 space-y-4 text-sm">
      <h2 className="text-base font-bold">区全体の予報マップ：練馬区の戸建て {m.houses.toLocaleString()}軒</h2>
      <div className="space-y-2">
        <p className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-[#e8590c]" />
          <b>将来の影に気をつけたい家</b>：{risk.toLocaleString()}軒（{pct}%）
        </p>
        <p className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-[#b9d3ea]" />
          将来の影の心配がほとんどない家：{(m.houses - risk).toLocaleString()}軒
        </p>
      </div>
      <p className="text-neutral-700">
        気をつけたい家は、南側の建物がルール上の最大まで建て替わると、発電が1割以上減りうる家です。大通り沿いなど、建ててよい高さが変わる境目の近くに集まっています。
      </p>
      <p className="text-neutral-500">家をクリックすると、その家の予報を見られます。</p>
      <p className="text-xs leading-relaxed text-neutral-400">
        PLATEAUの建物の外形と高さだけで計算した簡易診断です（木の影・屋根の形は含みません）。点群で詳しく診断した46軒と比べ、「1割以上減りうる家」の見分けは45軒で一致しました。
      </p>
    </div>
  );
}

function CityPanel({ city }: { city: FutureCity }) {
  const pct = Math.round((city.count / city.candidates) * 100);
  return (
    <div className="mt-6 space-y-4 text-sm">
      <h2 className="text-base font-bold">建ちうる未来の街：{city.area}</h2>
      <p>
        オレンジは、今の建物が、容積率・用途地域などのルールで建てられるいちばん高い姿に建て替わった場合です。色が濃いほど、今より高くなります。
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-neutral-200 p-3">
          <p className="text-neutral-500">ルール上、今より高くなりうる建物</p>
          <p className="mt-1 text-2xl font-bold">{city.count.toLocaleString()}棟</p>
          <p className="text-neutral-500">範囲の{city.candidates.toLocaleString()}棟のうち{pct}%</p>
        </div>
        <div className="rounded-lg border border-neutral-200 p-3">
          <p className="text-neutral-500">増えうる建物の体積</p>
          <p className="mt-1 text-2xl font-bold">{Math.round(city.addedVolumeM3 / 10000).toLocaleString()}万m³</p>
          <p className="text-neutral-500">東京ドーム約{Math.round(city.addedVolumeM3 / 1240000)}杯分</p>
        </div>
      </div>
      <p className="text-neutral-600">
        今の地図を見ても、この街の20年後は分かりません。PLATEAUには建物の形と「建ててよいルール」が1棟ずつ入っているので、建ちうる未来の街を計算できます。
      </p>
      <p className="text-xs text-neutral-400">
        最大の高さは、容積率・建ぺい率・用途地域・高度地区から出した目安です（斜線制限・日影規制は含みません）。実際にそこまで建つとは限りません。
      </p>
    </div>
  );
}

function storeysText(st: number | null | undefined, h: number | null | undefined) {
  return `${st ? `${st}階建て・` : ""}${h ?? "?"}m`;
}

function PairPanel({ pair, stage, onReveal }: { pair: Diagnosis[]; stage: "now" | "future"; onReveal: () => void }) {
  const town = pair[0].address.replace("東京都練馬区", "練馬区");
  // 将来の変化が大きいほう（家A）と、変わらないほう（家B）
  const [risky, safe] = [...pair].sort((a, b) => a.future.change - b.future.change);
  const rs = risky.southNeighbor;
  const ss = safe.southNeighbor;
  const floors = (h: number | null | undefined) => (h ? `${Math.round(h / 3)}階相当` : "");
  // 南隣のルール上の最大。今の高さとほとんど変わらないときは「今と同じくらい」と書く
  const maxText = (n: Diagnosis["southNeighbor"]) =>
    !n?.maxHeight ? "—" : n.nowHeight && n.maxHeight <= n.nowHeight + 1 ? `今と同じくらい（${floors(n.maxHeight)}）` : `${n.maxHeight}m（${floors(n.maxHeight)}）`;
  return (
    <div className="mt-6 space-y-4 text-sm">
      <p>
        {town}に並ぶ、よく似た2軒の家です（{Math.round(Math.hypot((pair[0].lon - pair[1].lon) * 90500, (pair[0].lat - pair[1].lat) * 110950))}m先）。どちらも南隣は{rs?.storeys ?? 2}階建ての家で、今の日当たりもほぼ同じです。
      </p>
      <table className="w-full text-left">
        <thead>
          <tr className="text-neutral-500">
            <th className="py-1"></th>
            {pair.map((d) => (
              <th key={d.gmlId} className="py-1 text-base text-neutral-900">
                {d.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-neutral-200">
            <td className="py-2 text-neutral-500">家</td>
            {pair.map((d) => (
              <td key={d.gmlId} className="py-2">
                {storeysText(d.storeys, d.height)}
              </td>
            ))}
          </tr>
          <tr className="border-t border-neutral-200">
            <td className="py-2 text-neutral-500">パネルを置ける量</td>
            {pair.map((d) => (
              <td key={d.gmlId} className="py-2">
                {d.now.kw} kW
              </td>
            ))}
          </tr>
          <tr className="border-t border-neutral-200">
            <td className="py-2 text-neutral-500">今の南隣</td>
            {pair.map((d) => (
              <td key={d.gmlId} className="py-2">
                {d.southNeighbor ? `${storeysText(d.southNeighbor.storeys, d.southNeighbor.nowHeight)}（${Math.round(d.southNeighbor.distance)}m先）` : "—"}
              </td>
            ))}
          </tr>
          <tr className="border-t border-neutral-200">
            <td className="py-2 text-neutral-500">今の発電量（1kWあたり）</td>
            {pair.map((d) => (
              <td key={d.gmlId} className="py-2 text-lg font-bold">
                {perKw(d.now.kwh, d.now.kw).toLocaleString()} kWh
              </td>
            ))}
          </tr>
          {stage === "future" && (
            <>
              <tr className="border-t border-orange-200 bg-orange-50">
                <td className="py-2 text-neutral-500">南隣のルール上の最大</td>
                {pair.map((d) => (
                  <td key={d.gmlId} className="py-2 font-bold">
                    {maxText(d.southNeighbor)}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-orange-200 bg-orange-50">
                <td className="py-2 text-neutral-500">南側が最大まで建ったら（1kWあたり）</td>
                {pair.map((d) => (
                  <td key={d.gmlId} className={`py-2 text-lg font-bold ${d.future.change <= -0.1 ? "text-orange-700" : ""}`}>
                    {perKw(d.future.kwh, d.now.kw).toLocaleString()} kWh
                    <span className="ml-1 text-sm">（{d.future.change > 0 ? "+" : ""}{Math.round(d.future.change * 100)}%）</span>
                  </td>
                ))}
              </tr>
            </>
          )}
        </tbody>
      </table>
      {stage === "now" ? (
        <>
          <p className="text-base font-bold">では、20年後に得をするのはどちらでしょう？</p>
          <button
            type="button"
            onClick={onReveal}
            className="w-full rounded-lg bg-[#e8590c] px-4 py-3 text-base font-bold text-white shadow hover:bg-[#d9480f]"
          >
            南側に、ルール上建ちうる建物を見る
          </button>
        </>
      ) : (
        <>
          <p className="text-neutral-700">
            違いは、南隣の土地の<b>ルール</b>です。{risky.label}の南側は{rs?.zone ?? ""}（容積率{rs?.floorAreaRate}%）で、ルール上{rs?.maxHeight}m（{floors(rs?.maxHeight)}）まで建てられます。
            {safe.label}の南側は{ss?.zone ?? ""}（容積率{ss?.floorAreaRate}%）で、{maxText(ss).replace(/（.*）/, "")}の建物までです。今の建物を見ただけでは、この違いは分かりません。
          </p>
          <p className="text-xs text-neutral-400">
            最大の高さは、容積率・建ぺい率・用途地域・高度地区から出した目安です（斜線制限・日影規制は含みません）。実際にそこまで建つとは限りません。
          </p>
          <p className="text-neutral-500">地図の「{risky.label}」「{safe.label}」の点を押すと、それぞれの詳しい診断を見られます。</p>
        </>
      )}
    </div>
  );
}

function DiagnosisPanel({ d }: { d: Diagnosis }) {
  const changePct = Math.round(d.future.change * 100);
  // パネルの対象面：傾き3度未満の面、または東〜南〜西向きの面（計算エンジンと同じ条件）
  const mainPlanes = d.roof.planes
    .filter((p) => p.usable >= 2 && (p.tilt < 3 || (p.tilt < 60 && p.azimuth >= 90 && p.azimuth <= 270)))
    .slice(0, 3);
  return (
    <div className="mt-6 space-y-6 text-sm">
      <section>
        <p className="text-neutral-500">{d.address.replace("東京都", "")}</p>
        <p className="mt-1">
          {d.storeys ?? "?"}階建て・高さ{d.height ?? "?"}m ／ {d.zone ?? "用途地域不明"}
        </p>
      </section>

      <section className="rounded-lg border border-neutral-200 p-4">
        <h2 className="font-bold">今の発電量（1年）</h2>
        <p className="mt-2 text-3xl font-bold">
          {d.now.kwh.toLocaleString()}
          <span className="ml-1 text-base font-normal">kWh</span>
        </p>
        <p className="mt-1 text-neutral-500">
          パネル {d.now.kw} kW ／ 周りの影で {Math.round((1 - d.now.kwh / d.now.kwhWithoutShade) * 100)}% 減っています
        </p>
      </section>

      <section
        className={`rounded-lg border p-4 ${changePct <= -10 ? "border-orange-300 bg-orange-50" : "border-neutral-200"}`}
      >
        <h2 className="font-bold">南側が最大まで建て替わったら</h2>
        <p className="mt-2 text-3xl font-bold">
          {d.future.kwh.toLocaleString()}
          <span className="ml-1 text-base font-normal">kWh</span>
          <span className={`ml-2 text-lg ${changePct <= -10 ? "text-orange-700" : "text-neutral-500"}`}>
            {changePct > 0 ? "+" : ""}
            {changePct}%
          </span>
        </p>
        {d.volumes.length ? (
          <ul className="mt-3 space-y-1 text-neutral-600">
            {d.volumes.slice(0, 4).map((v) => (
              <li key={v.gmlId}>
                {azimuthLabel(v.bearing)}側 {Math.round(v.distance)}m：今 {v.nowHeight}m → 最大 {v.maxHeight}m（{v.reason}）
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-neutral-600">南側に、今より大きく建て替えられる建物はありません。</p>
        )}
        <p className="mt-3 text-xs text-neutral-400">
          最大の高さは、容積率・建ぺい率・用途地域・高度地区から出した目安です。斜線制限・日影規制は含みません。
        </p>
      </section>

      <section>
        <h2 className="font-bold">屋根（航空レーザー点群から自動で計測）</h2>
        <ul className="mt-2 space-y-1 text-neutral-600">
          {mainPlanes.length ? (
            mainPlanes.map((p, i) => (
              <li key={i}>
                {p.tilt < 3 ? "平らな面" : `${azimuthLabel(p.azimuth)}向き・傾き${Math.round(p.tilt)}°`}：パネルを置ける面積
                {p.usable} m²
              </li>
            ))
          ) : (
            <li>パネルに向いた面（東〜南〜西向き、または平ら）が見つかりませんでした。</li>
          )}
        </ul>
      </section>

      {d.now.kw > 0 && (
        <>
          <AdvisorChat key={`advisor-${d.gmlId}`} gmlId={d.gmlId} kw={d.now.kw} kwhNow={d.now.kwh} kwhFuture={d.future.kwh} />
          <QuoteCheck key={`quote-${d.gmlId}`} gmlId={d.gmlId} />
        </>
      )}
    </div>
  );
}
