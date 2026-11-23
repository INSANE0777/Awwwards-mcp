import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoundedFile } from "../src/server/handlers/shortlist.js";

const dirs: string[] = [];
const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "awwwards-shortlist-bounded-"));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const png = (suffix = "x"): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(suffix),
  ]);

describe("readBoundedFile", () => {
  it("accepts a PNG strictly inside the allowed root", async () => {
    const root = await tempDir();
    const file = join(root, "valid.png");
    await writeFile(file, png("valid"));

    const bytes = await readBoundedFile(file, 100, root);

    expect(bytes).toEqual(png("valid"));
  });

  it("rejects a file outside the allowed root", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    const file = join(outside, "secret.png");
    await writeFile(file, png("secret"));

    await expect(readBoundedFile(file, 100, root)).resolves.toBeNull();
  });

  it("rejects a symlink pointing outside the allowed root", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    const secret = join(outside, "secret.png");
    const link = join(root, "link.png");
    await writeFile(secret, png("secret"));
    try {
      await symlink(secret, link, "file");
    } catch {
      return; // The platform does not allow this link; nothing to prove here.
    }

    await expect(readBoundedFile(link, 100, root)).resolves.toBeNull();
  });

  it("rejects a non-PNG inside the allowed root", async () => {
    const root = await tempDir();
    const file = join(root, "not-an-image.txt");
    await writeFile(file, "not a png");

    await expect(readBoundedFile(file, 100, root)).resolves.toBeNull();
  });

  it("rejects a file larger than the byte cap", async () => {
    const root = await tempDir();
    const file = join(root, "large.png");
    await writeFile(file, png("too-large"));

    await expect(readBoundedFile(file, 8, root)).resolves.toBeNull();
  });
});
