import { chromium } from "playwright";
import fs from "node:fs";

const browser = await chromium.launch({ channel: "chrome" });
const out = {};

// desktop motion / geometry
{
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await p.waitForFunction(() => document.body.classList.contains("is-loaded"), { timeout: 15000 });

  out.title = {};
  for (const y of [4300, 4800, 5300]) {
    await p.evaluate((y) => scrollTo(0, y), y);
    await p.waitForTimeout(2000);
    out.title[y] = await p.evaluate(() => {
      const t = document.querySelector(".appdemo-title");
      const r = t.getBoundingClientRect();
      return { font: getComputedStyle(t).fontSize, top: Math.round(r.top), text: t.innerText };
    });
  }

  await p.evaluate(() => scrollTo(0, 6800));
  await p.waitForTimeout(2200);
  out.stack = await p.evaluate(() => {
    const q = (s) => document.querySelector(s)?.getBoundingClientRect().toJSON();
    return {
      top: Math.round(document.querySelector(".stack").getBoundingClientRect().top),
      gridTop: Math.round(document.querySelector(".stack-grid").getBoundingClientRect().top),
      linesIn: document.querySelectorAll(".stack-vline.is-in, .stack-hline.is-in").length,
      linesTotal: document.querySelectorAll(".stack-vline, .stack-hline").length,
      cardsIn: document.querySelectorAll(".stack-app.is-in").length,
      mark: q(".stack-mark"),
      ring: q(".loop-ring"),
      hub: document.querySelector(".hub-price").innerText.replace(/\s+/g, " "),
    };
  });

  await p.evaluate(() => scrollTo(0, 12700));
  await p.waitForTimeout(2200);
  const icon0 = await p.evaluate(() => {
    const g = document.querySelector('.feat-icon svg[data-icon="client-portal"] [data-l="Null 7"]');
    return { transform: g?.getAttribute("transform"), cardsIn: document.querySelectorAll(".feat-card.is-in").length };
  });
  await p.waitForTimeout(1000);
  const icon1 = await p.evaluate(() => {
    const g = document.querySelector('.feat-icon svg[data-icon="client-portal"] [data-l="Null 7"]');
    return { transform: g?.getAttribute("transform"), cardsIn: document.querySelectorAll(".feat-card.is-in").length };
  });
  out.features = { icon0, icon1, moved: icon0.transform !== icon1.transform };
  out.overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  out.errors = errors;
  await p.close();
}

// reduced motion
{
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await p.waitForTimeout(2200);
  out.reduced = await p.evaluate(() => ({
    motionClass: document.documentElement.className,
    cardsOpacity: getComputedStyle(document.querySelector(".feat-card")).opacity,
    cardTransform: getComputedStyle(document.querySelector(".feat-card")).transform,
    featureArt: document.querySelector('.feat-icon svg[data-icon="client-portal"] [data-l="Null 7"]')?.getAttribute("transform"),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  await p.close();
}

fs.writeFileSync("../qa/motion.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
