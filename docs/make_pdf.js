// スライドの PNG（render_slides.js の出力）を、1枚1ページの PDF にまとめる（JPEG にして軽くする）
// 使い方: playwright を入れたフォルダで `node make_pdf.js <スライドPNGのフォルダ（render_slides.js の出力）> <出力PDF> [JPEGの画質 2〜31、小さいほど高画質]`
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const [, , IN, OUT, Q = "4"] = process.argv;
(async () => {
  const pngs = fs.readdirSync(IN).filter((f) => /^\d\d_.*\.png$/.test(f)).sort();
  const imgs = pngs.map((f) => {
    const jpg = path.join(IN, f.replace(".png", ".jpg"));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(IN, f), "-q:v", Q, jpg]);
    return "data:image/jpeg;base64," + fs.readFileSync(jpg).toString("base64");
  });
  const html = `<!doctype html><html><head><style>@page{size:1920px 1080px;margin:0}*{margin:0}body{margin:0}img{display:block;width:1920px;height:1080px;page-break-after:always}</style></head><body>${imgs.map((s) => `<img src="${s}">`).join("")}</body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({ path: OUT, width: "1920px", height: "1080px", printBackground: true });
  await browser.close();
  console.log(pngs.length, "slides");
})();
