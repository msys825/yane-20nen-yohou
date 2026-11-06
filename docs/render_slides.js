// スライドの元ファイル（docs/slides/project/slides/*.html）を 1920×1080 の PNG にする（動画用）
// 画像は Slides の Artifact に登録したもの（/_blob/<id>）なので、docs/screenshots の同じ写真に差し替えて表示する
// 使い方: playwright を入れたフォルダで `node render_slides.js <docs のフォルダ> <出力フォルダ>`
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DOCS = process.argv[2];
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });

const BLOBS = {
  "/_blob/450bba9cd029705de3db8eda9c3ad814": "06_city_ward_crop.png",
  "/_blob/980244032970a52bd71212e9622c9841": "07_city_kitamachi_crop.png",
  "/_blob/d51bc93e12bc2cc596053d43c52bf12a": "08_pv_monthly.png",
  "/_blob/b7edef6f579a04f437764a1a6399bf5c": "09_pv_daily.png",
  "/_blob/d94e6fde0eec3257e22db0d3aef2a2c0": "01_pair.png", // 北町五丁目の2軒（2026-11-04 差し替え）
  "/_blob/3dffa561c60fc68825ae9dd91dc41845": "02_house46.png",
  "/_blob/bcea820ca94c8dbcfda6352539e07b84": "03_house46_9am.png",
  "/_blob/c2d25b7af7c4a7c1ee390252d836706d": "04_chat.png", // 定期点検を入れた損得（2026-11-05 差し替え）
  "/_blob/24cba6727d1eb6f05d27e06cf4018011": "05_quote.png",
};

(async () => {
  const deck = JSON.parse(fs.readFileSync(path.join(DOCS, "slides/project/deck.json"), "utf8"));
  const links = Object.values(deck.faces).map((f) => `<link rel="stylesheet" href="${f.href}">`).join("");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [i, id] of deck.order.entries()) {
    let html = fs.readFileSync(path.join(DOCS, `slides/project/slides/${id}.html`), "utf8");
    html = html.replace(/<aside>[\s\S]*?<\/aside>/, "");
    for (const [blob, file] of Object.entries(BLOBS)) {
      html = html.replaceAll(blob, "file://" + path.join(DOCS, "screenshots", file));
    }
    // セクションを 1920×1080 の箱として描く（スライドの既定：h1〜h3 の余白なし、box-sizing は border-box）
    const doc = `<!doctype html><html><head><meta charset="utf-8">${links}<style>
      *{margin:0;box-sizing:border-box} body{width:1920px;height:1080px;overflow:hidden}
      section{width:1920px;height:1080px;position:relative;overflow:hidden} ul,ol{padding-left:1.2em}
      table{border-collapse:collapse} th,td{border-bottom:2px solid #D8D1C2;padding:0.35em 0.6em} th{text-align:left}
    </style></head><body>${html}</body></html>`;
    const file = path.join(OUT, `slide_${id}.html`);
    fs.writeFileSync(file, doc);
    await page.goto("file://" + file);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${String(i + 1).padStart(2, "0")}_${id}.png`) });
  }
  await browser.close();
})();
