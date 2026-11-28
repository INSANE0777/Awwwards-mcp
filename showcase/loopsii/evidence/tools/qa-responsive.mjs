import { chromium } from "playwright";
import fs from "node:fs";

const out = "A:/Recreations/loopsii/evidence/qa";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const sizes = [
  { w: 390, h: 844, tag: "m" },
  { w: 768, h: 1024, tag: "t" },
  { w: 1024, h: 768, tag: "l" },
  { w: 1728, h: 1080, tag: "d" },
];
for (const { w, h, tag } of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console " + m.text()); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(r.status() + " " + r.url()); });
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.classList.contains("is-loaded"), { timeout: 15000 });
  await page.waitForTimeout(400);
  try { await page.getByRole("button", { name: "OK" }).click({ timeout: 1200 }); } catch {}
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  console.log(tag, "height", height, "overflow", ov, "errors", errors.length ? errors.slice(0, 5) : "none");
  const ys = tag === "m" ? [0, 900, 1800, 2800, 4000, 6000, 8000, 11000, 15000, 18000, 21000, 23000, height - h] : [0, 1400, 3000, 6000, 9000, 12000, 15000, 18000, 21000, height - h];
  for (const y of ys) {
    if (y < 0 || y > height) continue;
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${tag}-${String(y).padStart(6, "0")}.png` });
  }
  await page.close();
}
await browser.close();
