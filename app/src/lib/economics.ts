// 太陽光の損得（20年）を計算する。AI は使わず、すべて決まった式で計算する。
// 数値は目安。画面とAIの説明には、前提と出典を必ず添える。

export const ASSUMPTIONS = {
  costPerKwYen: 326_000, // 既築住宅の設置費用 1kWあたり（調達価格等算定委員会 2024年設置の平均）
  tokyoSubsidy: { smallKwLimit: 3.75, smallPerKwYen: 150_000, smallCapYen: 450_000, largePerKwYen: 120_000 }, // 東京都 既存住宅（令和8年度、要確認）
  buyPriceYen: { low: 31, mid: 35, high: 40 }, // 買う電気 1kWhあたり（東京電力 従量電灯B 第2段階＋再エネ賦課金などからの目安）
  sellPriceYen: [
    { fromYear: 1, toYear: 4, yen: 24 }, // 初期投資支援スキーム（2025年10月以降の認定）
    { fromYear: 5, toYear: 10, yen: 8.3 },
    { fromYear: 11, toYear: 20, yen: 10 }, // 調達期間終了後の売電価格の想定値（調達価格等算定委員会 2026年2月）
  ],
  degradationPerYear: 0.005, // パネルの劣化（年0.5%、仮定）
  // パワーコンディショナ：20年間で一度交換、38.4万円程度（調達価格等算定委員会 2026年2月、5kW想定）。交換する年は仮定
  inverterReplaceYear: 15,
  inverterReplaceYen: 384_000,
  // 東京都のパワーコンディショナ更新の助成：経費の2分の1、1台あたり上限10万円（令和8年度）
  inverterSubsidy: { rate: 0.5, capYen: 100_000 },
  // 定期点検：3〜5年ごとに1回、約3.8万円（同上）。「きびしい場合」だけに入れる（実際には点検していない家も多いため）
  inspectionEveryYears: 4,
  inspectionYen: 38_000,
  years: 20,
} as const;

export const ASSUMPTION_SOURCES = [
  "設置費用：経済産業省 調達価格等算定委員会（住宅用 既築 2024年設置の平均 32.6万円/kW）",
  "東京都の補助：家庭における太陽光発電導入促進事業（既存住宅、3.75kW以下 15万円/kW・上限45万円、超過分12万円/kW。申請時点の要綱で要確認）",
  "練馬区の補助：年度ごとに予算・条件が変わるため計算に含めない",
  "電気の単価：東京電力エナジーパートナー 従量電灯B（第2段階 36.40円/kWh）と再エネ賦課金などからの目安 31〜40円",
  "売電単価：資源エネルギー庁 初期投資支援スキーム（1〜4年目 24円、5〜10年目 8.3円）。11年目以降 10円は調達価格等算定委員会「令和8年度以降の調達価格等に関する意見」（2026年2月）の想定値",
  "パワーコンディショナ：20年間で一度交換、38.4万円程度（同意見、5kW想定）から、東京都の更新助成（2分の1・上限10万円）を引いた28.4万円を15年目に計上。交換する年は仮定",
  "定期点検：3〜5年ごとに1回、約3.8万円（同意見）。きびしい場合だけ4年ごとに計上",
  "パネルの劣化 年0.5%は仮定",
];

export type DaytimePresence = "rarely" | "sometimes" | "mostly";

export type HouseholdProfile = {
  monthlyBillYen: number; // 月の電気代（平均）
  daytimePresence: DaytimePresence; // 平日の昼に家に人がいるか
  evPlan: boolean; // 電気自動車を家で充電する予定
  householdSize: number;
};

export type EconomicsInput = {
  kw: number;
  kwhNow: number; // 今の年間発電量
  kwhFuture: number; // 南側が最大まで建て替わったときの年間発電量
  profile: HouseholdProfile;
};

export type Scenario = {
  label: string;
  paybackYears: number | null; // 元が取れる年数（20年以内に取れなければ null）
  net20Yen: number; // 20年間の損得（プラスなら得）
};

