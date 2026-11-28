// Live-page probe: root CSS variables, section geometry, HTML, canvas info, asset URLs.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const DIR = "A:/Recreations/pomegranate/evidence/";
mkdirSync(DIR + "sections", { recursive: true });
mkdirSync(DIR + "shots", { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const requests = new Set();
page.on("response", (r) => { const u = r.url(); if (u.startsWith("https://pomegranate.health")) requests.add(u); });

await page.goto("https://pomegranate.health/", { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(4000);
// scroll the whole page so lazy bits mount
for (let y = 0; y < 7500; y += 600) {
  await page.evaluate((py) => window.scrollTo(0, py), y);
  await page.waitForTimeout(220);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2500);

const data = await page.evaluate(() => {
  const rootStyle = getComputedStyle(document.documentElement);
  const vars = {};
  for (const sheet of document.styleSheets) {
    let rules = [];
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) scanRule(r);
  }
  function scanRule(r) {
    if (r.style) for (const p of r.style) if (p.startsWith("--")) vars[p] = String(r.style.getPropertyValue(p)).trim();
    if (r.cssRules) for (const c of r.cssRules) scanRule(c);
  }
  // live computed values override sheet defaults
  const computedVars = {};
  for (let i = 0; i < rootStyle.length; i++) {
    const p = rootStyle[i];
    if (p.startsWith("--")) computedVars[p] = rootStyle.getPropertyValue(p).trim();
  }
  const pick = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(), cls: el.className && el.className.toString(),
      rect: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      font: `${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`,
      letterSpacing: cs.letterSpacing, color: cs.color, bg: cs.backgroundColor,
      padding: cs.padding, margin: cs.margin, gap: cs.gap, radius: cs.borderRadius,
      shadow: cs.boxShadow, border: cs.border, maxWidth: cs.maxWidth, display: cs.display,
      grid: cs.gridTemplateColumns, transform: cs.transform, opacity: cs.opacity,
    };
  };
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));

  const sections = qa(".template-home > *").map((el) => ({
    tag: el.tagName.toLowerCase(), cls: el.className && el.className.toString(), styles: pick(el),
  }));

  const features = qa(".block-feature").map((el) => ({
    cls: el.className, styles: pick(el),
    tag: pick(el.querySelector(".ui-tag")), heading: pick(el.querySelector("h1,h2")), text: pick(el.querySelector("p")),
    media: pick(el.querySelector(".block-feature_media")), canvas: pick(el.querySelector("canvas")),
    card: pick(el.querySelector(".ui-card")),
    innerHTML: el.outerHTML.length,
  }));

  const canvases = qa("canvas").map((c) => {
    const r = c.getBoundingClientRect();
    return { w: c.width, h: c.height, css: { w: Math.round(r.width), h: Math.round(r.height) }, parent: c.parentElement.className };
  });

  return {
    rootStyleAttr: document.documentElement.getAttribute("style"),
    bodyClass: document.body.className,
    sheetVars: vars, computedVars, sections, features, canvases,
    canvasCount: qa("canvas").length,
    header: { styles: pick(q(".part-header")), html: q(".part-header")?.outerHTML },
    hero: { html: q(".template-home")?.outerHTML.slice(0, 0) || null },
    phones: { styles: pick(q(".part-phones")), html: q(".part-phones")?.outerHTML },
    footer: { styles: pick(q(".part-footer")), html: q(".part-footer")?.outerHTML },
    featureHTML: qa(".block-feature").map((e) => e.outerHTML),
    tagHTML: qa(".ui-tag").map((e) => e.outerHTML),
    heroCardHTML: q(".ui-card_gradient")?.parentElement?.outerHTML,
    docHeight: document.documentElement.scrollHeight,
  };
});

writeFileSync(DIR + "probe.json", JSON.stringify(data, null, 2));
writeFileSync(DIR + "assets-urls.txt", Array.from(requests).sort().join("\n"));

// per-section screenshots at 1440
const sectionHandles = await page.$$(".template-home > *");
let i = 0;
for (const h of sectionHandles) {
  const box = await h.boundingBox();
  if (box && box.height > 10) {
    await h.screenshot({ path: `${DIR}shots/sec-${String(i).padStart(2, "0")}.png` }).catch(() => {});
  }
  i++;
}
await page.screenshot({ path: DIR + "shots/hero-1440.png" });
await browser.close();
console.log("probe done, sections:", sectionHandles.length);
