import type Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { ASSUMPTIONS } from "@/lib/economics";
import { runWithTools } from "@/lib/server/claude";
import { isPublicDemo, takeAiQuota } from "@/lib/server/limits";
import { diagnosisSummary, loadDiagnosis } from "@/lib/server/houses";

export const runtime = "nodejs";

const SYSTEM = `あなたは「屋根の20年予報」のセカンドオピニオン役です。業者の太陽光パネルの見積もりを読み、この家の診断と比べて、中立の立場で妥当かを伝えます。売る側でも、業者を責める側でもありません。

進め方
- 見積もりの画像やPDFから、パネルの容量（kW）、税込みの合計金額、業者が示した年間の想定発電量（kWh）、メーカーと型番、補助金を差し引いた金額かどうかを読み取り、必ず record_quote を呼びます。読めない項目は null にします。推測で埋めてはいけません。
- 比べた結果は、record_quote が返した数字だけを使って説明します。
- 中学生でも分かる、やさしい日本語で、短く伝えます。「業者の想定発電量が、この家の計算より何%多いか」「1kWあたりの価格が、全国の平均と比べてどうか」「将来の影が考慮されていそうか」の3点を中心にします。
- 差が大きい場合は、業者に確認するとよい質問を2〜3個、具体的に挙げます。断定的に業者を非難せず、「確認しましょう」という言い方にします。
- 最後に、この比較は目安であり、現地調査の結果とは違う場合があることを一言添えます。

この家の診断（PLATEAU と東京都の航空レーザー点群から計算済み）
`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "record_quote",
    description: "見積もりから読み取った値を記録し、この家の診断と比べた結果を受け取る。見積もりを読んだら必ず呼ぶ。",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["system_kw", "total_price_yen", "claimed_annual_kwh", "maker_and_model", "subsidy_deducted"],
      properties: {
        system_kw: { type: ["number", "null"], description: "パネルの合計容量（kW）" },
        total_price_yen: { type: ["integer", "null"], description: "税込みの合計金額（円）" },
        claimed_annual_kwh: { type: ["number", "null"], description: "業者が示した年間の想定発電量（kWh）" },
        maker_and_model: { type: ["string", "null"], description: "パネルのメーカーと型番" },
        subsidy_deducted: { type: ["boolean", "null"], description: "合計金額が補助金を差し引いた後の金額か" },
      },
    },
  },
];

type Quote = {
  system_kw: number | null;
  total_price_yen: number | null;
  claimed_annual_kwh: number | null;
  maker_and_model: string | null;
  subsidy_deducted: boolean | null;
};

export async function POST(req: Request) {
  const body = (await req.json()) as { gmlId: string; sample?: boolean; fileBase64?: string; mediaType?: string };
  const diagnosis = await loadDiagnosis(body.gmlId);
  if (!diagnosis) return NextResponse.json({ error: "診断データが見つかりません" }, { status: 404 });
  // 公開版では、知らない人の書類（個人情報を含みうる）を受け取らず、サンプルの見積書だけを読む
  if (isPublicDemo() && !body.sample) return NextResponse.json({ error: "公開版では、サンプルの見積書だけを試せます" }, { status: 400 });
  const limited = takeAiQuota(req);
  if (limited) return NextResponse.json({ error: limited }, { status: 429 });
  let fileBase64 = body.fileBase64 ?? "";
  let mediaType = body.mediaType ?? "";
  if (body.sample) {
    const buf = await readFile(path.join(process.cwd(), "public", "samples", "sample_quote.png"));
    fileBase64 = buf.toString("base64");
    mediaType = "image/png";
  }
  if (!fileBase64 || fileBase64.length > 7_000_000) return NextResponse.json({ error: "ファイルがないか、大きすぎます（5MBまで）" }, { status: 400 });

  const fileBlock: Anthropic.Beta.BetaContentBlockParam =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }
      : {
          type: "image",
          source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: fileBase64 },
        };

  const result = await runWithTools({
    system: SYSTEM + diagnosisSummary(diagnosis),
    messages: [{ role: "user", content: [fileBlock, { type: "text", text: "この見積もりをチェックしてください。" }] }],
    tools: TOOLS,
    effort: "medium",
    handlers: {
      record_quote: (raw) => {
        const q = raw as Quote;
        // この家の計算と同じ条件（1kWあたりの年間発電量）で比べる
        const ourPerKw = diagnosis.now.kw ? diagnosis.now.kwh / diagnosis.now.kw : null;
        const ourKwhForQuote = q.system_kw && ourPerKw ? Math.round(q.system_kw * ourPerKw) : null;
        const futurePerKw = diagnosis.now.kw ? diagnosis.future.kwh / diagnosis.now.kw : null;
        return {
          quote: q,
          this_house: {
            kwh_per_kw_now: ourPerKw && Math.round(ourPerKw),
            kwh_per_kw_future: futurePerKw && Math.round(futurePerKw),
            expected_kwh_for_quoted_kw_now: ourKwhForQuote,
            expected_kwh_for_quoted_kw_future: q.system_kw && futurePerKw ? Math.round(q.system_kw * futurePerKw) : null,
            max_kw_on_this_roof: diagnosis.now.kw,
          },
          claimed_vs_ours_pct:
            q.claimed_annual_kwh && ourKwhForQuote ? Math.round((q.claimed_annual_kwh / ourKwhForQuote - 1) * 100) : null,
          price_per_kw_yen: q.total_price_yen && q.system_kw ? Math.round(q.total_price_yen / q.system_kw) : null,
          national_average_price_per_kw_yen: ASSUMPTIONS.costPerKwYen,
          note: "全国平均は調達価格等算定委員会の既築住宅 2024年設置の平均（税・工事費込みの目安）。",
        };
      },
    },
  });

  return NextResponse.json({ reply: result.text, comparison: result.toolOutputs["record_quote"] ?? null });
}
