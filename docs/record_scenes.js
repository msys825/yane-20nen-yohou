// 3分動画の場面ごとに、アプリの操作を自動で録画する（Playwright）
// 使い方: playwright を入れたフォルダで `node record_scenes.js <出力フォルダ> [場面の番号,…]`（アプリを localhost:3000 で起動しておく）
//   例：`node record_scenes.js ./scenes 4` で場面4だけ撮り直す
// 出力は場面ごとの WebM。編集ソフトでつなぎ、ナレーションを重ねて MP4 に書き出す。
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = process.argv[2] || "./scenes";
const ONLY = process.argv[3] ? process.argv[3].split(",").map(Number) : [0, 1, 2, 3, 4, 6];
fs.mkdirSync(OUT, { recursive: true });

const VIEW = { width: 1600, height: 900 };
const HOUSE46_LON = 139.634756;

async function newScene(browser, name) {
  const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: `${OUT}/${name}`, size: VIEW } });
  const page = await context.newPage();
  await page.goto("http://localhost:3000");
  await page.waitForFunction(() => window.__viewer && window.__viewer.entities.values.length > 50, null, { timeout: 60000 });
  await page.waitForTimeout(4000);
  return { context, page };
}

async function selectHouse46(page) {
  await page.evaluate(() => {
    const v = window.__viewer, C = window.Cesium;
    v.camera.setView({ destination: C.Cartesian3.fromDegrees(139.63476, 35.738, 500), orientation: { heading: 0, pitch: C.Math.toRadians(-45), roll: 0 } });
  });
  await page.waitForTimeout(2500);
  const p = await page.evaluate((lon) => {
    const v = window.__viewer, C = window.Cesium;
    const e = v.entities.values.find((e) => e.point && Math.abs(C.Cartographic.fromCartesian(e.position.getValue()).longitude * 180 / Math.PI - lon) < 1e-5);
    const w = C.SceneTransforms.worldToWindowCoordinates(v.scene, e.position.getValue());
    const r = v.canvas.getBoundingClientRect();
    return { x: w.x + r.left, y: w.y + r.top };
  }, HOUSE46_LON);
  await page.mouse.move(p.x - 200, p.y - 120);
  await page.mouse.move(p.x, p.y, { steps: 25 });
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(9000);
}

async function slideHour(page, from, to, seconds) {
  const steps = Math.round((to - from) / 0.25);
  for (let i = 0; i <= steps; i++) {
    await page.locator('input[type="range"]').fill(String(from + i * 0.25));
    await page.waitForTimeout((seconds * 1000) / steps);
  }
}

async function waitAi(page) {
  // まず「考えています／読んでいます」が出るのを待ち、それが消えるまで待つ（出る前に調べると、すぐ通過してしまう）
  await page.waitForFunction(() => document.body.innerText.includes("考えています") || document.body.innerText.includes("見積書を読んでいます"), null, { timeout: 15000 });
  await page.waitForFunction(() => !document.body.innerText.includes("考えています") && !document.body.innerText.includes("見積書を読んでいます"), null, { timeout: 240000 });
}

