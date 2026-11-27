import { readFileSync } from "node:fs";
const d = "A:/Recreations/pomegranate/evidence/";
const j = JSON.parse(readFileSync(d + "probe.json", "utf8"));
const fmt = (o) => o && JSON.stringify(o, null, 1);
console.log("=== header", fmt(j.header.styles));
console.log("=== phones", fmt(j.phones.styles));
console.log("=== footer", fmt(j.footer.styles));
for (const [i, f] of j.features.entries()) {
  console.log(`\n=== feature ${i} ${f.cls}`);
  console.log("  wrapper", JSON.stringify(f.styles));
  console.log("  tag    ", JSON.stringify(f.tag));
  console.log("  heading", JSON.stringify(f.heading));
  console.log("  text   ", JSON.stringify(f.text));
  console.log("  media  ", JSON.stringify(f.media));
  console.log("  card   ", JSON.stringify(f.card));
}
console.log("\n=== root style attr:", j.rootStyleAttr);
console.log("=== vars:", Object.entries(j.computedVars).map(([k, v]) => `${k}=${v}`).join("\n"));
