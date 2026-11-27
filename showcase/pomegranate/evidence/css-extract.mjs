import { readFileSync, writeFileSync } from "node:fs";
const d = "A:/Recreations/pomegranate/evidence/";
const css = ["site.css", "ui-8f48893a.css", "header-31ef58cc.css", "menu-4425be58.css", "phones-3f42a49d.css", "footer-729e3c66.css", "pomegranate-logo-b4f056ee.css", "home-1bfae47c.css"]
  .map((f) => `\n/* ========== ${f} ========== */\n` + readFileSync(d + f, "utf8")).join("\n");

// split into top-level rules (naive but CSS here is minified/simple)
const rules = [];
let depth = 0, start = 0;
for (let i = 0; i < css.length; i++) {
  const ch = css[i];
  if (ch === "{") depth++;
  else if (ch === "}") { depth--; if (depth === 0) { rules.push(css.slice(start, i + 1)); start = i + 1; } }
}
writeFileSync(d + "css-rules.txt", rules.length + " top-level rules\n" + rules.map((r) => r.trim()).join("\n\n"));

const want = /^(\.part-header|\.part-menu|\.part-phones|\.part-footer|\.template-home|\.block-feature|\.ui-card|\.ui-tag|\.ui-button|\.ui-rive|\.ui-gradient|\.ui-image|:root|\.--|@layer)/;
const picked = rules.filter((r) => want.test(r.trim().replace(/^@layer\s+\w+\s*/, "")));
writeFileSync(d + "css-picked.txt", "rules picked: " + picked.length + "\n\n" + picked.join("\n\n"));
console.log("rules", rules.length, "picked", picked.length);
