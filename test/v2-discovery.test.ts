import { describe, expect, it, vi } from "vitest";
import type { ToolResponse } from "../src/server.js";
import {
  browseAwardsInputSchema,
  browseAwardsRequestSchema,
  registerBrowseAwards,
  runBrowseAwards,
} from "../src/v2/browse-awards.js";
import {
  getIndexInputSchema,
  getIndexRequestSchema,
  registerGetIndex,
  runGetIndex,
} from "../src/v2/get-index.js";
import {
  getReferenceInputSchema,
  getReferenceRequestSchema,
  registerGetReference,
  runGetReference,
} from "../src/v2/get-reference.js";
import {
  registerSearchReferences,
  runSearchReferences,
  searchReferencesInputSchema,
  searchReferencesRequestSchema,
} from "../src/v2/search-references.js";

const okResponse: ToolResponse = { content: [{ type: "text", text: "ok" }] };

function fakeHandlers() {
  return {
    search_sites: vi.fn().mockResolvedValue(okResponse),
    search_elements: vi.fn().mockResolvedValue(okResponse),
    search_directory: vi.fn().mockResolvedValue(okResponse),
    search_motion: vi.fn().mockResolvedValue(okResponse),
    get_collections: vi.fn().mockResolvedValue(okResponse),
    get_site_details: vi.fn().mockResolvedValue(okResponse),
    get_site_elements: vi.fn().mockResolvedValue(okResponse),
    get_element: vi.fn().mockResolvedValue(okResponse),
    compare_sites: vi.fn().mockResolvedValue(okResponse),
    list_categories: vi.fn().mockResolvedValue(okResponse),
    get_annual_categories: vi.fn().mockResolvedValue(okResponse),
    get_annual_nominees: vi.fn().mockResolvedValue(okResponse),
    get_annual_nominee: vi.fn().mockResolvedValue(okResponse),
    get_index_status: vi.fn().mockResolvedValue(okResponse),
    get_index_stats: vi.fn().mockResolvedValue(okResponse),
  };
}

type FakeHandlers = ReturnType<typeof fakeHandlers>;

function expectOnly(handlers: FakeHandlers, selected: keyof FakeHandlers): void {
  for (const [name, handler] of Object.entries(handlers)) {
    if (name === selected) expect(handler).toHaveBeenCalledTimes(1);
    else expect(handler).not.toHaveBeenCalled();
  }
}

