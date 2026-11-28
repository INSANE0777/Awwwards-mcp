import { chromium } from "playwright";
import fs from "node:fs";

const out = "A:/Recreations/loopsii/_shots/ref-mobile";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const p = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await p.goto("https://loopsii.com/", { waitUntil: "networkidle" });
await p.waitForTimeout(5000);
try { await p.getByRole("button", { name: "OK" }).click({ timeout: 2000 }); } catch {}
const h = await p.evaluate(() => document.documentElement.scrollHeight);
console.log("height", h);
for (const y of [0, 700, 1400, 2200, 3200, 5000, 8000, 11000, 14000, 17000, 20000, 23000, h - 844]) {
  if (y < 0 || y > h) continue;
  await p.evaluate((y) => scrollTo(0, y), y);
  await p.waitForTimeout(1000);
  await p.screenshot({ path: `${out}/rm-${String(y).padStart(6, "0")}.png` });
}
await browser.close();
