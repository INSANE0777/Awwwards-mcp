import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) errors.push(r.status() + " " + r.url()); });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForFunction(() => document.body.classList.contains("is-loaded"), { timeout: 15000 });
await page.waitForTimeout(500);

// testimonials
await page.evaluate(() => document.querySelector("#testimonials").scrollIntoView());
await page.waitForTimeout(600);
const before = await page.evaluate(() => document.querySelector("#testiNum").textContent);
await page.click('[data-dir="next"]');
await page.waitForTimeout(500);
const after = await page.evaluate(() => document.querySelector("#testiNum").textContent);

// pricing
await page.evaluate(() => document.querySelector("#pricing").scrollIntoView());
await page.waitForTimeout(400);
await page.click('[data-plan="yearly"]');
await page.waitForTimeout(400);
const yearly = await page.evaluate(() => ({
  cls: document.querySelector("#pricing").className,
  checked: document.querySelector("#priceSwitch").getAttribute("aria-checked"),
  visible: getComputedStyle(document.querySelector(".price-yearly")).opacity,
}));

// faq
await page.evaluate(() => document.querySelector("#faq").scrollIntoView());
await page.waitForTimeout(400);
await page.click(".faq-item:nth-child(3) .faq-q");
await page.waitForTimeout(500);
const faq = await page.evaluate(() => ({
  open: document.querySelector(".faq-item:nth-child(3)").className,
  expanded: document.querySelector(".faq-item:nth-child(3) .faq-q").getAttribute("aria-expanded"),
  first: document.querySelector(".faq-item:nth-child(1)").className,
}));

// cookies
await page.click("#cookieOk");
await page.waitForTimeout(300);
const cookieHidden = await page.evaluate(() => getComputedStyle(document.querySelector("#cookies")).opacity);

// footer video
await page.evaluate(() => document.querySelector("#footer").scrollIntoView());
await page.waitForTimeout(1500);
const video = await page.evaluate(() => ({ paused: document.querySelector(".footer-video").paused, t: document.querySelector(".footer-video").currentTime, err: document.querySelector(".footer-video").error?.code }));

console.log(JSON.stringify({ before, after, yearly, faq, cookieHidden, video, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
