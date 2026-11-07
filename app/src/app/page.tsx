"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BuildingInfo } from "@/lib/plateau";
import { azimuthLabel, fetchListing, type Diagnosis } from "@/lib/diagnosis";
import { calculateEconomics } from "@/lib/economics";
import AdvisorChat, { EconomicsCard, type HouseContext } from "@/components/AdvisorChat";
import type { CameraRequest, FutureCity, ForecastMap, NearVolume, Selection } from "@/components/CesiumMap";
import { fetchSimple, type SimpleDiagnosis } from "@/lib/simple";
import QuoteCheck from "@/components/QuoteCheck";

const CesiumMap = dynamic(() => import("@/components/CesiumMap"), { ssr: false });

// 「例の家で試す」：練馬区北町五丁目の家（そっくりな2軒の家A。南側に5階建てまで建ちうる）
const EXAMPLE_GML = "bldg_06dc6244-9e15-4fcd-894d-771ef8f4b32b";

// 冬至の日の時刻（日本時間）→ UTC。影がいちばん長くなる日
function jstToUtcIso(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return new Date(Date.UTC(2026, 11, 21, h - 9, m)).toISOString();
}

type View = "home" | "found" | "house" | "ward" | "pair";
type Place = { title: string; lon: number; lat: number };

// 国土地理院の住所検索（登録不要）。練馬区の住所だけを返す
async function searchAddress(q: string): Promise<Place[]> {
  const query = q.includes("練馬") ? q : `練馬区${q}`;
  const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const items = (await res.json()) as { geometry: { coordinates: [number, number] }; properties: { title: string } }[];
  return items
    .filter((i) => i.properties.title.includes("練馬区"))
    .slice(0, 6)
    .map((i) => ({ title: i.properties.title.replace("東京都", ""), lon: i.geometry.coordinates[0], lat: i.geometry.coordinates[1] }));
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [simple, setSimple] = useState<SimpleDiagnosis | null>(null);
  const [layers, setLayers] = useState({ forecast: true, city: false });
  const [layersOpen, setLayersOpen] = useState(false);
  const [forecast, setForecast] = useState<ForecastMap | null>(null);
  const [city, setCity] = useState<FutureCity | null>(null);
  const [camera, setCamera] = useState<CameraRequest | null>(null);
  const [pin, setPin] = useState<Place | null>(null);
  const [selectGml, setSelectGml] = useState<{ gmlId: string; requestedAt: number } | null>(null);
  const [showFuture, setShowFuture] = useState(true);
  const [hour, setHour] = useState(12);
  const timeIso = useMemo(() => jstToUtcIso(hour), [hour]);
  const [pairIds, setPairIds] = useState<string[]>([]);
  const [compare, setCompare] = useState<{ gmlIds: string[]; requestedAt: number } | null>(null);
  const [pair, setPair] = useState<Diagnosis[] | null>(null);
  const [pairStage, setPairStage] = useState<"now" | "future">("now");
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    fetchListing().then((l) => setPairIds(l.filter((h) => h.label).sort((a, b) => a.no - b.no).map((h) => h.gmlId)));
  }, []);
  useEffect(() => asideRef.current?.scrollTo({ top: 0 }), [view, selection]);
  // 動画・発表用の入口（画面には出さない）：?demo=pair（そっくりな2軒）、?view=ward（区全体）、?example=1（例の家）
  const urlDone = useRef(false);
  useEffect(() => {
    if (urlDone.current) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("demo") === "pair") {
      if (pairIds.length !== 2) return;
      openPair();
    } else if (q.get("view") === "ward") goWard();
    else if (q.get("example")) openExample();
    urlDone.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairIds]);

  const goHome = () => {
    setView("home");
    setLayers((l) => ({ ...l, city: false }));
    setSelection(null);
    setCompare(null);
    setPair(null);
    setPin(null);
  };
  const goWard = () => {
    setView("ward");
    setSelection(null);
    setCompare(null);
    setPin(null);
    setLayers((l) => ({ ...l, forecast: true }));
    setCamera({ kind: "ward", requestedAt: Date.now() });
  };
  const goPlace = (p: Place) => {
    setPin(p);
    setSelection(null);
    setCompare(null);
    setView("found");
    setCamera({ kind: "point", lon: p.lon, lat: p.lat, requestedAt: Date.now() });
  };
  const openExample = () => {
    setCompare(null);
    setSelectGml({ gmlId: EXAMPLE_GML, requestedAt: Date.now() });
  };
  const openPair = () => {
    setSelection(null);
    setPin(null);
    setLayers((l) => ({ ...l, city: false }));
    setPairStage("now");
    setCompare({ gmlIds: pairIds, requestedAt: Date.now() });
  };

  const futureVisible = showFuture && !(view === "pair" && pairStage === "now");

  return (
    <main className="flex h-dvh flex-col md:flex-row">
      <div className="relative h-[52vh] shrink-0 md:h-auto md:flex-1">
        <CesiumMap
          onSelect={(s) => {
            setSelection(s);
            setSimple(null);
            setCompare(null);
            setPin(null);
            if (!s) return;
            setView("house");
            setLayers((l) => ({ ...l, city: false })); // 家では、その家の南側の建物だけを見せる
            if (!s.diagnosis && s.info?.gmlId) fetchSimple(s.info.gmlId).then(setSimple);
          }}
          onCompare={(diags) => {
            setPair(diags);
            setView("pair");
          }}
          compare={compare}
          selectGml={selectGml}
          showFuture={futureVisible}
          timeIso={timeIso}
          layers={layers}
          onForecastLoaded={setForecast}
          onCityLoaded={setCity}
          camera={camera}
          pin={pin}
        />

        {/* 地図の左上：住所の検索欄。入口の画面では右側の欄だけにする（検索欄はいつも1つ） */}
        {view !== "home" && (
          <div className="absolute left-3 right-32 top-3 md:right-auto md:w-96">
            <SearchBox compact onPick={goPlace} />
          </div>
        )}

        {/* 地図の右上：レイヤー */}
        <div className="absolute right-3 top-3 text-sm text-[#1e2733]">
          <button
            type="button"
            onClick={() => setLayersOpen((o) => !o)}
            className="flex items-center gap-1 rounded-lg bg-white px-3 py-2 font-bold shadow"
            aria-expanded={layersOpen}
          >
            <LayersIcon /> レイヤー
          </button>
          {layersOpen && (
            <div className="absolute right-0 mt-2 w-60 space-y-2 rounded-lg bg-white p-3 shadow-lg">
              <label className="flex gap-2">
                <input type="checkbox" checked={layers.forecast} onChange={(e) => setLayers((l) => ({ ...l, forecast: e.target.checked }))} />
                <span>将来の影の予報（家の色）</span>
              </label>
              <label className="flex gap-2">
                <input type="checkbox" checked={layers.city} onChange={(e) => setLayers((l) => ({ ...l, city: e.target.checked }))} />
                <span>20年後に建ちうる建物</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setLayersOpen(false);
                  goWard();
                }}
                className="block border-t border-neutral-100 pt-2 text-left text-[#1e2733] underline underline-offset-2"
              >
                区全体の数字を見る
              </button>
            </div>
          )}
        </div>

        {/* 地図の左下：凡例（レイヤーを入れているときだけ） */}
        <Legend forecast={layers.forecast && !layers.city} city={layers.city} volumes={futureVisible && (view === "house" || view === "pair")} />
      </div>

      <aside ref={asideRef} className="min-h-0 w-full flex-1 overflow-y-auto border-l border-neutral-200 bg-white text-[#1e2733] md:w-[30rem] md:flex-none">
        {view === "home" && (
          <HomePanel onPick={goPlace} onExample={openExample} />
        )}
        {view === "found" && pin && <FoundPanel place={pin} onBack={goHome} />}
        {view === "house" && selection && (
          <HousePanel
            key={selection.info?.gmlId ?? selection.diagnosis?.gmlId}
            s={selection}
            simple={simple}
            hour={hour}
            setHour={setHour}
            showFuture={showFuture}
            setShowFuture={setShowFuture}
            onBack={goHome}
          />
        )}
        {view === "ward" && (
          <WardPanel
            forecast={forecast}
            city={city}
            cityOn={layers.city}
            onCity={(on) => {
              setLayers((l) => ({ ...l, city: on }));
              setCamera({ kind: on ? "wardOblique" : "ward", requestedAt: Date.now() });
            }}
            onPair={pairIds.length === 2 ? openPair : undefined}
            onBack={goHome}
          />
        )}
        {view === "pair" && pair && <PairPanel pair={pair} stage={pairStage} onReveal={() => setPairStage("future")} onBack={goHome} />}

        <details className="px-5 pb-6 pt-8 text-xs text-neutral-400">
          <summary className="cursor-pointer">出典：PLATEAU・東京都 区部点群・NEDO・国土地理院・Claude</summary>
          <p className="mt-1 leading-relaxed">
            建物・都市計画：国土交通省 Project PLATEAU（東京都練馬区 2025年度）。屋根・影：東京都デジタルツイン実現プロジェクト 区部点群データ。日射量：NEDO
            年間時別日射量データベース（METPV-11）東京。住所検索・背景地図：国土地理院。AI：Claude（Anthropic）。
          </p>
        </details>
      </aside>
    </main>
  );
}

function LayersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1 15 5 8 9 1 5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M1 8l7 4 7-4M1 11l7 4 7-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function Legend({ forecast, city, volumes }: { forecast: boolean; city: boolean; volumes: boolean }) {
  if (!forecast && !city && !volumes) return null;
  return (
    <div className="absolute bottom-3 left-3 space-y-1 rounded-lg bg-white/95 px-3 py-2 text-xs text-neutral-800 shadow">
      {forecast && (
        <>
          <p className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-[#1e2733]" />
            気をつけたい家
          </p>
          <p className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-[#b7c0ca]" />
            心配なし
          </p>
        </>
      )}
      {(city || volumes) && (
        <p className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 shrink-0 rounded-sm border-2 border-[#e8590c] bg-[#e8590c]/45" />
          建ちうる建物
        </p>
      )}
    </div>
  );
}

// 補足は、押したときだけ出す
function More({ children, label = "くわしく" }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="text-xs text-neutral-500">
      <summary className="cursor-pointer select-none text-neutral-500">{label}</summary>
      <div className="mt-1 space-y-1 leading-relaxed">{children}</div>
    </details>
  );
}

function SearchBox({ onPick, compact }: { onPick: (p: Place) => void; compact?: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await searchAddress(q.trim());
      if (r.length === 1) {
        onPick(r[0]);
        setResults(null);
      } else setResults(r);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={`flex overflow-hidden rounded-lg border border-neutral-300 bg-white ${compact ? "shadow" : ""}`}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="練馬区の住所（例：北町五丁目）"
          className={`min-w-0 flex-1 px-3 text-[#1e2733] outline-none ${compact ? "py-2 text-sm" : "py-3 text-base"}`}
          aria-label="練馬区の住所"
        />
        <button type="submit" disabled={busy} className="bg-[#1e2733] px-4 text-sm font-bold text-white disabled:opacity-50">
          {busy ? "…" : "探す"}
        </button>
      </form>
      {results && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-neutral-200 bg-white text-sm text-[#1e2733] shadow-lg">
          {results.length === 0 && <li className="px-3 py-2 text-neutral-500">見つかりませんでした</li>}
          {results.map((r) => (
            <li key={`${r.title}${r.lon}`}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-neutral-100"
                onClick={() => {
                  onPick(r);
                  setResults(null);
                }}
              >
                {r.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="block text-left text-sm text-[#1e2733] underline underline-offset-2">
      {children}
    </button>
  );
}

function HomePanel({ onPick, onExample }: { onPick: (p: Place) => void; onExample: () => void }) {
  return (
    <div className="space-y-6 p-5">
      <div>
        <h1 className="text-2xl font-bold">屋根の20年予報</h1>
        <p className="mt-1 text-base text-neutral-600">その太陽光、20年後も得ですか？</p>
      </div>
      <p className="text-sm text-neutral-700">南隣に建ちうる建物まで計算して、あなたの屋根の20年を予報します。</p>
      <SearchBox onPick={onPick} />
      <button type="button" onClick={onExample} className="text-xs text-neutral-500 underline underline-offset-2">
        住所を入れずに、例の家で試す
      </button>
    </div>
  );
}

function FoundPanel({ place, onBack }: { place: Place; onBack: () => void }) {
  return (
    <div className="space-y-4 p-5">
      <BackLink onBack={onBack} />
      <h2 className="text-lg font-bold">{place.title}</h2>
      <p className="rounded-lg bg-[#f6f3ec] p-4 text-sm text-neutral-800">青い目印の近くの、<b>あなたの家をクリック</b></p>
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="text-sm text-neutral-500 hover:text-[#1e2733]">
      ← 戻る
    </button>
  );
}

const DEFAULT_PROFILE = { monthlyBillYen: 12000, daytimePresence: "sometimes" as const, evPlan: false, householdSize: 3 };

type HouseModel = {
  gmlId: string;
  kind: "detailed" | "simple";
  address: string;
  storeys?: number | null;
  height?: number | null;
  zone?: string | null;
  kw: number;
  kwhNow: number;
  kwhFuture: number;
  kwhWithoutShade?: number;
  planes?: Diagnosis["roof"]["planes"];
  volumes: NearVolume[];
};

function toModel(s: Selection, simple: SimpleDiagnosis | null): HouseModel | null {
  const d = s.diagnosis;
  if (d)
    return {
      gmlId: d.gmlId,
      kind: "detailed",
      address: d.address,
      storeys: d.storeys,
      height: d.height,
      zone: d.zone,
      kw: d.now.kw,
      kwhNow: d.now.kwh,
      kwhFuture: d.future.kwh,
      kwhWithoutShade: d.now.kwhWithoutShade,
      planes: d.roof.planes,
      volumes: s.volumes,
    };
  if (!s.info?.gmlId || !simple || !simple.kw || !simple.kwhNow || !simple.kwhFuture) return null;
  return {
    gmlId: s.info.gmlId,
    kind: "simple",
    address: s.info.address ?? "東京都練馬区",
    storeys: s.info.storeys,
    height: s.info.height,
    zone: s.info.zone,
    kw: simple.kw,
    kwhNow: simple.kwhNow,
    kwhFuture: simple.kwhFuture,
    volumes: s.volumes,
  };
}

function Stat({ label, value, sub, warn }: { label: string; value: React.ReactNode; sub?: React.ReactNode; warn?: boolean }) {
  return (
    <div>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`text-xl font-bold ${warn ? "text-[#1e2733]" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-neutral-500">{sub}</p>}
    </div>
  );
}

function HousePanel(props: {
  s: Selection;
  simple: SimpleDiagnosis | null;
  hour: number;
  setHour: (h: number) => void;
  showFuture: boolean;
  setShowFuture: (v: boolean) => void;
  onBack: () => void;
}) {
  const { s, simple, hour, setHour, showFuture, setShowFuture, onBack } = props;
  const h = toModel(s, simple);
  if (!h) {
    const usage = s.info?.detailedUsage ?? s.info?.usage;
    return (
      <div className="space-y-4 p-5">
        <BackLink onBack={onBack} />
        <p className="text-sm text-neutral-700">
          {s.info && !simple ? (usage && usage !== "独立住宅" ? "戸建て（独立住宅）だけを予報しています" : "読み込んでいます…") : "戸建ての屋根をクリックしてください"}
        </p>
      </div>
    );
  }
  const pct = Math.round(((h.kwhFuture - h.kwhNow) / h.kwhNow) * 100);
  const watch = pct <= -10;
  const econ = calculateEconomics({ kw: h.kw, kwhNow: h.kwhNow, kwhFuture: h.kwhFuture, profile: DEFAULT_PROFILE });
  const man = (v: number) => `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v) / 10000)}万円`;
  const context: HouseContext | undefined =
    h.kind === "simple" ? { address: h.address, zone: h.zone ?? undefined, storeys: h.storeys ?? undefined, height: h.height ?? undefined, volumes: s.volumes } : undefined;
  const sections = [
    ["now", "今"],
    ["future", "20年後"],
    ["money", "お金"],
    ["quote", "見積もり"],
  ] as const;
  const jump = (id: string) => document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const mainPlanes = (h.planes ?? []).filter((p) => p.usable >= 2 && (p.tilt < 3 || (p.tilt < 60 && p.azimuth >= 90 && p.azimuth <= 270))).slice(0, 3);
  const time = `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;

  return (
    <div className="text-sm">
      <div className="space-y-3 p-5 pb-3">
        <BackLink onBack={onBack} />
        <p className="text-base font-bold">
          {h.address.replace("東京都", "")}
          <span className={`ml-2 rounded px-1.5 py-0.5 align-middle text-xs font-bold ${h.kind === "detailed" ? "bg-[#ece7dc] text-[#1e2733]" : "bg-neutral-100 text-neutral-600"}`}>
            {h.kind === "detailed" ? "詳しい診断" : "簡易診断"}
          </span>
        </p>

        {/* 20年予報（結論） */}
        <section className={`rounded-xl border-2 p-4 ${watch ? "border-[#1e2733] bg-[#f6f3ec]" : "border-[#e2dccf] bg-[#f6f3ec]"}`}>
          <p className="text-lg font-bold">{watch ? "将来の影に気をつけたい家" : "将来の影の心配はほとんどない"}</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Stat label="20年後の発電（最悪）" value={`${pct > 0 ? "+" : ""}${pct}%`} warn={watch} />
            <Stat label="20年の損得" value={`${man(econ.worst.net20Yen)}〜${man(econ.best.net20Yen)}`} />
          </div>
        </section>
      </div>

      {/* 目次 */}
      <nav className="sticky top-0 z-10 flex gap-1 border-y border-neutral-200 bg-white/95 px-4 py-2 backdrop-blur">
        {sections.map(([id, label]) => (
          <button key={id} type="button" onClick={() => jump(id)} className="rounded-full px-3 py-1 text-neutral-700 hover:bg-neutral-100">
            {label}
          </button>
        ))}
      </nav>

      <div className="space-y-8 p-5">
        <section id="sec-now" className="scroll-mt-14 space-y-2">
          <h2 className="font-bold">今</h2>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="発電（1年）" value={`${h.kwhNow.toLocaleString()} kWh`} />
            <Stat label="パネル" value={`${h.kw} kW`} />
          </div>
          <More>
            {h.kind === "detailed" ? (
              <>
                {h.kwhWithoutShade && <p>周りの建物と木の影で、今すでに {Math.round((1 - h.kwhNow / h.kwhWithoutShade) * 100)}% 減っています。</p>}
                <p>屋根の形は、東京都の航空レーザー点群から測りました。</p>
                {mainPlanes.map((p, i) => (
                  <p key={i}>
                    {p.tilt < 3 ? "平らな面" : `${azimuthLabel(p.azimuth)}向き・傾き${Math.round(p.tilt)}°`}：{p.usable} m²
                  </p>
                ))}
              </>
            ) : (
              <p>PLATEAUの建物の形と高さから計算した簡易診断です。屋根は真南・傾き25°と仮定し、木の影は含みません。</p>
            )}
          </More>
        </section>

        <section id="sec-future" className="scroll-mt-14 space-y-3">
          <h2 className="font-bold">20年後</h2>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="発電（1年・最悪）" value={`${h.kwhFuture.toLocaleString()} kWh`} sub={`${pct > 0 ? "+" : ""}${pct}%`} warn={watch} />
            <Stat label="南側に建ちうる建物" value={`${h.volumes.length}棟`} />
          </div>
          {h.volumes.length > 0 && (
            <table className="w-full text-left">
              <tbody>
                {h.volumes.slice(0, 5).map((v, i) => (
                  <tr key={i} className="border-t border-neutral-100">
                    <td className="py-1 text-neutral-500">
                      {azimuthLabel(v.bearing)} {Math.round(v.distance)}m
                    </td>
                    <td className="py-1 text-right">
                      {v.nowHeight}m → <b>{v.maxHeight}m</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showFuture} onChange={(e) => setShowFuture(e.target.checked)} />
            地図に表示
          </label>
          <label className="flex items-center gap-3">
            <span className="shrink-0 text-neutral-600">冬至の影 {time}</span>
            <input type="range" min={8} max={16} step={0.25} value={hour} onChange={(e) => setHour(Number(e.target.value))} className="flex-1" />
          </label>
          <More>
            <p>南側の建物が、ルールでいちばん高い姿に建て替わった場合です。実際にそこまで建つとは限りません。</p>
            {h.volumes.some((v) => v.reason) && h.volumes.slice(0, 5).map((v, i) => v.reason && <p key={i}>{azimuthLabel(v.bearing)} {Math.round(v.distance)}m：{v.reason}</p>)}
            <p>最大の高さは容積率・建ぺい率・用途地域・高度地区からの目安です（斜線制限・日影規制・前面道路の幅は含みません）。</p>
          </More>
        </section>

        <section id="sec-money" className="scroll-mt-14 space-y-3">
          <h2 className="font-bold">お金（20年）</h2>
          <AdvisorChat key={`advisor-${h.gmlId}`} gmlId={h.gmlId} kw={h.kw} kwhNow={h.kwhNow} kwhFuture={h.kwhFuture} context={context} />
        </section>

        <section id="sec-quote" className="scroll-mt-14 space-y-3">
          <h2 className="font-bold">見積もりを確かめる</h2>
          <QuoteCheck key={`quote-${h.gmlId}`} gmlId={h.gmlId} context={context} />
        </section>

        <More label="この予報について">
          <p>公開データから計算した目安です。屋根の傷みや実際の建築計画は分かりません。屋根は専門家に、近所の計画は区に確かめてください。</p>
        </More>
      </div>
    </div>
  );
}

function WardPanel(props: {
  forecast: ForecastMap | null;
  city: FutureCity | null;
  cityOn: boolean;
  onCity: (on: boolean) => void;
  onPair?: () => void;
  onBack: () => void;
}) {
  const { forecast, city, cityOn, onCity, onPair, onBack } = props;
  const risk = forecast ? forecast.risk.length / 3 : 0;
  return (
    <div className="space-y-5 p-5 text-sm">
      <BackLink onBack={onBack} />
      <h2 className="text-lg font-bold">練馬区全体の20年予報</h2>
      {forecast ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-[#1e2733] bg-[#f6f3ec] p-3">
            <Stat label="気をつけたい家" value={`${risk.toLocaleString()}軒`} sub={`${((risk / forecast.houses) * 100).toFixed(1)}%`} warn />
          </div>
          <div className="rounded-lg border border-[#e2dccf] bg-[#f6f3ec] p-3">
            <Stat label="心配なし" value={`${(forecast.houses - risk).toLocaleString()}軒`} sub={`戸建て ${forecast.houses.toLocaleString()}軒`} />
          </div>
        </div>
      ) : (
        <p className="text-neutral-500">読み込んでいます…</p>
      )}
      <button
        type="button"
        onClick={() => onCity(!cityOn)}
        className={`w-full rounded-lg px-3 py-2 font-bold ${cityOn ? "border border-neutral-300 text-neutral-800" : "bg-[#e8590c] text-white"}`}
      >
        {cityOn ? "今の街に戻す" : "20年後に建ちうる街を見る"}
      </button>
      {city && cityOn && (
        <Stat label="高くなりうる建物" value={<span className="text-[#d9480f]">{`${city.count.toLocaleString()}棟`}</span>} sub={`区内の${Math.round((city.count / city.candidates) * 100)}%`} />
      )}
      <More>
        <p>気をつけたい家＝南側がルール上の最大まで建て替わると、発電が1割以上減りうる家。</p>
        <p>全戸はPLATEAUの建物データだけの簡易診断。点群で詳しく診断した46軒と比べ、見分けは45軒で一致。</p>
      </More>
    </div>
  );
}

function perKw(kwh: number, kw: number) {
  return kw ? Math.round(kwh / kw) : 0;
}
function storeysText(st: number | null | undefined, h: number | null | undefined) {
  return `${st ? `${st}階建て・` : ""}${h ?? "?"}m`;
}

function PairPanel({ pair, stage, onReveal, onBack }: { pair: Diagnosis[]; stage: "now" | "future"; onReveal: () => void; onBack: () => void }) {
  const town = pair[0].address.replace("東京都練馬区", "練馬区");
  const [risky, safe] = [...pair].sort((a, b) => a.future.change - b.future.change);
  const rs = risky.southNeighbor;
  const ss = safe.southNeighbor;
  const floors = (h: number | null | undefined) => (h ? `${Math.round(h / 3)}階相当` : "");
  const maxText = (n: Diagnosis["southNeighbor"]) =>
    !n?.maxHeight ? "—" : n.nowHeight && n.maxHeight <= n.nowHeight + 1 ? `今と同じくらい（${floors(n.maxHeight)}）` : `${n.maxHeight}m（${floors(n.maxHeight)}）`;
  return (
    <div className="space-y-4 p-5 text-sm">
      <BackLink onBack={onBack} />
      <h2 className="text-lg font-bold">そっくりな2軒、得をするのはどっち？</h2>
      <p className="text-neutral-600">
        {town}・{Math.round(Math.hypot((pair[0].lon - pair[1].lon) * 90500, (pair[0].lat - pair[1].lat) * 110950))}m先・南隣はどちらも{rs?.storeys ?? 2}階建て
      </p>
      <table className="w-full text-left">
        <thead>
          <tr className="text-neutral-500">
            <th className="py-1"></th>
            {pair.map((d) => (
              <th key={d.gmlId} className="py-1 text-base text-[#1e2733]">
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
            <td className="py-2 text-neutral-500">パネル</td>
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
                {d.southNeighbor ? storeysText(d.southNeighbor.storeys, d.southNeighbor.nowHeight) : "—"}
              </td>
            ))}
          </tr>
          <tr className="border-t border-neutral-200">
            <td className="py-2 text-neutral-500">今の発電</td>
            {pair.map((d) => (
              <td key={d.gmlId} className="py-2 text-lg font-bold">
                {perKw(d.now.kwh, d.now.kw).toLocaleString()} kWh
              </td>
            ))}
          </tr>
          {stage === "future" && (
            <>
              <tr className="border-t border-[#e2dccf] bg-[#f6f3ec]">
                <td className="py-2 text-neutral-500">南隣の最大</td>
                {pair.map((d) => (
                  <td key={d.gmlId} className="py-2 font-bold">
                    {maxText(d.southNeighbor)}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-[#e2dccf] bg-[#f6f3ec]">
                <td className="py-2 text-neutral-500">20年後の発電</td>
                {pair.map((d) => (
                  <td key={d.gmlId} className={`py-2 text-lg font-bold ${d.future.change <= -0.1 ? "text-[#1e2733]" : ""}`}>
                    {perKw(d.future.kwh, d.now.kw).toLocaleString()} kWh
                    <span className="ml-1 text-sm">
                      （{d.future.change > 0 ? "+" : ""}
                      {Math.round(d.future.change * 100)}%）
                    </span>
                  </td>
                ))}
              </tr>
            </>
          )}
        </tbody>
      </table>
      {stage === "now" ? (
        <>
          <button type="button" onClick={onReveal} className="w-full rounded-lg bg-[#e8590c] px-4 py-3 text-base font-bold text-white shadow hover:bg-[#d9480f]">
            南側に、ルール上建ちうる建物を見る
          </button>
        </>
      ) : (
        <>
          <p className="font-bold">違いは南隣の土地のルール</p>
          <p className="text-xs text-neutral-500">発電は1kWあたり・1年</p>
          <More>
            <p>
              {risky.label}の南側：{rs?.zone}・容積率{rs?.floorAreaRate}%（{floors(rs?.maxHeight)}まで）。{safe.label}の南側：{ss?.zone}・容積率{ss?.floorAreaRate}%（{maxText(ss)}）。
            </p>
            <p>最大の高さは目安です（斜線制限・日影規制は含みません）。実際にそこまで建つとは限りません。</p>
          </More>
        </>
      )}
    </div>
  );
}
