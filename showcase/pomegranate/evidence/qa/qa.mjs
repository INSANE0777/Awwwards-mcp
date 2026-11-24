import { chromium } from 'file:///C:/nvm4w/nodejs/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.env.QA_URL || 'http://127.0.0.1:4173/';
const OUT = 'A:/Recreations/pomegranate/evidence/qa';
const report = { url: BASE, at: new Date().toISOString(), runs: {} };
const browser = await chromium.launch({ timeout: 60000 });

async function run(name, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [], failed = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 300)));
  page.on('requestfailed', r => failed.push('requestfailed ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);

  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 650) { await page.evaluate(yy => scrollTo(0, yy), y); await page.waitForTimeout(160); }
  await page.evaluate(hh => scrollTo(0, hh), h);
  await page.waitForTimeout(800);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(1500);

  const m = await page.evaluate(() => {
    const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y + scrollY), w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      docHeight: document.documentElement.scrollHeight,
      scrollW: document.documentElement.scrollWidth,
      innerW: innerWidth,
      overflow: document.documentElement.scrollWidth - innerWidth,
      header: r('header'),
      logo: r('.part-logo_link'),
      hero: r('.hero-card'),
      h1: r('h1'),
      heroH1Font: (() => { const e = document.querySelector('h1'); return e && getComputedStyle(e).font; })(),
      featureHeights: [...document.querySelectorAll('.block-feature')].map(e => Math.round(e.getBoundingClientRect().height)),
      footer: r('footer'),
      footerBar: r('.part-footer_bar'),
      canvases: [...document.querySelectorAll('.ui-rive canvas')].map(c => ({ css: Math.round(c.getBoundingClientRect().width) + 'x' + Math.round(c.getBoundingClientRect().height), bmp: c.width + 'x' + c.height })),
      ready: document.querySelectorAll('.ui-rive.is-ready').length,
      reveals: [...document.querySelectorAll('[data-reveal="text"]')].map(e => getComputedStyle(e).opacity),
      cta: (() => { const e = document.querySelector('.part-header_right .ui-button_content'); if (!e) return null; const cs = getComputedStyle(e); return { bg: cs.backgroundColor, color: cs.color, font: cs.fontSize }; })(),
    };
  });

  await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true, timeout: 120000 });
  for (const [sel, file] of [['.hero-card', 'hero'], ['.block-feature', 'f1'], ['.part-footer', 'footer']]) {
    const el = await page.$(sel);
    if (el) { await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(600); await el.screenshot({ path: `${OUT}/els/${name}-${file}.png` }).catch(() => {}); }
  }

  // menu
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.click('[data-menu-toggle]');
  await page.waitForTimeout(1200);
  const menu = await page.evaluate(() => {
    const m = document.querySelector('.part-menu');
    const s = document.querySelector('.part-menu_sheet');
    const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y + scrollY), w: Math.round(b.width), h: Math.round(b.height) }; };
    return { open: m && !m.hidden, sheet: r(s), links: document.querySelectorAll('.part-menu_link').length, icons: document.querySelectorAll('.part-menu_icon svg').length };
  });
  await page.screenshot({ path: `${OUT}/${name}-menu.png`, timeout: 60000 });

  report.runs[name] = { viewport, ...m, menu, errors, failed };
  await ctx.close();
}

await run('desktop-1440', { width: 1440, height: 900 });
await run('tablet-768', { width: 768, height: 900 });
await run('mobile-390', { width: 390, height: 844 });
await run('reduced-1440', { width: 1440, height: 900 }, { reduced: true });
await browser.close();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
for (const [k, v] of Object.entries(report.runs)) {
  console.log(k, 'doc', v.docHeight, 'overflow', v.overflow, 'errors', v.errors.length, 'failed', v.failed.length, 'ready', v.ready, 'menu', v.menu.open, v.menu.icons);
  if (v.errors.length) console.log('  ERR', v.errors.slice(0, 3));
  if (v.failed.length) console.log('  FAIL', v.failed.slice(0, 3));
}
