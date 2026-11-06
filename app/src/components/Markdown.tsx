import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly";

// AI の返答（見出し・太字・表・箇条書き）を表示する
// remark-cjk-friendly：「**「少し得」**です」のように、かっこの直後に日本語が続く太字も太字として扱う（標準の決まりでは「**」がそのまま見えてしまう）
export default function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed [&_h2]:mt-3 [&_h2]:font-bold [&_li]:ml-4 [&_ol]:list-decimal [&_strong]:font-bold [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-neutral-200 [&_td]:p-1.5 [&_th]:border [&_th]:border-neutral-200 [&_th]:bg-neutral-50 [&_th]:p-1.5 [&_ul]:list-disc">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{text}</ReactMarkdown>
    </div>
  );
}
