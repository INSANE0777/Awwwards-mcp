import { chromium } from "playwright";
import fs from "node:fs";

const url = "https://loopsii.com/";
const out = "A:/Recreations/loopsii/_shots";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(5000);
try { await page.getByRole("button", { name: "OK" }).click({ timeout: 2000 }); } catch {}
await page.waitForTimeout(1000);

const height = await page.evaluate(() => document.documentElement.scrollHeight);
const secs = await page.evaluate(() =>
  [...document.querySelectorAll("main section, main header")].map((el, i) => ({
    i,
    cls: el.className,
    id: el.id,
    top: Math.round(el.getBoundingClientRect().top + scrollY),
    h: Math.round(el.getBoundingClientRect().height),
  }))
);
fs.writeFileSync(`${out}/sections.json`, JSON.stringify({ height, secs }, null, 2));
console.log(JSON.stringify(secs, null, 1));

const H = 900;
let n = 0;
for (let y = 0; y < height; y += 850) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${out}/live-${String(n).padStart(2, "0")}-${y}.png` });
  n++;
}
console.log("frames", n);
await browser.close();
