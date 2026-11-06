// 候補の2軒（tools/pair_visuals.py の出力）を、アプリの3D地図で「今」と「将来」の2枚ずつ撮る（見比べて選ぶため）
// 使い方: playwright を入れたフォルダで `node shoot_pairs.js <候補JSON> <出力フォルダ>`（アプリを localhost:3000 で起動しておく）
const { chromium } = require("playwright");
const fs = require("fs");
const [, , IN, OUT] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const pairs = JSON.parse(fs.readFileSync(IN, "utf8"));

(async () => {
  const browser = await chromium.launch({ headless: false, args: ["--use-angle=metal", "--enable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto("http://localhost:3000");
  await page.waitForFunction(() => window.__viewer && window.__viewer.entities.values.length > 50, null, { timeout: 60000 });
  // 診断データの点（目印）は消して、候補だけを描く
  await page.evaluate(() => {
    window.__viewer.entities.removeAll();
    window.__viewer.clock.currentTime = window.Cesium.JulianDate.fromIso8601("2026-12-21T03:00:00Z"); // 冬至の正午
  });
  for (const p of pairs) {
    await page.evaluate((p) => {
      const v = window.__viewer, C = window.Cesium;
      v.entities.removeAll();
      for (const h of p.houses) {
        const top = h.baseHeight + h.height + 0.3;
        v.entities.add({
          polyline: { positions: C.Cartesian3.fromDegreesArrayHeights([...h.footprint, h.footprint[0]].flatMap(([a, b]) => [a, b, top])), width: 4, material: C.Color.fromCssColorString("#1c7ed6") },
        });
        v.entities.add({
          position: C.Cartesian3.fromDegrees(h.lon, h.lat, top + 2),
          label: { text: h.label, font: "bold 18px sans-serif", fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -14), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        });
      }
      const lon = p.houses.reduce((s, h) => s + h.lon, 0) / 2, lat = p.houses.reduce((s, h) => s + h.lat, 0) / 2;
      const span = Math.max(...p.houses.map((h) => Math.hypot((h.lon - lon) * 111320 * Math.cos((lat * Math.PI) / 180), (h.lat - lat) * 110950)));
      const back = Math.max(70, span * 2.2), pitch = -48;
      v.camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat - back / 110950, p.houses[0].baseHeight + back * Math.tan((-pitch * Math.PI) / 180)), orientation: { heading: 0, pitch: C.Math.toRadians(pitch), roll: 0 } });
    }, p);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${OUT}/${String(p.id).padStart(2, "0")}_now.png` });
    await page.evaluate((p) => {
      const v = window.__viewer, C = window.Cesium;
      for (const x of p.volumes) {
        v.entities.add({
          polygon: { hierarchy: C.Cartesian3.fromDegreesArray(x.footprint.flat()), height: x.baseHeight, extrudedHeight: x.baseHeight + x.maxHeight, material: C.Color.fromCssColorString("#e8590c").withAlpha(0.45), outline: true, outlineColor: C.Color.fromCssColorString("#e8590c"), shadows: C.ShadowMode.ENABLED },
        });
      }
    }, p);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${String(p.id).padStart(2, "0")}_future.png` });
    console.log(p.id, p.addr, p.summary);
  }
  await browser.close();
})();
