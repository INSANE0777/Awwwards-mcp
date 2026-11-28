import { readFileSync, writeFileSync } from "node:fs";
const d = "A:/Recreations/pomegranate/evidence/";
const files = { site: readFileSync(d + "site.js", "utf8"), ui: readFileSync(d + "ui-05acea74.js", "utf8"), phones: readFileSync(d + "phones-de22cf24.js", "utf8"), footer: readFileSync(d + "footer-d5065cc1.js", "utf8") };
const out = [];
const wrap = (s, n = 160) => { let o = ""; for (let i = 0; i < s.length; i += n) o += s.slice(i, i + n) + "\n"; return o; };

for (const [name, src] of Object.entries(files)) {
  out.push(`\n\n################ ${name} (${src.length})`);
  for (const kw of ["extention", "riv", "Rive", "artboard", "layout:", "fit:", "StateMachine", "stateMachines"]) {
    let i = -1, n = 0;
    while ((i = src.indexOf(kw, i + 1)) !== -1 && n < 3) {
      out.push(`\n===== ${name} · ${kw} @${i}`);
      out.push(src.slice(Math.max(0, i - 500), i + 1100));
      n++;
    }
  }
}
writeFileSync(d + "usage-scan.txt", wrap(out.join("\n"), 150));
console.log("ok");
