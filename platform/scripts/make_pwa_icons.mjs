// Renders the admin PWA icons from the ε mark (ink square, white Georgia ε: the same mark as the notification emails; Urbanist has no Greek glyphs) with
// local Chrome. Run from platform/: node scripts/make_pwa_icons.mjs. Outputs public/admin/icons/*.png (committed).
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = new URL("../public/admin/icons/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// size, file, radius (fraction of size), glyph scale. Maskable and apple-touch are full-bleed squares: the OS masks
// them, so the glyph stays inside the 80% safe zone.
const ICONS = [
  { size: 192, file: "icon-192.png", radius: 0.22, glyph: 0.9 },
  { size: 512, file: "icon-512.png", radius: 0.22, glyph: 0.9 },
  { size: 512, file: "maskable-512.png", radius: 0, glyph: 0.7 },
  { size: 180, file: "apple-touch-icon.png", radius: 0, glyph: 0.86 },
  { size: 96, file: "badge-96.png", radius: 0, glyph: 1.2, badge: true },
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  for (const i of ICONS) {
    await page.setViewport({ width: i.size, height: i.size, deviceScaleFactor: 1 });
    const bg = i.badge ? "transparent" : "#1B1A18";
    const fg = i.badge ? "#000000" : "#FFFFFF";
    await page.setContent(`<!doctype html><html><head>
<style>html,body{margin:0;background:transparent}
.m{width:${i.size}px;height:${i.size}px;border-radius:${i.radius * i.size}px;background:${bg};color:${fg};display:grid;place-items:center;
font-family:Georgia,"Times New Roman",serif;font-weight:500;font-size:${Math.round(i.size * i.glyph)}px;line-height:1}
.m span{transform:translateY(-4%)}</style></head><body><div class="m"><span>ε</span></div></body></html>`, { waitUntil: "load", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: OUT + i.file, omitBackground: true, clip: { x: 0, y: 0, width: i.size, height: i.size } });
    console.log("wrote", i.file);
  }
} finally {
  await browser.close();
}
