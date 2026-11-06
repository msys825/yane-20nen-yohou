"use client";

import type Anthropic from "@anthropic-ai/sdk";
import { useMemo, useState } from "react";
import { calculateEconomics, type DaytimePresence, type EconomicsResult, type HouseholdProfile } from "@/lib/economics";
import Markdown from "./Markdown";

// 簡易診断の家では、住所や南側の建物などの補足を AI に渡す（詳しい診断の家はサーバーが自分で読む）
export type HouseContext = {
  address?: string;
  zone?: string;
  storeys?: number;
  height?: number;
  volumes?: { bearing: number; distance: number; nowHeight: number; maxHeight: number }[];
};

type Props = { gmlId: string; kw: number; kwhNow: number; kwhFuture: number; context?: HouseContext };

// 暮らし方は選択肢で入れる（AIの読み違いをなくし、その場で計算する）。AIは結果の説明と、続けての質問に答える
const PRESENCE: { v: DaytimePresence; label: string }[] = [
  { v: "rarely", label: "ほとんどいない" },
  { v: "sometimes", label: "時々いる" },
  { v: "mostly", label: "ほとんどいる" },
];
const QUICK_QUESTIONS = ["なぜ損になりうる？", "電気自動車を買ったら？", "付ける前に何を確かめる？"];

export { EconomicsCard };

export default function AdvisorChat({ gmlId, kw, kwhNow, kwhFuture, context }: Props) {
  const [profile, setProfile] = useState<HouseholdProfile>({
    monthlyBillYen: 12000,
    daytimePresence: "sometimes",
    evPlan: false,
    householdSize: 3,
  });
  const economics: EconomicsResult = useMemo(
    () => calculateEconomics({ kw, kwhNow, kwhFuture, profile }),
    [kw, kwhNow, kwhFuture, profile],
  );
  // API に送る履歴（assistant の content はサーバーから返ったまま保つ）。条件を変えたら会話は最初から
  const [history, setHistory] = useState<Anthropic.Beta.BetaMessageParam[]>([]);
  const [shown, setShown] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (p: Partial<HouseholdProfile>) => {
    setProfile((old) => ({ ...old, ...p }));
    setHistory([]);
    setShown([]);
  };

  async function ask(text: string, label?: string) {
    if (busy) return;
    setError(null);
    setShown((s) => [...s, { role: "user", text: label ?? text }]);
    setBusy(true);
    try {
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gmlId, profile, context, messages: [...history, { role: "user", content: text }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "エラーが起きました");
      setHistory(data.messages);
      setShown((s) => [...s, { role: "assistant", text: data.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-sm ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-800"}`;

  return (
    <div>
      
      <div className="mt-3 space-y-3 text-sm">
        <div>
          <p className="text-neutral-600">月の電気代</p>
          <div className="mt-1 flex items-center gap-3">
            <input
              type="range"
              min={5000}
              max={30000}
              step={1000}
              value={profile.monthlyBillYen}
              onChange={(e) => update({ monthlyBillYen: Number(e.target.value) })}
              className="flex-1"
              aria-label="月の電気代"
            />
            <span className="w-20 text-right font-bold">{profile.monthlyBillYen.toLocaleString()}円</span>
          </div>
        </div>
        <div>
          <p className="text-neutral-600">平日の昼、家に人は</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {PRESENCE.map((o) => (
              <button key={o.v} type="button" className={chip(profile.daytimePresence === o.v)} onClick={() => update({ daytimePresence: o.v })}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-neutral-600">電気自動車</p>
            <div className="mt-1 flex gap-2">
              {[false, true].map((v) => (
                <button key={String(v)} type="button" className={chip(profile.evPlan === v)} onClick={() => update({ evPlan: v })}>
                  {v ? "予定あり" : "なし"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-neutral-600">家族</p>
            <div className="mt-1 flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className={chip(profile.householdSize === n)} onClick={() => update({ householdSize: n })}>
                  {n === 5 ? "5+" : n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <EconomicsCard e={economics} />

      <div className="mt-4 border-t border-neutral-200 pt-3">
        {shown.length === 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => ask("この結果を、わが家の場合として、やさしく説明してください。", "この結果を説明して")}
            className="mt-2 w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            AIに説明してもらう
          </button>
        )}
        <div className="mt-3 space-y-3">
          {shown.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? "ml-8 rounded-lg bg-blue-50 p-3 text-sm" : "mr-2 rounded-lg bg-neutral-50 p-3"}
            >
              {m.role === "user" ? m.text : <Markdown text={m.text} />}
            </div>
          ))}
          {busy && <p className="text-sm text-neutral-500">考えています…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        {shown.length > 0 && (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_QUESTIONS.map((q) => (
                <button key={q} type="button" disabled={busy} onClick={() => ask(q)} className={`${chip(false)} disabled:opacity-40`}>
                  {q}
                </button>
              ))}
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const t = input.trim();
                if (t) {
                  setInput("");
                  ask(t);
                }
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="ほかに聞く"
                className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
                disabled={busy}
              />
              <button type="submit" disabled={busy} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
                聞く
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function yen(v: number) {
  return `${Math.round(v / 10000).toLocaleString()}万円`;
}

function EconomicsCard({ e }: { e: EconomicsResult }) {
  const rows = [
    ["よい場合", e.best],
    ["きびしい場合", e.worst],
  ] as const;
  return (
    <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">
      <table className="w-full text-left">
        <tbody>
          <tr>
            <td className="py-1 text-neutral-600">払う額</td>
            <td className="py-1 text-right font-bold" colSpan={2}>
              {yen(e.netCostYen)}
            </td>
          </tr>
          {rows.map(([label, s]) => (
            <tr key={label} className="border-t border-amber-200">
              <td className="py-1 text-neutral-600">{label}</td>
              <td className="py-1 text-right text-neutral-600">{s.paybackYears ? `${s.paybackYears}年で回収` : "回収できない"}</td>
              <td className={`py-1 pl-3 text-right whitespace-nowrap font-bold ${s.net20Yen >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {s.net20Yen >= 0 ? "+" : "−"}
                {yen(Math.abs(s.net20Yen))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="mt-1 text-xs text-neutral-600">
        <summary className="cursor-pointer">くわしく</summary>
        <p className="mt-1">
          設置 {yen(e.investmentYen)} − 東京都の補助 {yen(e.subsidyYen)}。よい場合：{e.best.label}。きびしい場合：{e.worst.label}。
        </p>
        <ul className="mt-1 list-disc pl-4">
          {e.sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
