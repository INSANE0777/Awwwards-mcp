import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync("A:/Recreations/pomegranate/vendor/animejs/anime.iife.min.js", "utf8");
const fn = new Function(src + "\nreturn anime;");
const anime = fn();
const keys = Object.keys(anime).sort();
writeFileSync("A:/Recreations/pomegranate/evidence/anime-keys.txt", keys.join("\n"));
console.log(keys.join(","));
