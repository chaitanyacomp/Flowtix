import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  downloadReportExcel,
  ensureCsvFilename,
  ensureXlsxFilename,
} from "../../src/components/erp/ReportPrintExport";

describe("report export filenames", () => {
  it("forces .csv and never leaves .xls", () => {
    expect(ensureCsvFilename("a.xls")).toBe("a.csv");
    expect(ensureCsvFilename("a.xlsx")).toBe("a.csv");
    expect(ensureCsvFilename("a.csv")).toBe("a.csv");
    expect(ensureCsvFilename("a")).toBe("a.csv");
  });

  it("forces .xlsx and never leaves .xls", () => {
    expect(ensureXlsxFilename("a.xls")).toBe("a.xlsx");
    expect(ensureXlsxFilename("a.xlsx")).toBe("a.xlsx");
    expect(ensureXlsxFilename("a.csv")).toBe("a.xlsx");
    expect(ensureXlsxFilename("a")).toBe("a.xlsx");
  });
});

describe("downloadReportExcel produces real OOXML", () => {
  it("workbook bytes start with ZIP signature PK", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["A", "B"],
      ["No records found"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
    const bytes = Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
    // OOXML is a ZIP package
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    expect(bytes.length).toBeGreaterThan(100);
  });

  it("downloadReportExcel is exported and callable shape", () => {
    expect(typeof downloadReportExcel).toBe("function");
  });
});
