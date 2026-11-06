import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ホームフォルダにも package-lock.json があるため、このアプリを基準にする
  outputFileTracingRoot: path.join(__dirname),
  // 開発中の左下の表示を出さない（スライドや動画の撮影に写り込むため）
  devIndicators: false,
  // API（AI の相談・見積書）がサーバー側で読むファイルを、Vercel の実行環境に含める
  outputFileTracingIncludes: {
    "/api/advisor": ["./public/data/houses/**"],
    "/api/quote": ["./public/data/houses/**", "./public/samples/**"],
  },
};

export default nextConfig;