export type EconomicsResult = {
  investmentYen: number;
  subsidyYen: number;
  netCostYen: number;
  annualUseKwh: number;
  selfUseRatio: number;
  best: Scenario; // 今の日当たりが続き、電気代が高めの場合
  worst: Scenario; // 1年目から南側が最大まで建ち、電気代が安めの場合
  assumptions: typeof ASSUMPTIONS;
  sources: string[];
};

export function tokyoSubsidy(kw: number): number {
  const s = ASSUMPTIONS.tokyoSubsidy;
  const small = Math.min(kw, s.smallKwLimit) * s.smallPerKwYen;
  const large = Math.max(0, kw - s.smallKwLimit) * s.largePerKwYen;
  return Math.round(Math.min(small, s.smallCapYen) + large);
}

// 月の電気代から年間の使用量を出す（1kWhあたり約35円で割る目安）
export function annualUseFromBill(monthlyBillYen: number): number {
  return Math.round((monthlyBillYen * 12) / ASSUMPTIONS.buyPriceYen.mid);
}

// 発電した電気のうち、家で使える割合（昼に人がいるほど高い。目安）
export function selfUseRatio(p: HouseholdProfile): number {
  const base = { rarely: 0.25, sometimes: 0.35, mostly: 0.45 }[p.daytimePresence];
  return Math.min(0.7, base + (p.evPlan ? 0.1 : 0));
}

function sellPrice(year: number): number {
  return ASSUMPTIONS.sellPriceYen.find((s) => year >= s.fromYear && year <= s.toYear)?.yen ?? 10;
}

// パワーコンディショナの交換で実際に払う額（東京都の助成を引く）
export function inverterNetYen(): number {
  const a = ASSUMPTIONS;
  return a.inverterReplaceYen - Math.min(a.inverterReplaceYen * a.inverterSubsidy.rate, a.inverterSubsidy.capYen);
}

function scenario(
  label: string,
  kwhYear1: number,
  input: EconomicsInput,
  buyYen: number,
  netCost: number,
  withInspection: boolean,
): Scenario {
  const useKwh = annualUseFromBill(input.profile.monthlyBillYen);
  const ratio = selfUseRatio(input.profile);
  let cumulative = -netCost;
  let payback: number | null = null;
  for (let y = 1; y <= ASSUMPTIONS.years; y++) {
    const gen = kwhYear1 * (1 - ASSUMPTIONS.degradationPerYear) ** (y - 1);
    const self = Math.min(gen * ratio, useKwh * 0.6); // 家で使えるのは使用量の6割まで
    const sold = gen - self;
    let benefit = self * buyYen + sold * sellPrice(y);
    if (y === ASSUMPTIONS.inverterReplaceYear) benefit -= inverterNetYen();
    if (withInspection && y % ASSUMPTIONS.inspectionEveryYears === 0) benefit -= ASSUMPTIONS.inspectionYen;
    const before = cumulative;
    cumulative += benefit;
    if (payback === null && before < 0 && cumulative >= 0) payback = Math.round((y - 1 + -before / benefit) * 10) / 10;
  }
  return { label, paybackYears: payback, net20Yen: Math.round(cumulative) };
}

export function calculateEconomics(input: EconomicsInput): EconomicsResult {
  const investment = Math.round(input.kw * ASSUMPTIONS.costPerKwYen);
  const subsidy = tokyoSubsidy(input.kw);
  const netCost = investment - subsidy;
  return {
    investmentYen: investment,
    subsidyYen: subsidy,
    netCostYen: netCost,
    annualUseKwh: annualUseFromBill(input.profile.monthlyBillYen),
    selfUseRatio: selfUseRatio(input.profile),
    best: scenario("今の日当たりが続き、電気代が高めの場合", input.kwhNow, input, ASSUMPTIONS.buyPriceYen.high, netCost, false),
    worst: scenario(
      "1年目から南側が最大まで建ち、電気代が安めで、定期点検もする場合",
      input.kwhFuture,
      input,
      ASSUMPTIONS.buyPriceYen.low,
      netCost,
      true,
    ),
    assumptions: ASSUMPTIONS,
    sources: ASSUMPTION_SOURCES,
  };
}
