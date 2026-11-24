import { readFileSync, writeFileSync } from "node:fs";
const d = "A:/Recreations/pomegranate/evidence/";
const read = (f) => readFileSync(d + f, "utf8");
const out = [];
const P = (...a) => out.push(...a);

const site = read("site.js");
const ui = read("ui-05acea74.js");

function windows(src, needle, before, after, max) {
  const res = [];
  let i = -1, n = 0;
  while ((i = src.indexOf(needle, i + 1)) !== -1 && n < max) {
    res.push("── " + needle + " @" + i + "\n" + src.slice(Math.max(0, i - before), i + after));
    n++;
  }
  return res.join("\n\n");
}

P("=========== site.js: stateMachines");
P(windows(site, "stateMachines", 900, 900, 3));
P("\n=========== site.js: assets/rive");
P(windows(site, "assets/rive", 400, 400, 3));
P("\n=========== site.js: autoplay:");
P(windows(site, "autoplay:", 300, 500, 4));
P("\n=========== site.js: block-feature (non-large markup)");
const bf = site.indexOf("block-feature");
P(bf === -1 ? "none" : site.slice(bf - 100, bf + 2600));
P("\n=========== site.js: ui-card define");
P(windows(site, 'name:"ui-card"', 200, 1200, 1));
P("\n=========== site.js: ui-tag");
P(windows(site, 'name:"ui-tag"', 200, 900, 1));
P("\n=========== site.js: ui-button");
P(windows(site, 'name:"ui-button"', 200, 1200, 1));
P("\n=========== site.js: media component");
P(windows(site, 'name:"media"', 200, 1800, 1));

writeFileSync(d + "analysis2.txt", out.join("\n"));
console.log("wrote analysis2.txt", out.join("\n").length);
