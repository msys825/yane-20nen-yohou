import "server-only";

// 公開版で AI の使いすぎを防ぐための、回数の上限（1日あたり）
// サーバーのメモリで数える簡易版。Vercel では複数の実行環境に分かれることがあるので、厳密な上限ではない。
// 本当の上限は、Anthropic の管理画面で設定する月の利用料の上限（Spend limit）で守る。
const PER_IP = Number(process.env.AI_DAILY_LIMIT_PER_IP ?? 10);
const TOTAL = Number(process.env.AI_DAILY_LIMIT_TOTAL ?? 300);

let day = "";
let total = 0;
const perIp = new Map<string, number>();

export function isPublicDemo(): boolean {
  return process.env.PUBLIC_DEMO === "1";
}

// 使えるなら null、上限なら利用者に見せる文を返す
export function takeAiQuota(req: Request): string | null {
  if (!isPublicDemo()) return null; // 手元の開発では数えない
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    total = 0;
    perIp.clear();
  }
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const used = perIp.get(ip) ?? 0;
  if (used >= PER_IP) return `AIへの質問は1日${PER_IP}回までです。明日またお試しください。`;
  if (total >= TOTAL) return "今日はAIへの質問が多く、上限に達しました。明日またお試しください。";
  perIp.set(ip, used + 1);
  total += 1;
  return null;
}
