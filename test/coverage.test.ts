import { describe, expect, it } from "vitest";
import { coverageFrom } from "../src/coverage.js";

describe("coverageFrom", () => {
  it("is complete when nothing was excluded or limited", () => {
    expect(coverageFrom({ collected: 6, excluded: 0 })).toEqual({
      status: "complete",
      collected: 6,
      excluded: 0,
      limitations: [],
    });
    expect(coverageFrom({ collected: 3, excluded: 0, total: 3 }).status).toBe("complete");
  });

  it("is unknown on error, even with collected evidence", () => {
    expect(coverageFrom({ collected: 4, excluded: 0, error: "capture failed" }).status).toBe("unknown");
    expect(coverageFrom({ collected: 0, excluded: 5, total: 5, error: "blocked" }).status).toBe("unknown");
  });

  it("is unknown when a non-empty total produced no collected evidence", () => {
    expect(coverageFrom({ collected: 0, excluded: 0, total: 3 }).status).toBe("unknown");
    expect(coverageFrom({ collected: 0, excluded: 2, total: 2 }).status).toBe("unknown");
  });

  it("is partial when entries were excluded", () => {
    expect(coverageFrom({ collected: 2, excluded: 1 })).toEqual({
      status: "partial",
      collected: 2,
      excluded: 1,
      limitations: [],
    });
  });

  it("is partial when limitations are reported", () => {
    expect(coverageFrom({ collected: 2, excluded: 0, limitations: ["first 2000 entries only"] }).status)
      .toBe("partial");
  });

  it("is partial when fewer items were collected than the total", () => {
    expect(coverageFrom({ collected: 2, excluded: 0, total: 5 }).status).toBe("partial");
  });

  it("treats a zero total with zero collected as complete", () => {
    expect(coverageFrom({ collected: 0, excluded: 0, total: 0 }).status).toBe("complete");
    expect(coverageFrom({ collected: 0, excluded: 0 }).status).toBe("complete");
  });

  it("copies limitations instead of aliasing the caller's array", () => {
    const limitations = ["a limitation"];
    const coverage = coverageFrom({ collected: 1, excluded: 0, limitations });
    limitations.push("mutated later");
    expect(coverage.limitations).toEqual(["a limitation"]);
  });
});
