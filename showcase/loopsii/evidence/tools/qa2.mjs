import { chromium } from "playwright";
import fs from "node:fs";

const out = "A:/Recreations/loopsii/_shots/build2";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("response", (r) => { if (r.status() >= 400) errors.push(r.status() + " " + r.url()); });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForFunction(() => document.body.classList.contains("is-loaded"), { timeout: 15000 });
await page.waitForTimeout(500);
try { await page.getByRole("button", { name: "OK" }).click({ timeout: 2000 }); } catch {}
await page.waitForTimeout(500);
const height = await page.evaluate(() => document.documentElement.scrollHeight);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
console.log("height", height, "overflow", overflow, "errors", errors.slice(0, 20));
const ys = [0, 900, 1700, 2550, 4250, 5100, 5950, 6800, 7650, 8500, 9350, 11050, 11900, 12750, 15300, 16150, 17000, 18700, 20400, 21250, 22100, 22950];
for (const y of ys) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/s-${String(y).padStart(5, "0")}.png` });
}
await browser.close();
