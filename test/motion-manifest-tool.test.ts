import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scaffoldMotionManifest } from "../src/motion-manifest.js";

const census = () => JSON.parse(readFileSync(join(__dirname, "fixtures", "build-project", "census.json"), "utf8"));

const bands = (labels: string[] = ["#a", "#b", "body"]) => ({
  url: "https://example.test/native",
  title: "Native",
  totalHeight: 3000,
  bands: labels.map((label, index) => ({
    index,
    tag: label === "body" ? "body" : "section",
    label,
    background: "rgb(0, 0, 0)",
    offsetTop: index * 1000,
    height: 1000,
    textStart: "",
  })),
});

describe("scaffoldMotionManifest", () => {
  it("maps bands to sections and attributes the fixture census", () => {
    const result = scaffoldMotionManifest({ bands: bands(), scrollCensus: census() });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.measured).toBe(false);
    expect(result.note).toBe("Scaffold from measured census; author motion before shipping.");
    expect(result.manifest.measured).toBe(true);
    expect(result.manifest.sections.map((s) => s.id)).toEqual(["a", "b", "section-3"]);
    expect(result.manifest.sections[0]?.triggers.map((t) => t.selector)).toEqual(["#a .title"]);
    expect(result.manifest.sections[1]?.triggers.map((t) => t.selector)).toEqual(["#b .grid"]);
    // No markup in a band scaffold: DOM-only hints stay empty.
    expect(result.manifest.sections.every((s) => s.initialHidden.length === 0)).toBe(true);
    expect(result.manifest.pageTriggers.map((t) => t.selector)).toEqual(["#space"]);
    expect(result.manifest.pageAnimatedSelectors).toEqual(["#space"]);
  });

  it("honors explicit sections (label + selector) instead of band labels", () => {
    const result = scaffoldMotionManifest({
      bands: bands(),
      scrollCensus: census(),
      sections: [
        { label: "Hero", selector: "#a" },
        { label: "Work grid", selector: "#b" },
      ],
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.manifest.sections.map((s) => s.id)).toEqual(["a", "b"]);
    expect(result.manifest.sections[0]?.component).toBe("Section01");
    expect(result.manifest.sections[1]?.triggers.map((t) => t.selector)).toEqual(["#b .grid"]);
  });

  it("accepts a band label without id/class tokens and still numbers its section", () => {
    const result = scaffoldMotionManifest({
      bands: bands(["", ".plain"]),
      scrollCensus: census(),
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.manifest.sections).toHaveLength(2);
    expect(result.manifest.sections[0]?.id).toBe("section-1");
    expect(result.manifest.sections[1]?.id).toBe("plain");
  });

  it("returns { error } (never throws) on invalid input", () => {
    const cases: unknown[] = [
      null,
      "not json",
      {},
      { bands: {} },
      { bands: { bands: "nope" } },
      { bands: { bands: [] }, scrollCensus: census() },
      { bands: bands(), scrollCensus: { anims: [] } },
      { bands: bands(), scrollCensus: census(), sections: "nope" },
      { bands: bands(), scrollCensus: census(), sections: [{ label: "" }] },
    ];
    for (const input of cases) {
      expect(() => scaffoldMotionManifest(input)).not.toThrow();
      const result = scaffoldMotionManifest(input);
      expect("error" in result).toBe(true);
    }
  });
});
