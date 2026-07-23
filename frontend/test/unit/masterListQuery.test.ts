import { describe, expect, it } from "vitest";
import {
  compareByKey,
  createInitialMasterListQuery,
  createQueryGeneration,
  matchesNameSearch,
  normalizeSearchText,
  paginateRows,
  resultCountLabel,
  MASTERS_LANDING_PATH,
} from "../../src/lib/masterListQuery";
import { summarizeMasterBulkResult } from "../../src/lib/masterBulkApi";

describe("masterListQuery", () => {
  it("exposes Masters landing path", () => {
    expect(MASTERS_LANDING_PATH).toBe("/masters");
  });

  it("normalizes search with trim and case-insensitive match", () => {
    expect(normalizeSearchText("  AcMe ")).toBe("acme");
    expect(matchesNameSearch("Acme Industries", "  acme ")).toBe(true);
    expect(matchesNameSearch("Acme Industries", "xyz")).toBe(false);
    expect(matchesNameSearch("Widget", "")).toBe(true);
  });

  it("sorts stably by secondary id", () => {
    const rows = [
      { id: 2, name: "A" },
      { id: 1, name: "A" },
      { id: 3, name: "B" },
    ];
    const sorted = [...rows].sort((a, b) => compareByKey(a, b, (r) => r.name, "asc"));
    expect(sorted.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("paginates without rendering full set", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: i + 1 }));
    const p1 = paginateRows(rows, 1, 50);
    expect(p1.pageRows).toHaveLength(50);
    expect(p1.from).toBe(1);
    expect(p1.to).toBe(50);
    expect(p1.totalPages).toBe(3);
    const p3 = paginateRows(rows, 3, 50);
    expect(p3.pageRows).toHaveLength(20);
    expect(p3.from).toBe(101);
    expect(p3.to).toBe(120);
  });

  it("result count distinguishes filtered vs total", () => {
    expect(resultCountLabel({ filtered: 10, total: 100, searching: true })).toBe("10 of 100 records");
    expect(resultCountLabel({ filtered: 100, total: 100, searching: false })).toBe("100 records");
  });

  it("guards stale async generations", () => {
    const g = createQueryGeneration();
    const t1 = g.next();
    expect(g.isCurrent(t1)).toBe(true);
    const t2 = g.next();
    expect(g.isCurrent(t1)).toBe(false);
    expect(g.isCurrent(t2)).toBe(true);
  });

  it("defaults query to name ascending page size 50", () => {
    const q = createInitialMasterListQuery();
    expect(q.sortKey).toBe("name");
    expect(q.sortDir).toBe("asc");
    expect(q.pageSize).toBe(50);
  });
});

describe("summarizeMasterBulkResult", () => {
  it("reports partial success with blocked records", () => {
    const s = summarizeMasterBulkResult(
      {
        requested: 3,
        changed: [1],
        skipped: [],
        blocked: [{ id: 2, reason: "in use" }],
        failed: [],
      },
      "deleted",
    );
    expect(s.tone).toBe("info");
    expect(s.message).toMatch(/1 deleted/i);
    expect(s.message).toMatch(/1 blocked/i);
  });

  it("reports all blocked without claiming success", () => {
    const s = summarizeMasterBulkResult(
      {
        requested: 2,
        changed: [],
        skipped: [],
        blocked: [
          { id: 1, reason: "x" },
          { id: 2, reason: "y" },
        ],
        failed: [],
      },
      "deleted",
    );
    expect(s.tone).toBe("info");
    expect(s.message).toMatch(/blocked/i);
  });
});
