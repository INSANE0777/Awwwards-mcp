import { chromium } from "playwright";
import fs from "node:fs";

const out = "A:/Recreations/loopsii/_shots/build";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("requestfailed", (r) => errors.push("404/fail: " + r.url()));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForFunction(() => document.body.classList.contains("is-loaded"), { timeout: 15000 });
await page.waitForTimeout(500);
const height = await page.evaluate(() => document.documentElement.scrollHeight);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
console.log("height", height, "overflow", overflow, "errors", errors.slice(0, 20));
let n = 0;
for (let y = 0; y < height; y += 850) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/b-${String(n).padStart(2, "0")}-${y}.png` });
  n++;
}
console.log("frames", n);
await browser.close();
