import { describe, expect, it } from "vitest";

/** Mirror of empty-row CSV body rule in ReportPrintExport.downloadReportCsv */
function csvBodyLines(rows: Array<Array<string | number | null | undefined>>): string[] {
  if (rows.length === 0) return ['"No records found"'];
  return rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","));
}

describe("report CSV empty-state rule", () => {
  it("emits No records found when there are no data rows", () => {
    expect(csvBodyLines([])).toEqual(['"No records found"']);
  });

  it("emits data rows when present", () => {
    expect(csvBodyLines([["a", 1]])).toEqual(['"a","1"']);
  });
});
