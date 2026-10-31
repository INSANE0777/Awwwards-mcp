// GitHub Actions output writer shared by the release scripts.
import { appendFileSync } from "node:fs";

export function emitOutputs(entries, outputPath = process.env.GITHUB_OUTPUT) {
  for (const [key, value] of entries) {
    if (typeof value !== "string" || /[\r\n]/.test(value)) {
      throw new Error(`invalid release output for ${key}`);
    }
  }
  const text = entries.map(([key, value]) => `${key}=${value}\n`).join("");
  if (outputPath) {
    appendFileSync(outputPath, text);
  } else {
    process.stdout.write(text);
  }
}
