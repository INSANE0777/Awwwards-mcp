import { readFileSync, writeFileSync } from "node:fs";
const d = "A:/Recreations/pomegranate/evidence/";
const site = readFileSync(d + "site.js", "utf8");
const out = [];
const push = (...a) => out.push(...a);

for (const kw of ['extention==="riv"', "rive-js", "stateMachines", "artboard:", "wasm", "new Biome", "rive.js", "canvas-lite", "WebGL2", "rive.canvas"]) {
  push(`\n\n========== ${kw}`);
  let i = -1, n = 0;
  while ((i = site.indexOf(kw, i + 1)) !== -1 && n < 5) {
    push(`\n--- @${i} ---`);
    push(site.slice(Math.max(0, i - 900), i + 1200));
    n++;
  }
}
writeFileSync(d + "site-media.txt", out.join("\n"));
console.log("bytes", out.join("\n").length);
