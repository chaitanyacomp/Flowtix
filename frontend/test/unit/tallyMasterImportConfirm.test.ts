import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildTallyConfirmImportBody,
  formatTallyConfirm413Message,
  isOversizedLegacyConfirmBody,
  tallyConfirmBodyByteLength,
} from "../../src/lib/tallyMasterImportConfirm";

const PAGE = path.resolve(__dirname, "../../src/pages/TallyMasterImportPage.tsx");

describe("tallyMasterImportConfirm slim payload", () => {
  it("does not include item rows, XML, or bulk itemTypeOverrides", () => {
    const body = buildTallyConfirmImportBody({
      previewToken: "tok_" + "a".repeat(40),
      clientOperationId: "op-12345678",
      groupTypeOverrides: { bought: "RM", finished: "FG" },
      unitMapOverrides: { nos: "Nos", kg: "Kg" },
    });
    expect(body).not.toHaveProperty("itemTypeOverrides");
    expect(body).not.toHaveProperty("items");
    expect(body).not.toHaveProperty("customers");
    expect(body).not.toHaveProperty("warnings");
    expect(body.confirm).toBe(true);
    expect(tallyConfirmBodyByteLength(body)).toBeLessThan(2_000);
  });

  it("flags legacy 4246-item override maps as oversized", () => {
    const itemTypeOverrides: Record<string, string> = {};
    for (let i = 0; i < 4246; i += 1) {
      itemTypeOverrides[`0.3 mm SS 420 sheet long name example ${i}`] = "RM";
    }
    const legacy = {
      previewToken: "x".repeat(48),
      confirm: true,
      clientOperationId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      itemTypeOverrides,
      groupTypeOverrides: { bought: "RM" },
      unitMapOverrides: { nos: "Nos" },
    };
    expect(isOversizedLegacyConfirmBody(legacy)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(legacy), "utf8")).toBeGreaterThan(100 * 1024);
  });

  it("exposes the business 413 message and page uses slim confirm body", () => {
    expect(formatTallyConfirm413Message()).toContain("No stock items were imported");
    const src = fs.readFileSync(PAGE, "utf8");
    expect(src).toContain("buildTallyConfirmImportBody");
    expect(src).not.toMatch(/itemTypeOverrides:\s*itemRowTypes/);
    expect(src).toContain("formatTallyConfirm413Message");
  });
});
