// CesiumJS の実行に必要な静的ファイル（Workers など）を public/cesium にコピーする
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "cesium", "Build", "Cesium");
const dest = join(root, "public", "cesium");

if (!existsSync(src)) {
  console.error("cesium が見つかりません。npm install を先に実行してください。");
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const dir of ["Workers", "ThirdParty", "Assets", "Widgets"]) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
// 組み立て済みの Cesium.js（window.Cesium）も置き、バンドルせずに読み込む
cpSync(join(src, "Cesium.js"), join(dest, "Cesium.js"));
console.log("Cesium の静的ファイルを public/cesium にコピーしました");
