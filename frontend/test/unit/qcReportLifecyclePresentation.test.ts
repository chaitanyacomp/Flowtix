import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("QcReportPage — production lifecycle terminology", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/QcReportPage.tsx"), "utf8");

  it("shows final usable summary cards and not ambiguous Prod accepted vs rejected", () => {
    expect(source).toContain("Final usable accepted (today)");
    expect(source).toContain("Initial rejected (today)");
    expect(source).toContain("Rework accepted (today)");
    expect(source).toContain("Final unusable (today)");
    expect(source).not.toContain('"Prod accepted (today)"');
    expect(source).not.toContain('"Prod rejected (today)"');
  });

  it("keeps compact production core columns without Final rejected label", () => {
    expect(source).toContain("First-Pass Acc.");
    expect(source).toContain("Initial Rej.");
    expect(source).toContain("Rework Acc.");
    expect(source).toContain("Final Usable");
    expect(source).toContain("Final Unusable");
    expect(source).toContain("production-qc-report-table");
    expect(source).not.toContain(">Final rejected<");
    expect(source).not.toContain("min-w-[1480px]");
  });

  it("exports lifecycle columns consistently", () => {
    expect(source).toContain('"First-Pass Accepted"');
    expect(source).toContain('"Initial Rejected"');
    expect(source).toContain('"Rework Accepted"');
    expect(source).toContain('"Final Usable"');
    expect(source).toContain('"Final Unusable"');
  });

  it("trace drawer uses initial rejection and final unusable terminology", () => {
    expect(source).toContain("Initial rejection posted");
    expect(source).toContain("Final unresolved / unusable");
    expect(source).toContain("lifecycleNote");
    expect(source).toContain("Final usable = first-pass accepted + rework accepted");
  });

  it("separates API failure from empty filter results", () => {
    expect(source).toContain("qc-report-load-error");
    expect(source).toContain("qc-report-failed-state");
    expect(source).toContain("reportLoadFailed");
    expect(source).toContain("not a zero-result filter");
  });
});
