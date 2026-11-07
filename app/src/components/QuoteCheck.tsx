"use client";

import { useState } from "react";
import Markdown from "./Markdown";

import type { HouseContext } from "./AdvisorChat";

type Props = { gmlId: string; context?: HouseContext };

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

// 公開版（Vercel）では、見積書の持ち込みを受け付けず、サンプルだけにする
const PUBLIC_DEMO = process.env.NEXT_PUBLIC_PUBLIC_DEMO === "1";

export default function QuoteCheck({ gmlId, context }: Props) {
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(blob: Blob | null, mediaType: string) {
    if (blob && !ACCEPTED.includes(mediaType)) {
      setError("画像（PNG・JPEG・WebP）かPDFを選んでください");
      return;
    }
    setBusy(true);
    setError(null);
    setReply(null);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(blob ? { gmlId, context, mediaType, fileBase64: await toBase64(blob) } : { gmlId, context, sample: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "エラーが起きました");
      setReply(data.reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-neutral-600">AIが見積書を読み、この家の屋根と比べます</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!PUBLIC_DEMO && (
        <label className="cursor-pointer rounded bg-[#1e2733] px-3 py-1.5 text-sm text-white">
          見積書を選ぶ
          <input
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) check(f, f.type);
              e.target.value = "";
            }}
          />
        </label>
        )}
        <button
          type="button"
          disabled={busy}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40"
          onClick={() => check(null, "image/png")}
        >
          サンプルで試す
        </button>
      </div>
      {PUBLIC_DEMO && (
        <p className="mt-2 text-xs text-neutral-500">公開版はサンプルのみ（個人情報を守るため）</p>
      )}
      {busy && <p className="mt-3 text-sm text-neutral-500">見積書を読んでいます…</p>}
      {error && <p className="mt-3 text-sm text-[#c92a2a]">{error}</p>}
      {reply && (
        <div className="mt-3 rounded-lg bg-neutral-50 p-3">
          <Markdown text={reply} />
        </div>
      )}
    </div>
  );
}
