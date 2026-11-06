import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

const client = new Anthropic(); // ANTHROPIC_API_KEY を .env.local から読む

export type ToolHandler = (input: unknown) => Promise<unknown> | unknown;

export type RunResult = {
  messages: Anthropic.Beta.BetaMessageParam[]; // 会話の全履歴（assistant の content はそのまま保つ）
  text: string; // 最後の返答の文章
  refused: boolean;
  toolOutputs: Record<string, unknown>; // ツールが返した値（画面で使う）
};

// ツールを呼びながら最後の返答まで進める（ツール呼び出しは最大 4 回）
export async function runWithTools(opts: {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
  handlers: Record<string, ToolHandler>;
  effort?: "low" | "medium" | "high";
}): Promise<RunResult> {
  const messages = [...opts.messages];
  const toolOutputs: Record<string, unknown> = {};

  for (let i = 0; i < 5; i++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: opts.system,
      messages,
      tools: opts.tools,
      output_config: { effort: opts.effort ?? "medium" },
      // 安全上の理由で断られたときは、サーバー側で別のモデルに引き継ぐ
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    // 思考のブロックも含めて、返答はそのまま履歴に残す
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      return { messages, text: "申し訳ありません。この内容にはお答えできませんでした。", refused: true, toolOutputs };
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return { messages, text, refused: false, toolOutputs };
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const handler = opts.handlers[use.name];
      try {
        if (!handler) throw new Error(`unknown tool: ${use.name}`);
        const out = await handler(use.input);
        toolOutputs[use.name] = out;
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: use.id, content: String(e), is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { messages, text: "計算に時間がかかりすぎました。もう一度お試しください。", refused: false, toolOutputs };
}
