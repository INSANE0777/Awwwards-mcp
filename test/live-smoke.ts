import { AwwwardsClient, RateLimiter } from "../src/awwwards.js";
import { parseListing, parseDetail, parseElementsGallery } from "../src/parsers.js";
import { captureMotionDna } from "../src/motion-dna.js";

const client = new AwwwardsClient({ rateLimiter: new RateLimiter(1200) });

const listing = parseListing(await client.getHtml("/websites/"));
console.log("listing sites parsed:", listing.length);
if (listing.length < 10) throw new Error("parseListing returned too few sites");

const first = listing[0];
const details = parseDetail(await client.getHtml(first.detailPath), first.slug);
console.log("detail:", first.slug, "palette:", details.palette, "awards:", details.awards);
if (details.palette.length === 0) throw new Error("parseDetail returned no palette");

const thumb = await client.getThumbnail(first.thumbnailPath, 880);
console.log("thumbnail bytes:", thumb.length);
if (thumb.length < 10_000) throw new Error("thumbnail suspiciously small");

const slugs = parseElementsGallery(await client.getHtml("/elements/"));
console.log("elements gallery slugs parsed:", slugs?.length);
if (!Array.isArray(slugs) || slugs.length < 20) throw new Error("parseElementsGallery returned too few slugs");

const dna = await captureMotionDna("https://gsap.com");
console.log("motion dna:", dna.stack.libs.join(","), "triggers:", dna.scroll.triggerCount);
if (!dna.stack.libs.includes("gsap")) throw new Error(`motion dna libs missing gsap: ${dna.stack.libs.join(",")}`);
if (dna.scroll.triggerCount <= 0) throw new Error(`motion dna triggerCount is ${dna.scroll.triggerCount}`);

console.log("LIVE SMOKE OK");