(async () => {
  const browser = await chromium.launch({ headless: false, args: ["--use-angle=metal", "--enable-gpu"] });

  // 場面0：建ちうる未来の街（練馬区全体がルール上の最大まで伸びる → 北町の新しい大通りへ近づく）
  if (ONLY.includes(0)) {
    const { context, page } = await newScene(browser, "00_city");
    await page.waitForTimeout(1500);
    const btn = page.getByRole("button", { name: "建ちうる未来の街を見る" });
    await btn.hover();
    await page.waitForTimeout(800);
    await btn.click();
    await page.waitForTimeout(11000); // カメラの移動 2秒 → 伸び始め → 伸びきって少し待つ
    await page.evaluate(() => {
      const v = window.__viewer, C = window.Cesium;
      v.camera.flyTo({ destination: C.Cartesian3.fromDegrees(139.6470, 35.7590, 260), orientation: { heading: C.Math.toRadians(35), pitch: C.Math.toRadians(-20), roll: 0 }, duration: 6 });
    });
    await page.waitForTimeout(11000);
    await context.close();
  }

  // 場面5：好きな家をクリック（大通り沿いの「気をつけたい家」→ 低層住宅地の「安心な家」。どちらも簡易診断）
  if (ONLY.includes(5)) {
    const { context, page } = await newScene(browser, "05_anyhouse");
    const clickHouse = async (lon, lat) => {
      await page.evaluate(([lon, lat]) => {
        const v = window.__viewer, C = window.Cesium;
        // 真上から見てクリックする（斜めだと手前の建物に隠れて、となりの家に当たることがある）
        v.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lon, lat, 240), orientation: { heading: 0, pitch: C.Math.toRadians(-89), roll: 0 }, duration: 2 });
      }, [lon, lat]);
      await page.waitForTimeout(4500);
      const p = await page.evaluate(([lon, lat]) => {
        const v = window.__viewer, C = window.Cesium;
        const w = C.SceneTransforms.worldToWindowCoordinates(v.scene, C.Cartesian3.fromDegrees(lon, lat, 44));
        const r = v.canvas.getBoundingClientRect();
        return { x: w.x + r.left, y: w.y + r.top };
      }, [lon, lat]);
      await page.mouse.move(p.x - 150, p.y - 80);
      await page.mouse.move(p.x, p.y, { steps: 20 });
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(7000);
    };
    await clickHouse(139.65376784513063, 35.76570716840607); // 北町の大通り沿い（約40%減りうる）
    await clickHouse(139.6491544923092, 35.76724454591667); // 低層住宅地（変わらない）
    await context.close();
  }

  // 場面6：区全体の予報マップ（全戸建ての点）→ 北町の大通り沿いの「気をつけたい家」に寄って予報を見る
  if (ONLY.includes(6)) {
    const { context, page } = await newScene(browser, "06_forecast");
    await page.waitForTimeout(1000);
    const btn = page.getByRole("button", { name: "区全体の予報マップを見る" });
    await btn.hover();
    await page.waitForTimeout(800);
    await btn.click();
    await page.waitForTimeout(9000); // 区全体が見えるまで、そのまま見せる
    const lon = 139.65376784513063, lat = 35.76570716840607;
    await page.evaluate(([lon, lat]) => {
      const v = window.__viewer, C = window.Cesium;
      v.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lon, lat, 260), orientation: { heading: 0, pitch: C.Math.toRadians(-89), roll: 0 }, duration: 4 });
    }, [lon, lat]);
    await page.waitForTimeout(6500);
    const p = await page.evaluate(([lon, lat]) => {
      const v = window.__viewer, C = window.Cesium;
      const w = C.SceneTransforms.worldToWindowCoordinates(v.scene, C.Cartesian3.fromDegrees(lon, lat, 44));
      const r = v.canvas.getBoundingClientRect();
      return { x: w.x + r.left, y: w.y + r.top };
    }, [lon, lat]);
    await page.mouse.move(p.x - 150, p.y - 80);
    await page.mouse.move(p.x, p.y, { steps: 20 });
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(8000);
    await context.close();
  }

  // 場面1：そっくりな2軒（まずオレンジなしで「今はそっくり」→ ボタンで「ルール上建ちうる建物」が伸びる）
  if (ONLY.includes(1)) {
    const { context, page } = await newScene(browser, "01_pair");
    await page.getByRole("button", { name: "そっくりな2軒を比べる" }).hover();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "そっくりな2軒を比べる" }).click();
    await page.waitForTimeout(17500);
    const reveal = page.getByRole("button", { name: "南側に、ルール上建ちうる建物を見る" });
    await reveal.hover();
    await page.waitForTimeout(800);
    await reveal.click();
    await page.waitForTimeout(28000);
    await context.close();
  }

  // 場面2：家を選ぶ → 冬至の影を動かす
  if (ONLY.includes(2)) {
    const { context, page } = await newScene(browser, "02_house_and_shadow");
    await selectHouse46(page);
    await slideHour(page, 12, 9, 3);
    await slideHour(page, 9, 15, 10);
    await page.waitForTimeout(2000);
    await context.close();
  }

  // 場面3：AIとの損得の相談
  if (ONLY.includes(3)) {
    const { context, page } = await newScene(browser, "03_advisor");
    await selectHouse46(page);
    const chat = page.getByPlaceholder("例：月1万2千円くらい。昼は時々家にいます");
    await chat.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await chat.pressSequentially("月1万2千円くらいです。平日の昼は時々家にいます。電気自動車の予定はなく、3人家族です。", { delay: 60 });
    await chat.press("Enter");
    await waitAi(page);
    await page.locator("section", { hasText: "AIと一緒に、損得を考える" }).evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    await page.waitForTimeout(4000);
    await page.locator("aside").evaluate((el) => el.scrollBy({ top: 700, behavior: "smooth" }));
    await page.waitForTimeout(5000);
    await context.close();
  }

  // 場面4：セカンドオピニオン
  if (ONLY.includes(4)) {
    const { context, page } = await newScene(browser, "04_quote");
    await selectHouse46(page);
    const btn = page.getByRole("button", { name: "サンプルの見積書で試す" });
    await btn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await btn.click();
    await waitAi(page);
    await page.locator("section", { hasText: "セカンドオピニオン（見積もりのチェック）" }).evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    await page.waitForTimeout(4000);
    await page.locator("aside").evaluate((el) => el.scrollBy({ top: 700, behavior: "smooth" }));
    await page.waitForTimeout(5000);
    await context.close();
  }

  await browser.close();
})();
