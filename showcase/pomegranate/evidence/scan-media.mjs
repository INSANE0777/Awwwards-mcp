import { readFileSync, writeFileSync } from "node:fs";
const d = "A:/Recreations/pomegranate/evidence/";
const s = readFileSync(d + "site.js", "utf8");
const keys = ["delay:{type:Number", "media:{type:Object", "ui-media", "part-media", "Rive(", "new Rive", "riveInstance", "canvasRef", "onLoad:", "layout:new", "Layout(", "Fit."];
let o = "";
for (const k of keys) {
  let i = -1, c = 0;
  while ((i = s.indexOf(k, i + 1)) !== -1 && c < 3) {
    o += `\n\n### ${k} @${i}\n` + s.slice(Math.max(0, i - 1200), i + 1800);
    c++;
  }
}
writeFileSync(d + "app-media.txt", o);
console.log("bytes", o.length);
