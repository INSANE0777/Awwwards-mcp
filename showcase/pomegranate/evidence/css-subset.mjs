// Pull only the CSS rules relevant to the rebuild out of the prettified dump.
import { readFileSync, writeFileSync } from "node:fs";
const d = "A:/Recreations/pomegranate/evidence/";
const css = readFileSync(d + "css/all.pretty.css", "utf8");

// Walk declarations blocks: selector { body } — track @media context by brace scanning.
const lines = css.split("\n");
const wanted = /(\.part-header|\.part-phones|\.part-footer|\.template-home|\.block-feature|\.ui-card|\.ui-tag|\.ui-rive|\.ui-gradient|\.ui-media|\.--ui-media|\.ui-scroll|\.part-menu|:root|html|body|\.--app-)/;
const out = [];
let mediaStack = [];
let buf = [];
let inBlock = false;

for (const line of lines) {
  const t = line.trim();
  if (t.startsWith("@media") || t.startsWith("@layer") || t.startsWith("@supports")) {
    if (t.startsWith("@media")) mediaStack.push(t);
    continue;
  }
  if (!inBlock && t.endsWith("{")) { inBlock = true; buf = [t.slice(0, -1)]; continue; }
  if (inBlock) {
    if (t === "}") {
      const sel = buf[0].trim();
      if (wanted.test(sel) || wanted.test(buf[0])) {
        out.push((mediaStack.length ? mediaStack.join(" ") + " " : "") + sel + " {\n" + buf.slice(1).map((l) => "  " + l).join("\n") + "\n}");
      }
      inBlock = false; buf = [];
    } else buf.push(t);
  }
}
// close media blocks when their closing brace appears (we ignored them) — mediaStack above is approximate
writeFileSync(d + "css/build-reference.css", out.join("\n\n"));
console.log("rules", out.length, "bytes", out.join("\n\n").length);
