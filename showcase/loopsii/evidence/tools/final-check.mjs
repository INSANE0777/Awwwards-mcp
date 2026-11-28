import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
const results = {};
for (const [tag, w, h] of [["desktop", 1440, 900], ["mobile", 390, 844], ["tablet", 768, 1024], ["wide", 1728, 1080]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: tag === "mobile", hasTouch: tag === "mobile" });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.classList.contains("is-loaded"), { timeout: 15000 });
  await page.waitForTimeout(500);
  try { await page.getByRole("button", { name: "OK" }).click({ timeout: 1200 }); } catch {}
  results[tag] = {
    height: await page.evaluate(() => document.documentElement.scrollHeight),
    overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    errors: errors.slice(0, 6),
    font: await page.evaluate(() => getComputedStyle(document.body).fontFamily),
    heroBg: await page.evaluate(() => getComputedStyle(document.querySelector(".distract-photo")).backgroundImage),
  };
  if (tag === "desktop") {
    await page.screenshot({ path: "A:/Recreations/loopsii/evidence/build/final-desktop-hero.png" });
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href^="https://app.loopsii.com"]')].every((a) => a.target === "_blank" && a.rel.includes("noopener")));
    results[tag].externalLinksOk = links;
  }
  if (tag === "mobile") {
    await page.evaluate(() => scrollTo(0, 3000));
    await page.waitForTimeout(800);
    await page.screenshot({ path: "A:/Recreations/loopsii/evidence/build/final-mobile-dashboard.png" });
  }
  await page.close();
}
console.log(JSON.stringify(results, null, 1));
await browser.close();
