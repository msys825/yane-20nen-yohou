import type Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { calculateEconomics, type HouseholdProfile } from "@/lib/economics";
import { runWithTools } from "@/lib/server/claude";
import { takeAiQuota } from "@/lib/server/limits";
import { loadHouseForAi, type HouseContext } from "@/lib/server/houses";

export const runtime = "nodejs";

const SYSTEM = `あなたは「屋根の20年予報」の相談役です。家の持ち主が、屋根に太陽光パネルを付けて20年で得をするかを判断できるよう、中立の立場で手伝います。売る側ではありません。

役割
- 家族の暮らし方は、画面の選択肢ですでに入力され、損得はすでに計算されています（下の「計算結果」）。あなたの役割は、その結果を、この家族の言葉でやさしく説明し、続けての質問に答えることです。
- 中学生でも分かる、やさしい日本語で、短く話します。最初の説明は、箇条書き3〜4行・150字以内にまとめます（結論→理由→次に確かめること）。見出しと表は使いません。続けての質問への答えも200字以内にし、細かいことは聞かれてから答えます。
- 方角は「真南」「南東」「東」のように言葉で言い、「方位109°」のような数字は使いません。
- 説明の根拠は、下の「この家の診断」と「計算結果」です。南側のどの建物が、今の高さから最大何mまで建ちうるか、など具体的に触れます。
- 金額と年数を自分で作ったり、推測で計算したりしてはいけません。条件を変えた場合（電気自動車を買ったら、など）を聞かれたら、必ず calculate_economics を呼び、その値だけを使います。
- 計算の道具で扱えないこと（蓄電池、屋根の修理、ローンなど）は、計算していないことをはっきり言い、確かめるべき点を伝えます。
- 結果は「幅」で伝えます。「南が今のまま」と「南に建ったら」のどちらになるかは、誰にも分からないことを正直に伝えます。将来の影は「南側の建物がルール上の最大の高さまで建て替わった場合」の目安で、実際に建つとは限りません。
- 補助金や電気の単価などの前提は目安で、申請時点の公式の情報で確認が必要なことを、必要に応じて添えます。
- 特定の業者や商品を勧めません。最終的に決めるのは持ち主です。

この家の診断（計算済み。「診断の種類」が簡易診断なら、屋根の形は仮定であることを必要に応じて伝える）
`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "calculate_economics",
    description:
      "家族の暮らし方から、この家に太陽光パネルを付けたときの20年の損得（元が取れる年数、20年間の損得）を、「南が今のまま」と「南に建ったら」の2通りで計算する。画面の条件と違う場合（電気自動車を買ったら、など）を聞かれたときに呼ぶ。",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["monthly_bill_yen", "daytime_presence", "ev_plan", "household_size"],
      properties: {
        monthly_bill_yen: { type: "integer", description: "月の電気代の平均（円）" },
        daytime_presence: {
          type: "string",
          enum: ["rarely", "sometimes", "mostly"],
          description: "平日の昼に家に人がいるか。rarely=ほとんどいない、sometimes=時々いる、mostly=ほとんどいる",
        },
        ev_plan: { type: "boolean", description: "電気自動車を家で充電する予定があるか" },
        household_size: { type: "integer", description: "家族の人数" },
      },
    },
  },
];

const PRESENCE_JA = { rarely: "ほとんどいない", sometimes: "時々いる", mostly: "ほとんどいる" } as const;

export async function POST(req: Request) {
  const { gmlId, profile, messages, context } = (await req.json()) as {
    gmlId: string;
    profile: HouseholdProfile;
    messages: Anthropic.Beta.BetaMessageParam[];
    context?: HouseContext;
  };
  const house = await loadHouseForAi(gmlId, context);
  if (!house) return NextResponse.json({ error: "診断データが見つかりません" }, { status: 404 });
  if (!profile || !(profile.daytimePresence in PRESENCE_JA)) return NextResponse.json({ error: "暮らし方の条件がありません" }, { status: 400 });
  if (!Array.isArray(messages) || messages.length > 20) return NextResponse.json({ error: "会話が長すぎます。条件を選び直してください" }, { status: 400 });
  const limited = takeAiQuota(req);
  if (limited) return NextResponse.json({ error: limited }, { status: 429 });

  const calc = (p: HouseholdProfile) =>
    calculateEconomics({ kw: house.kw, kwhNow: house.kwhNow, kwhFuture: house.kwhFuture, profile: p });
  // 画面の条件での計算は、サーバー側でもう一度行う（画面から送られた数字は使わない）
  const base = calc(profile);
  const household = `
画面で選んだ暮らし方
- 月の電気代：${profile.monthlyBillYen}円／平日の昼：${PRESENCE_JA[profile.daytimePresence]}／電気自動車：${profile.evPlan ? "家で充電する予定あり" : "なし"}／家族：${profile.householdSize}人

計算結果（calculate_economics と同じ道具で計算済み）
${JSON.stringify({ 実際に払う額: base.netCostYen, 設置費用: base.investmentYen, 東京都の補助: base.subsidyYen, 南が今のまま: base.best, 南に建ったら: base.worst, 前提: base.sources })}
`;

  const result = await runWithTools({
    system: SYSTEM + house.summary + household,
    messages,
    tools: TOOLS,
    effort: "medium",
    handlers: {
      calculate_economics: (raw) => {
        const i = raw as { monthly_bill_yen: number; daytime_presence: HouseholdProfile["daytimePresence"]; ev_plan: boolean; household_size: number };
        return calc({
          monthlyBillYen: i.monthly_bill_yen,
          daytimePresence: i.daytime_presence,
          evPlan: i.ev_plan,
          householdSize: i.household_size,
        });
      },
    },
  });

  return NextResponse.json({ messages: result.messages, reply: result.text });
}
