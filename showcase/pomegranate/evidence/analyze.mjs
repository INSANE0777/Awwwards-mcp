// Static analysis of the captured pomegranate chunks -> readable notes in evidence/
import { readFileSync, writeFileSync } from "node:fs";

const d = "A:/Recreations/pomegranate/evidence/";
const read = (f) => readFileSync(d + f, "utf8");
const out = [];
const push = (...a) => out.push(...a);

const ui = read("ui-05acea74.js");
const site = read("site.js");
const home = read("home-9c42f712.js");

const uniq = (arr) => Array.from(new Set(arr));

push("## component names in ui chunk");
push(uniq(ui.match(/name:"[a-z0-9-]+"/g) || []).join("\n"));
push("\n## ui-* / part-* / block-* strings in ui chunk");
push(uniq(ui.match(/"(?:part|ui|template|block|feature)[a-z0-9_-]*"/g) || []).join("\n"));
push("\n## strings in ui chunk mentioning rive/card/block/feature");
for (const kw of ["rive", "Rive", "artboard", "stateMachine", "animateType", "ui-card", "block", "feature"]) {
  push(`\n### ${kw}`);
  let i = -1, n = 0;
  while ((i = ui.indexOf(kw, i + 1)) !== -1 && n < 6) {
    push("@" + i + " …" + ui.slice(Math.max(0, i - 160), i + 260).replace(/\n/g, " "));
    n++;
  }
}

push("\n\n## site.js: Rive occurrences (first 8 windows)");
{
  let i = -1, n = 0;
  while ((i = site.indexOf("Rive", i + 1)) !== -1 && n < 8) {
    push("@" + i + " …" + site.slice(Math.max(0, i - 300), i + 400).replace(/\n/g, " "));
    n++;
  }
}

push("\n\n## site.js: animateType");
{
  const i = site.indexOf("animateType");
  push(i === -1 ? "not found" : site.slice(Math.max(0, i - 500), i + 1500));
}

writeFileSync(d + "analysis.txt", out.join("\n"));
console.log("analysis.txt", out.join("\n").length);
