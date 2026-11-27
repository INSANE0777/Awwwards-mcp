import { readFileSync, writeFileSync } from "node:fs";
const d = "A:/Recreations/pomegranate/evidence/";
const files = ["site.css", "ui-8f48893a.css", "header-31ef58cc.css", "menu-4425be58.css", "phones-3f42a49d.css", "footer-729e3c66.css", "pomegranate-logo-b4f056ee.css", "home-1bfae47c.css"];
let all = "";
for (const f of files) {
  const raw = readFileSync(d + f, "utf8");
  const pretty = raw
    .replace(/\{/g, " {\n  ")
    .replace(/;/g, ";\n  ")
    .replace(/\}/g, "\n}\n")
    .replace(/\n\s*\n/g, "\n");
  all += `\n/* ===================== ${f} ===================== */\n` + pretty;
  writeFileSync(d + "css/" + f.replace(".css", "") + ".pretty.css", pretty);
}
writeFileSync(d + "css/all.pretty.css", all);
console.log("bytes", all.length);
