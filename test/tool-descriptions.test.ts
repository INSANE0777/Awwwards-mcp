import { describe, expect, it } from "vitest";
import { createServer } from "../src/server-instance.js";

// TDQS scores tool definitions; descriptions are all an agent reads before
// choosing a tool. Assert the published metadata without exercising handlers.
// Built on first use, not at module load: with an ambient
// AWWWARDS_MCP_PROFILE=core the guard would drop every non-core tool. Both
// profile variables are cleared around creation and then restored.
let cached: ReturnType<typeof createServer> | undefined;
const getServer = (): ReturnType<typeof createServer> => {
  if (cached) return cached;
  const savedProfile = process.env.AWWWARDS_MCP_PROFILE;
  const savedLegacy = process.env.AWARDS_MCP_PROFILE;
  delete process.env.AWWWARDS_MCP_PROFILE;
  delete process.env.AWARDS_MCP_PROFILE;
  try {
    cached = createServer({ handlers: {} as any, version: "0.0.0-test" });
  } finally {
    if (savedProfile === undefined) delete process.env.AWWWARDS_MCP_PROFILE;
    else process.env.AWWWARDS_MCP_PROFILE = savedProfile;
    if (savedLegacy === undefined) delete process.env.AWARDS_MCP_PROFILE;
    else process.env.AWARDS_MCP_PROFILE = savedLegacy;
  }
  return cached;
};
const schemaFor = (name: string): any => (getServer() as any).toolInputSchemaJson(name);
const descriptionFor = (name: string): string =>
  (getServer() as any)._registeredTools[name].description;

describe("awards metadata", () => {
  it("describes the six create_design_brief-specific parameters", () => {
    const properties = schemaFor("create_design_brief").properties;
    const keywords: Record<string, string[]> = {
      slugs: ["slug"],
      goal: ["goal"],
      audience: ["audience"],
      constraints: ["constraint"],
      includeStructure: ["Playwright", "structure"],
      maxBands: ["Band"],
    };
    for (const [field, words] of Object.entries(keywords)) {
      const description: string = properties[field]?.description ?? "";
      expect(description, field).not.toBe("");
      expect(words.some((word) => description.includes(word)), field).toBe(true);
    }
  });

  it("describes the search_sites paging parameters", () => {
    const properties = schemaFor("search_sites").properties;
    expect(properties.count?.description).toContain("6");
    expect(properties.count?.description).toContain("12");
    expect(properties.page?.description).toMatch(/one-based/i);
    expect(properties.page?.description).toContain("upstream");
  });

  it("publishes the documented paging and limit defaults", () => {
    const expected: Array<[string, string, number]> = [
      ["search_sites", "count", 6],
      ["search_sites", "page", 1],
      ["search_elements", "limit", 8],
      ["search_motion", "limit", 20],
    ];
    for (const [tool, field, value] of expected) {
      expect(schemaFor(tool).properties[field]?.default, `${tool}.${field}`).toBe(value);
    }
  });

  it("describes the search_sites filters and stale fallback", () => {
    const description = descriptionFor("search_sites");
    expect(description).toContain("AND");
    expect(description).toContain("stale cached");
  });

  it("describes search_elements.limit and filter semantics", () => {
    expect(schemaFor("search_elements").properties.limit?.description).toContain("1-20");
    expect(schemaFor("search_elements").properties.limit?.description).toContain("8");
    expect(descriptionFor("search_elements")).toContain("category and stack combine as AND");
  });

  it("describes watch_site.action", () => {
    const description: string = schemaFor("watch_site").properties.action?.description ?? "";
    for (const action of ["add", "list", "remove"]) {
      expect(description, action).toContain(action);
    }
  });

  it("does not claim audience filters evidence", () => {
    const description = schemaFor("create_design_brief").properties.audience?.description ?? "";
    expect(description).not.toMatch(/filter/i);
  });

  it("advertises the create_design_brief output shape", () => {
    const description = descriptionFor("create_design_brief");
    expect(description).toContain("Markdown");
    expect(description).toContain("versioned JSON");
    expect(description).toContain("motion census");
  });
});

describe("audit metadata", () => {
  it("describes every verify_flow parameter", () => {
    const properties = schemaFor("verify_flow").properties;
    const keywords: Record<string, string[]> = {
      buildUrl: ["build"],
      referenceUrl: ["reference page"],
      steps: ["1-6"],
      viewport: ["1440x900", "390x844"],
      waitStrategy: ["load", "networkidle"],
    };
    for (const [field, words] of Object.entries(keywords)) {
      const description: string = properties[field]?.description ?? "";
      expect(description, field).not.toBe("");
      for (const word of words) expect(description, field).toContain(word);
    }
  });

  it("describes each nested verify_flow action branch", () => {
    // zod emits the discriminated union as oneOf branches inside steps.items.
    const branches: any[] = schemaFor("verify_flow").properties.steps.items.oneOf;
    const expected: Record<string, { action: string; field: string; words: string[] }> = {
      scroll: {
        action: "Scroll to an absolute window Y position",
        field: "y",
        words: ["not a relative delta"],
      },
      click: {
        action: "Click the element matching a CSS selector",
        field: "selector",
        words: ["CSS selector"],
      },
      wait: {
        action: "Wait for a fixed number of milliseconds",
        field: "ms",
        words: ["Wait time"],
      },
    };
    for (const [kind, { action, field, words }] of Object.entries(expected)) {
      const branch = branches.find((candidate) => candidate.properties.action?.const === kind);
      expect(branch, kind).toBeDefined();
      expect(branch.properties.action.description, kind).toBe(action);
      const description: string = branch.properties[field]?.description ?? "";
      for (const word of words) expect(description, field).toContain(word);
    }
  });

  it("names verify_build and build_project in the verify_flow description", () => {
    const description = descriptionFor("verify_flow");
    expect(description).toContain("No screenshots");
    expect(description.endsWith(
      " Use verify_build for a scored structure/motion comparison; build_project converts a local file into a project and never verifies. Needs the optional Playwright dependency.",
    )).toBe(true);
  });

  it("describes verify_build.waitStrategy", () => {
    const description: string =
      schemaFor("verify_build").properties.waitStrategy?.description ?? "";
    for (const word of ["'load'", "'networkidle'", "scroll-census"]) {
      expect(description).toContain(word);
    }
  });

  it("describes analyze_bundle.url", () => {
    const description: string = schemaFor("analyze_bundle").properties.url?.description ?? "";
    expect(description).toContain("script chunks");
  });
});

describe("capture metadata", () => {
  it("describes waitStrategy on the inline-enum censuses", () => {
    for (const name of ["analyze_scroll_map", "analyze_hover_census"]) {
      const description: string =
        schemaFor(name).properties.waitStrategy?.description ?? "";
      for (const word of ["'load'", "'networkidle'", "quiet"]) {
        expect(description, name).toContain(word);
      }
      expect(description, name).toContain("'networkidle' (default)");
    }
  });

  it("leaves waitStrategy optional on the capture and verify tools", () => {
    // `.optional()` and `.default()` both omit a field from JSON Schema
    // `required`, so also guard against an added default.
    for (const name of ["verify_build", "verify_flow", "analyze_scroll_map", "analyze_hover_census"]) {
      expect(schemaFor(name).required ?? [], name).not.toContain("waitStrategy");
      expect(schemaFor(name).properties.waitStrategy?.default, name).toBeUndefined();
    }
  });
});

describe("build metadata", () => {
  it("describes search_motion.limit", () => {
    const description: string = schemaFor("search_motion").properties.limit?.description ?? "";
    expect(description).toContain("1-50");
    expect(description).toContain("20");
  });
});
