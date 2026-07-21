import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pagePath = resolve(__dirname, "../../src/pages/QuotationsNewPage.tsx");

describe("QuotationsNewPage encoding", () => {
  const source = readFileSync(pagePath, "utf8");

  it("has no Unicode replacement characters in source", () => {
    expect(source).not.toContain("\uFFFD");
  });

  it("Save button reads exactly Save quotation (no trailing symbol)", () => {
    expect(source).toContain('{creating ? "Saving\u2026" : "Save quotation"}');
    expect(source).not.toContain("Save quotation ?");
  });

  it("uses middle-dot separators and INR via formatInr", () => {
    expect(source).toContain("From enquiry \u00b7 contract-linked \u00b7 read-only");
    expect(source).toContain("Rate contract-linked \u00b7 qty managed later");
    expect(source).toContain('from "../lib/formatInr"');
    expect(source).toMatch(/formatInr\(/);
    expect(source).not.toMatch(/\?\{formatInr/);
    expect(source).not.toMatch(/\?\$\{formatInr/);
  });
});

