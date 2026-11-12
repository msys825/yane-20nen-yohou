// AI の受け口を呼ぶ。失敗したときは、利用者にそのまま見せられる、やさしい日本語の文で Error を投げる
export const AI_UNAVAILABLE = "今はAIが使えません。少し待って、もう一度お試しください。";

export async function postAi<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error(AI_UNAVAILABLE); // 通信できなかった
  }
  // サーバーが JSON を返せなかったとき（中身が空のエラーなど）も、同じ案内にする
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) throw new Error(typeof data?.error === "string" ? data.error : AI_UNAVAILABLE);
  return data;
}
