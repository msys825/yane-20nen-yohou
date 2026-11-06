"use client";

import { useState } from "react";
import Markdown from "./Markdown";

type Props = { gmlId: string };

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

// 公開版（Vercel）では、見積書の持ち込みを受け付けず、サンプルだけにする
const PUBLIC_DEMO = process.env.NEXT_PUBLIC_PUBLIC_DEMO === "1";

export default function QuoteCheck({ gmlId }: Props) {
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
        body: JSON.stringify(blob ? { gmlId, mediaType, fileBase64: await toBase64(blob) } : { gmlId, sample: true }),
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
    <section className="rounded-lg border border-neutral-200 p-4">
      <h2 className="font-bold">業者の見積もりを、この家の屋根と比べる</h2>
      <p className="mt-1 text-sm text-neutral-600">業者の見積書の写真かPDFを選ぶと、AIが読み取り、市場の相場ではなく、この家の屋根の形と将来の影の計算と比べて確認します。</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!PUBLIC_DEMO && (
        <label className="cursor-pointer rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
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
          サンプルの見積書で試す
        </button>
      </div>
      {PUBLIC_DEMO && (
        <p className="mt-2 text-xs text-neutral-500">公開版では、個人情報を守るため、架空のサンプルの見積書だけを試せます。</p>
      )}
      {busy && <p className="mt-3 text-sm text-neutral-500">見積書を読んでいます…（20〜40秒ほどかかります）</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {reply && (
        <div className="mt-3 rounded-lg bg-neutral-50 p-3">
          <Markdown text={reply} />
        </div>
      )}
    </section>
  );
}