describe("searchReferencesRequestSchema", () => {
  it("parses each valid branch", () => {
    expect(searchReferencesRequestSchema.parse({ kind: "sites", query: "portfolio" })).toEqual({
      kind: "sites",
      query: "portfolio",
      sortBy: "newest",
      responseMode: "full",
      count: 6,
      page: 1,
    });

    expect(
      searchReferencesRequestSchema.parse({
        kind: "sites",
        color: "#404040",
        tags: ["3d", "portfolio"],
        technology: "webgl",
        award: "sotd",
        sortBy: "score",
        responseMode: "compact",
        count: 4,
        page: 2,
      }),
    ).toEqual({
      kind: "sites",
      color: "#404040",
      tags: ["3d", "portfolio"],
      technology: "webgl",
      award: "sotd",
      sortBy: "score",
      responseMode: "compact",
      count: 4,
      page: 2,
    });

    expect(
      searchReferencesRequestSchema.parse({
        kind: "elements",
        query: "menu",
        category: "menu",
        stack: ["gsap"],
        limit: 5,
      }),
    ).toEqual({
      kind: "elements",
      query: "menu",
      category: "menu",
      stack: ["gsap"],
      limit: 5,
    });

    expect(
      searchReferencesRequestSchema.parse({
        kind: "directory",
        query: "studio",
        country: "United States",
        category: "web-design",
        budget: "over_hundred_thousand",
        page: 3,
      }),
    ).toEqual({
      kind: "directory",
      query: "studio",
      country: "United States",
      category: "web-design",
      budget: "over_hundred_thousand",
      page: 3,
    });

    expect(searchReferencesRequestSchema.parse({ kind: "motion", lib: "gsap" })).toEqual({
      kind: "motion",
      lib: "gsap",
      scrubOnly: false,
      hasPins: false,
      limit: 20,
    });

    expect(searchReferencesRequestSchema.parse({ kind: "collections", page: 2 })).toEqual({
      kind: "collections",
      page: 2,
    });
  });

  it("rejects cross-branch fields on otherwise-valid branches", () => {
    const result = searchReferencesRequestSchema.safeParse({
      kind: "sites",
      query: "portfolio",
      lib: "gsap",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
    }
  });
});

describe("getReferenceRequestSchema", () => {
  it("parses each valid branch", () => {
    expect(
      getReferenceRequestSchema.parse({ kind: "site_details", slug: "l-i-s-a", compact: true }),
    ).toEqual({ kind: "site_details", slug: "l-i-s-a", compact: true });

    expect(
      getReferenceRequestSchema.parse({ kind: "site_details", slugs: ["l-i-s-a", "a-b"] }),
    ).toEqual({ kind: "site_details", slugs: ["l-i-s-a", "a-b"] });

    expect(getReferenceRequestSchema.parse({ kind: "site_elements", slug: "l-i-s-a" })).toEqual({
      kind: "site_elements",
      slug: "l-i-s-a",
    });

    expect(getReferenceRequestSchema.parse({ kind: "element", id: "hero-menu" })).toEqual({
      kind: "element",
      id: "hero-menu",
    });

    expect(
      getReferenceRequestSchema.parse({ kind: "comparison", slugs: ["l-i-s-a", "a-b"] }),
    ).toEqual({ kind: "comparison", slugs: ["l-i-s-a", "a-b"] });

    expect(getReferenceRequestSchema.parse({ kind: "collection", slug: "brutalism" })).toEqual({
      kind: "collection",
      slug: "brutalism",
      page: 1,
    });
  });

  it("requires exactly one of slug or slugs for site_details", () => {
    expect(
      getReferenceRequestSchema.safeParse({ kind: "site_details", slug: "a-b", slugs: ["c-d"] })
        .success,
    ).toBe(false);
    expect(getReferenceRequestSchema.safeParse({ kind: "site_details" }).success).toBe(false);
  });

  it("rejects cross-branch fields on otherwise-valid branches", () => {
    const result = getReferenceRequestSchema.safeParse({
      kind: "element",
      id: "hero-menu",
      slug: "l-i-s-a",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
    }
  });
});

describe("browseAwardsRequestSchema", () => {
  it("parses each valid branch", () => {
    expect(browseAwardsRequestSchema.parse({ kind: "filters" })).toEqual({ kind: "filters" });
    expect(browseAwardsRequestSchema.parse({ kind: "annual_categories" })).toEqual({
      kind: "annual_categories",
    });

    expect(
      browseAwardsRequestSchema.parse({
        kind: "annual_nominees",
        category: "site-of-the-year",
        limit: 5,
        offset: 10,
        hydrate: false,
      }),
    ).toEqual({
      kind: "annual_nominees",
      category: "site-of-the-year",
      limit: 5,
      offset: 10,
      hydrate: false,
    });

    expect(browseAwardsRequestSchema.parse({ kind: "annual_nominees", category: "agency" })).toEqual(
      {
        kind: "annual_nominees",
        category: "agency",
        limit: 10,
        offset: 0,
        hydrate: true,
      },
    );

    expect(
      browseAwardsRequestSchema.parse({ kind: "annual_nominee", id: "1234-uuid" }),
    ).toEqual({ kind: "annual_nominee", id: "1234-uuid" });

    expect(
      browseAwardsRequestSchema.parse({
        kind: "annual_nominee",
        category: "site-of-the-year",
        slug: "some-slug",
      }),
    ).toEqual({ kind: "annual_nominee", category: "site-of-the-year", slug: "some-slug" });
  });

  it("rejects cross-branch fields on otherwise-valid branches", () => {
    const result = browseAwardsRequestSchema.safeParse({
      kind: "filters",
      category: "site-of-the-year",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
    }
  });
});

describe("getIndexRequestSchema", () => {
  it("parses each valid branch", () => {
    expect(getIndexRequestSchema.parse({ kind: "status" })).toEqual({ kind: "status" });

    expect(getIndexRequestSchema.parse({ kind: "stats" })).toEqual({
      kind: "stats",
      windowDays: 90,
      top: 10,
    });

    expect(getIndexRequestSchema.parse({ kind: "stats", windowDays: 30, top: 5 })).toEqual({
      kind: "stats",
      windowDays: 30,
      top: 5,
    });
  });

  it("rejects cross-branch fields on otherwise-valid branches", () => {
    const result = getIndexRequestSchema.safeParse({ kind: "status", windowDays: 30 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
    }
  });
});

describe("input schemas reject array and all forms", () => {
  const cases = [
    ["search_references", searchReferencesInputSchema],
    ["get_reference", getReferenceInputSchema],
    ["browse_awards", browseAwardsInputSchema],
    ["get_index", getIndexInputSchema],
  ] as const;

  it.each(cases)("%s rejects an array of requests", (_name, schema) => {
    expect(schema.safeParse({ request: [{ kind: "all" }, { kind: "all" }] }).success).toBe(false);
  });

  it.each(cases)("%s rejects an all kind, a missing request and an extra top-level key", (
    _name,
    schema,
  ) => {
    expect(schema.safeParse({ request: { kind: "all" } }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ request: { kind: "all" }, extra: true }).success).toBe(false);
  });
});

describe("runSearchReferences", () => {
  it("dispatches sites with defaults and omits undefined optionals", async () => {
    const handlers = fakeHandlers();
    const request = searchReferencesRequestSchema.parse({ kind: "sites", query: "portfolio" });

    const result = await runSearchReferences(handlers as any, request);

    expectOnly(handlers, "search_sites");
    expect(handlers.search_sites).toHaveBeenCalledWith({
      query: "portfolio",
      sortBy: "newest",
      responseMode: "full",
      count: 6,
      page: 1,
    });
    expect(result).toBe(okResponse);
  });

  it("passes every sites option when present", async () => {
    const handlers = fakeHandlers();
    const request = searchReferencesRequestSchema.parse({
      kind: "sites",
      color: "#404040",
      tags: ["3d"],
      technology: "webgl",
      award: "sotd",
      sortBy: "score",
      responseMode: "compact",
      count: 3,
      page: 2,
    });

    await runSearchReferences(handlers as any, request);

    expect(handlers.search_sites).toHaveBeenCalledWith({
      color: "#404040",
      tags: ["3d"],
      technology: "webgl",
      award: "sotd",
      sortBy: "score",
      responseMode: "compact",
      count: 3,
      page: 2,
    });
  });

  it("dispatches elements with defaults", async () => {
    const handlers = fakeHandlers();
    const request = searchReferencesRequestSchema.parse({ kind: "elements" });

    const result = await runSearchReferences(handlers as any, request);

    expectOnly(handlers, "search_elements");
    expect(handlers.search_elements).toHaveBeenCalledWith({ limit: 8 });
    expect(result).toBe(okResponse);
  });

  it("passes every elements option when present", async () => {
    const handlers = fakeHandlers();
    const request = searchReferencesRequestSchema.parse({
      kind: "elements",
      query: "menu",
      category: "menu",
      stack: ["gsap", "webgl"],
      limit: 5,
    });

    await runSearchReferences(handlers as any, request);

    expect(handlers.search_elements).toHaveBeenCalledWith({
      query: "menu",
      category: "menu",
      stack: ["gsap", "webgl"],
      limit: 5,
    });
  });

  it("dispatches directory with defaults", async () => {
    const handlers = fakeHandlers();
    const request = searchReferencesRequestSchema.parse({ kind: "directory" });

    const result = await runSearchReferences(handlers as any, request);

    expectOnly(handlers, "search_directory");
    expect(handlers.search_directory).toHaveBeenCalledWith({ page: 1 });
    expect(result).toBe(okResponse);
  });

  it("passes every directory option when present", async () => {
    const handlers = fakeHandlers();
    const request = searchReferencesRequestSchema.parse({
      kind: "directory",
      query: "studio",
      country: "United States",
      category: "web-design",
      budget: "over_hundred_thousand",
      page: 3,
    });

    await runSearchReferences(handlers as any, request);

    expect(handlers.search_directory).toHaveBeenCalledWith({
      query: "studio",
      country: "United States",
      category: "web-design",
      budget: "over_hundred_thousand",
      page: 3,
    });
  });

  it("dispatches motion with defaults", async () => {
    const handlers = fakeHandlers();
    const request = searchReferencesRequestSchema.parse({ kind: "motion" });

    const result = await runSearchReferences(handlers as any, request);

    expectOnly(handlers, "search_motion");
    expect(handlers.search_motion).toHaveBeenCalledWith({
      scrubOnly: false,
      hasPins: false,
      limit: 20,
    });
    expect(result).toBe(okResponse);
  });

  it("passes every motion option when present", async () => {
    const handlers = fakeHandlers();
    const request = searchReferencesRequestSchema.parse({
      kind: "motion",
      lib: "gsap",
      scrubOnly: true,
      hasPins: true,
      limit: 10,
    });

    await runSearchReferences(handlers as any, request);

    expect(handlers.search_motion).toHaveBeenCalledWith({
      lib: "gsap",
      scrubOnly: true,
      hasPins: true,
      limit: 10,
    });
  });

  it("dispatches collections as a listing with the page", async () => {
    const handlers = fakeHandlers();
    const request = searchReferencesRequestSchema.parse({ kind: "collections", page: 2 });

    const result = await runSearchReferences(handlers as any, request);

    expectOnly(handlers, "get_collections");
    expect(handlers.get_collections).toHaveBeenCalledWith({ page: 2 });
    expect(result).toBe(okResponse);
  });
});

describe("runGetReference", () => {
  it("dispatches one site slug and omits undefined optionals", async () => {
    const handlers = fakeHandlers();
    const request = getReferenceRequestSchema.parse({ kind: "site_details", slug: "l-i-s-a" });

    const result = await runGetReference(handlers as any, request);

    expectOnly(handlers, "get_site_details");
    expect(handlers.get_site_details).toHaveBeenCalledWith({ slug: "l-i-s-a" });
    expect(result).toBe(okResponse);
  });

  it("dispatches a batch with compact when present", async () => {
    const handlers = fakeHandlers();
    const request = getReferenceRequestSchema.parse({
      kind: "site_details",
      slugs: ["l-i-s-a", "a-b"],
      compact: true,
    });

    await runGetReference(handlers as any, request);

    expect(handlers.get_site_details).toHaveBeenCalledWith({
      slugs: ["l-i-s-a", "a-b"],
      compact: true,
    });
  });

  it("dispatches site_elements to only its handler", async () => {
    const handlers = fakeHandlers();
    const request = getReferenceRequestSchema.parse({ kind: "site_elements", slug: "l-i-s-a" });

    const result = await runGetReference(handlers as any, request);

    expectOnly(handlers, "get_site_elements");
    expect(handlers.get_site_elements).toHaveBeenCalledWith({ slug: "l-i-s-a" });
    expect(result).toBe(okResponse);
  });

  it("dispatches element to only its handler", async () => {
    const handlers = fakeHandlers();
    const request = getReferenceRequestSchema.parse({ kind: "element", id: "hero-menu" });

    const result = await runGetReference(handlers as any, request);

    expectOnly(handlers, "get_element");
    expect(handlers.get_element).toHaveBeenCalledWith({ id: "hero-menu" });
    expect(result).toBe(okResponse);
  });

  it("dispatches comparison to only its handler", async () => {
    const handlers = fakeHandlers();
    const request = getReferenceRequestSchema.parse({
      kind: "comparison",
      slugs: ["l-i-s-a", "a-b", "c-d"],
    });

    const result = await runGetReference(handlers as any, request);

    expectOnly(handlers, "compare_sites");
    expect(handlers.compare_sites).toHaveBeenCalledWith({ slugs: ["l-i-s-a", "a-b", "c-d"] });
    expect(result).toBe(okResponse);
  });

  it("dispatches one collection page with the default page", async () => {
    const handlers = fakeHandlers();
    const request = getReferenceRequestSchema.parse({ kind: "collection", slug: "brutalism" });

    const result = await runGetReference(handlers as any, request);

    expectOnly(handlers, "get_collections");
    expect(handlers.get_collections).toHaveBeenCalledWith({ slug: "brutalism", page: 1 });
    expect(result).toBe(okResponse);
  });
});

describe("runBrowseAwards", () => {
  it("dispatches filters to list_categories without args", async () => {
    const handlers = fakeHandlers();
    const request = browseAwardsRequestSchema.parse({ kind: "filters" });

    const result = await runBrowseAwards(handlers as any, request);

    expectOnly(handlers, "list_categories");
    expect(handlers.list_categories).toHaveBeenCalledWith();
    expect(result).toBe(okResponse);
  });

  it("dispatches annual_categories without args", async () => {
    const handlers = fakeHandlers();
    const request = browseAwardsRequestSchema.parse({ kind: "annual_categories" });

    const result = await runBrowseAwards(handlers as any, request);

    expectOnly(handlers, "get_annual_categories");
    expect(handlers.get_annual_categories).toHaveBeenCalledWith();
    expect(result).toBe(okResponse);
  });

  it("dispatches annual_nominees with defaults", async () => {
    const handlers = fakeHandlers();
    const request = browseAwardsRequestSchema.parse({
      kind: "annual_nominees",
      category: "site-of-the-year",
    });

    const result = await runBrowseAwards(handlers as any, request);

    expectOnly(handlers, "get_annual_nominees");
    expect(handlers.get_annual_nominees).toHaveBeenCalledWith({
      category: "site-of-the-year",
      limit: 10,
      offset: 0,
      hydrate: true,
    });
    expect(result).toBe(okResponse);
  });

  it("passes every annual_nominees option when present", async () => {
    const handlers = fakeHandlers();
    const request = browseAwardsRequestSchema.parse({
      kind: "annual_nominees",
      category: "agency-of-the-year",
      limit: 5,
      offset: 10,
      hydrate: false,
    });

    await runBrowseAwards(handlers as any, request);

    expect(handlers.get_annual_nominees).toHaveBeenCalledWith({
      category: "agency-of-the-year",
      limit: 5,
      offset: 10,
      hydrate: false,
    });
  });

  it("dispatches annual_nominee by id and omits undefined optionals", async () => {
    const handlers = fakeHandlers();
    const request = browseAwardsRequestSchema.parse({ kind: "annual_nominee", id: "1234-uuid" });

    const result = await runBrowseAwards(handlers as any, request);

    expectOnly(handlers, "get_annual_nominee");
    expect(handlers.get_annual_nominee).toHaveBeenCalledWith({ id: "1234-uuid" });
    expect(result).toBe(okResponse);
  });

  it("dispatches annual_nominee by category and slug", async () => {
    const handlers = fakeHandlers();
    const request = browseAwardsRequestSchema.parse({
      kind: "annual_nominee",
      category: "site-of-the-year",
      slug: "some-slug",
    });

    await runBrowseAwards(handlers as any, request);

    expect(handlers.get_annual_nominee).toHaveBeenCalledWith({
      category: "site-of-the-year",
      slug: "some-slug",
    });
  });
});

describe("runGetIndex", () => {
  it("dispatches status without args", async () => {
    const handlers = fakeHandlers();
    const request = getIndexRequestSchema.parse({ kind: "status" });

    const result = await runGetIndex(handlers as any, request);

    expectOnly(handlers, "get_index_status");
    expect(handlers.get_index_status).toHaveBeenCalledWith();
    expect(result).toBe(okResponse);
  });

  it("dispatches stats with defaults", async () => {
    const handlers = fakeHandlers();
    const request = getIndexRequestSchema.parse({ kind: "stats" });

    const result = await runGetIndex(handlers as any, request);

    expectOnly(handlers, "get_index_stats");
    expect(handlers.get_index_stats).toHaveBeenCalledWith({ windowDays: 90, top: 10 });
    expect(result).toBe(okResponse);
  });

  it("passes stats options when present", async () => {
    const handlers = fakeHandlers();
    const request = getIndexRequestSchema.parse({ kind: "stats", windowDays: 30, top: 5 });

    await runGetIndex(handlers as any, request);

    expect(handlers.get_index_stats).toHaveBeenCalledWith({ windowDays: 30, top: 5 });
  });
});

describe("registration", () => {
  function captureRegistration(register: (ctx: any) => void) {
    const ctx = { handlers: fakeHandlers(), tool: vi.fn(), registerTool: vi.fn() } as any;
    register(ctx);
    expect(ctx.tool).toHaveBeenCalledTimes(1);
    const [name, description, schema, annotations, callback] = ctx.tool.mock.calls[0];
    return { ctx, name, description, schema, annotations, callback };
  }

  it("registers search_references with the expected contract and dispatches", async () => {
    const { ctx, name, description, schema, annotations, callback } = captureRegistration(
      registerSearchReferences,
    );

    expect(name).toBe("search_references");
    expect(description).toContain("exactly one");
    expect(description).toContain("get_reference");
    expect(schema).toBe(searchReferencesInputSchema);
    expect(typeof schema.safeParse).toBe("function");
    expect(annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(typeof callback).toBe("function");

    const request = searchReferencesRequestSchema.parse({ kind: "sites", query: "portfolio" });
    const result = await callback({ request });

    expect(ctx.handlers.search_sites).toHaveBeenCalledTimes(1);
    expect(ctx.handlers.search_sites).toHaveBeenCalledWith({
      query: "portfolio",
      sortBy: "newest",
      responseMode: "full",
      count: 6,
      page: 1,
    });
    expect(result).toBe(okResponse);
  });

  it("registers get_reference with the expected contract and dispatches", async () => {
    const { ctx, name, description, schema, annotations, callback } = captureRegistration(
      registerGetReference,
    );

    expect(name).toBe("get_reference");
    expect(description).toContain("exactly one");
    expect(description).toContain("comparison");
    expect(schema).toBe(getReferenceInputSchema);
    expect(typeof schema.safeParse).toBe("function");
    expect(annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(typeof callback).toBe("function");

    const request = getReferenceRequestSchema.parse({ kind: "comparison", slugs: ["a-b", "c-d"] });
    const result = await callback({ request });

    expect(ctx.handlers.compare_sites).toHaveBeenCalledTimes(1);
    expect(ctx.handlers.compare_sites).toHaveBeenCalledWith({ slugs: ["a-b", "c-d"] });
    expect(result).toBe(okResponse);
  });

  it("registers browse_awards with the expected contract and dispatches", async () => {
    const { ctx, name, description, schema, annotations, callback } = captureRegistration(
      registerBrowseAwards,
    );

    expect(name).toBe("browse_awards");
    expect(description).toContain("exactly one");
    expect(description).toContain("Annual Awards");
    expect(schema).toBe(browseAwardsInputSchema);
    expect(typeof schema.safeParse).toBe("function");
    expect(annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(typeof callback).toBe("function");

    const request = browseAwardsRequestSchema.parse({ kind: "annual_categories" });
    const result = await callback({ request });

    expect(ctx.handlers.get_annual_categories).toHaveBeenCalledTimes(1);
    expect(result).toBe(okResponse);
  });

  it("registers get_index with the expected contract and dispatches", async () => {
    const { ctx, name, description, schema, annotations, callback } = captureRegistration(
      registerGetIndex,
    );

    expect(name).toBe("get_index");
    expect(description).toContain("exactly one");
    expect(description).toContain("zero network");
    expect(schema).toBe(getIndexInputSchema);
    expect(typeof schema.safeParse).toBe("function");
    expect(annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(typeof callback).toBe("function");

    const request = getIndexRequestSchema.parse({ kind: "stats", windowDays: 30 });
    const result = await callback({ request });

    expect(ctx.handlers.get_index_stats).toHaveBeenCalledTimes(1);
    expect(ctx.handlers.get_index_stats).toHaveBeenCalledWith({ windowDays: 30, top: 10 });
    expect(result).toBe(okResponse);
  });
});
