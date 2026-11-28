import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("https://loopsii.com/", { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
const info = await page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: Math.round(b.x), y: Math.round(b.y + scrollY), w: Math.round(b.width), h: Math.round(b.height), fs: cs.fontSize, lh: cs.lineHeight, pad: cs.padding, bg: cs.backgroundColor };
  };
  return {
    hero: r(".hero"),
    heroTop: r(".hero_top"),
    h1: r(".h1"),
    heroBottom: r(".hero_bottom"),
    heroEl: r(".hero-el"),
    heroCell: r(".hero-el_cell"),
    introH2: r(".intro h2"),
    introLogo: r(".intro_logo"),
    introStage: r(".intro_stage"),
    distract: r(".distraction"),
    distractTitle: r(".distraction .h2"),
    tag: r(".inner-tag"),
    appTitle: r(".app-demo_heading"),
    stackTitle: r(".stack_title"),
    stackGrid: r(".stack_grid"),
    hlTitle: r(".highlights_title"),
    hlCard: r(".highlights_card"),
    hlText: r(".highlights_text"),
    hlMedia: r(".highlights_media"),
    folders: r(".folders_card"),
    folderTile: r(".folders_tile"),
    featuresAside: r(".features_aside"),
    featureCard: r(".features_card"),
    featureIcon: r(".features_icon"),
    testiCard: r(".testimonials_card"),
    testiStage: r(".testimonials_stage"),
    pricingSheet: r(".pricing_sheet"),
    pricingPanel: r(".pricing_panel"),
    pricingCta: r(".pricing_cta"),
    roadmapCard: r(".roadmap_card"),
    roadmapTop: r(".roadmap_top"),
    waitlistCard: r(".waitlist .flex-1"),
    clock: r(".clock"),
    faqItem: r(".faq_item"),
    outro: r(".outro_title"),
    footerCard: r(".footer-card") || r("[data-footer-trigger] > div"),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
