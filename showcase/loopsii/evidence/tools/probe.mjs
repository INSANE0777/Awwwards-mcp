import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("https://loopsii.com/", { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
await page.evaluate(() => window.scrollTo(0, 7300));
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 80), x: Math.round(b.x), y: Math.round(b.y + scrollY), w: Math.round(b.width), h: Math.round(b.height) };
  };
  return {
    loopsii: r(".stack_app--loopsii"),
    stat: r(".stack_stat"),
    logins: r(".stack_stat + .stack_stat"),
    apps: [...document.querySelectorAll(".stack_app:not(.stack_app--loopsii)")].map((el) => {
      const b = el.getBoundingClientRect();
      return { text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 30), x: Math.round(b.x), y: Math.round(b.y + scrollY), w: Math.round(b.width), h: Math.round(b.height) };
    }),
    grid: r(".stack_grid"),
    sides: [...document.querySelectorAll(".stack_side")].map((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y + scrollY), w: Math.round(b.width), h: Math.round(b.height), text: el.textContent.trim() }; }),
    sync: r(".stack_sync"),
    loop: r(".stack_loop"),
    statText: document.querySelector(".stack_stat")?.innerText,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
