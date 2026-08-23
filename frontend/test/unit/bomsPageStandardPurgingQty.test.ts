import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("BomsPage Standard Purging Qty per Setup", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/BomsPage.tsx"), "utf8");

  it("shows labelled field with grams unit via DecimalInput (no type=number)", () => {
    expect(source).toContain("Standard Purging Qty per Setup");
    expect(source).toContain('data-testid="bom-standard-purging-qty"');
    expect(source).toContain("standardPurgingQtyGrams");
    expect(source).toMatch(/bom-standard-purging-qty[\s\S]*?unit=["']g["']/);
    expect(source).toContain("DecimalInput");
    const fieldBlockStart = source.indexOf('data-testid="bom-standard-purging-qty"');
    const fieldBlock = source.slice(fieldBlockStart, fieldBlockStart + 450);
    expect(fieldBlock).not.toMatch(/type=["']number["']/);
  });

  it("includes field in create/edit payload and planning summary", () => {
    expect(source).toMatch(/standardPurgingQtyGrams:\s*nums\.standardPurgingQtyGrams/);
    expect(source).toContain('label="Standard Purging Qty per Setup"');
    expect(source).toContain("Purge (g)");
  });

  it("validates non-negative purging qty near the field", () => {
    expect(source).toContain("standardPurgingQtyError");
    expect(source).toContain("Cannot be negative.");
    expect(source).toContain("Enter a valid non-negative number in grams.");
  });

  it("maps API reload value into header draft (reopen retains decimal)", () => {
    expect(source).toMatch(/standardPurgingQtyGrams:\s*Number\.isFinite\(purge\)[\s\S]*?String\(purge\)/);
    expect(source).toContain("headerFromBom");
  });

  it("edit → save draft sends standardPurgingQtyGrams on PUT/POST", () => {
    expect(source).toContain("async function saveDraft");
    expect(source).toMatch(/method:\s*["']PUT["']/);
    expect(source).toMatch(/bomPayload\(header,\s*lines\)/);
  });

  it("approve open draft sends workspace payload so unsaved value is not discarded", () => {
    expect(source).toContain("approvingOpenDraft");
    expect(source).toMatch(/\/api\/boms\/\$\{id\}\/approve/);
    expect(source).toMatch(
      /approvingOpenDraft[\s\S]*?method:\s*["']POST["'][\s\S]*?body:\s*JSON\.stringify\(bomPayload\(header,\s*lines\)\)/,
    );
    expect(source).toContain("Save Draft before Approve");
  });

  it("does not toast approve success when request fails", () => {
    const approveFn = source.slice(source.indexOf("async function approveBom"), source.indexOf("async function deactivateBom"));
    expect(approveFn).toContain("toast.showSuccess(\"BOM approved successfully\")");
    expect(approveFn).toContain("catch (err)");
    expect(approveFn).toMatch(/catch \(err\) \{\s*setError\(bomApiError\(err\)\);\s*\}/);
    // success toast only inside try, before catch
    const tryBlocks = approveFn.split("try {");
    expect(tryBlocks.length).toBeGreaterThan(1);
    for (const block of tryBlocks.slice(1)) {
      const catchIdx = block.indexOf("catch (err)");
      const successInTry = block.slice(0, catchIdx).includes('toast.showSuccess("BOM approved successfully")');
      const successInCatch = block.slice(catchIdx).includes('toast.showSuccess("BOM approved successfully")');
      if (block.includes('toast.showSuccess("BOM approved successfully")')) {
        expect(successInTry).toBe(true);
        expect(successInCatch).toBe(false);
      }
    }
  });
});
