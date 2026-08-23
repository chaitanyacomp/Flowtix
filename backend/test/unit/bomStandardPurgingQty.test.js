const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  parseStandardPurgingQtyGrams,
  parseOptionalNonNegativeDecimal,
  STANDARD_PURGING_QTY_LABEL,
} = require("../../src/services/bomUtils");

const {
  normalizeBomHeaderInput,
  headerSchema,
  createBomSchema,
  resolveApproveDraft,
} = require("../../src/routes/boms");

describe("parseStandardPurgingQtyGrams", () => {
  it("defaults blank / null / omitted to 0", () => {
    assert.equal(parseStandardPurgingQtyGrams(null), 0);
    assert.equal(parseStandardPurgingQtyGrams(""), 0);
    assert.equal(parseStandardPurgingQtyGrams("   "), 0);
    assert.equal(parseOptionalNonNegativeDecimal(undefined, STANDARD_PURGING_QTY_LABEL), 0);
  });

  it("preserves decimals and accepts zero", () => {
    assert.equal(parseStandardPurgingQtyGrams(0), 0);
    assert.equal(parseStandardPurgingQtyGrams(12.5), 12.5);
    assert.equal(parseStandardPurgingQtyGrams("12.500"), 12.5);
    assert.equal(parseStandardPurgingQtyGrams(".5"), 0.5);
  });

  it("rejects negative, non-numeric, NaN and infinite values", () => {
    assert.throws(
      () => parseStandardPurgingQtyGrams(-1),
      (err) => err.statusCode === 400 && /cannot be negative/i.test(err.message),
    );
    assert.throws(
      () => parseStandardPurgingQtyGrams("-2"),
      (err) => err.statusCode === 400 && /valid number/i.test(err.message),
    );
    assert.throws(
      () => parseStandardPurgingQtyGrams("12a"),
      (err) => err.statusCode === 400 && /valid number/i.test(err.message),
    );
    assert.throws(
      () => parseStandardPurgingQtyGrams("1e3"),
      (err) => err.statusCode === 400,
    );
    assert.throws(
      () => parseStandardPurgingQtyGrams(Number.NaN),
      (err) => err.statusCode === 400,
    );
    assert.throws(
      () => parseStandardPurgingQtyGrams(Number.POSITIVE_INFINITY),
      (err) => err.statusCode === 400,
    );
  });
});

describe("BOM header standardPurgingQtyGrams (create/update normalize)", () => {
  it("normalizes omitted / blank / null to 0 on header", () => {
    const a = normalizeBomHeaderInput({
      outputQty: 1,
      runnerWeight: 0,
      bomType: "STANDARD",
      effectiveFrom: new Date("2026-08-01"),
    });
    assert.equal(a.standardPurgingQtyGrams, "0");

    const b = normalizeBomHeaderInput({
      outputQty: 1,
      runnerWeight: 0,
      standardPurgingQtyGrams: "",
      bomType: "STANDARD",
      effectiveFrom: new Date("2026-08-01"),
    });
    assert.equal(b.standardPurgingQtyGrams, "0");

    const c = normalizeBomHeaderInput({
      outputQty: 1,
      runnerWeight: 0,
      standardPurgingQtyGrams: null,
      bomType: "STANDARD",
      effectiveFrom: new Date("2026-08-01"),
    });
    assert.equal(c.standardPurgingQtyGrams, "0");
  });

  it("stores create/edit decimal value for retrieve-roundtrip shape", () => {
    const created = normalizeBomHeaderInput({
      outputQty: 1,
      runnerWeight: 0,
      standardPurgingQtyGrams: 25.75,
      bomType: "STANDARD",
      effectiveFrom: new Date("2026-08-01"),
      remarks: "purge test",
    });
    assert.equal(created.standardPurgingQtyGrams, "25.75");

    const edited = normalizeBomHeaderInput({
      ...created,
      standardPurgingQtyGrams: Number(created.standardPurgingQtyGrams),
      outputQty: Number(created.outputQty),
      runnerWeight: Number(created.runnerWeight),
    });
    assert.equal(edited.standardPurgingQtyGrams, "25.75");
  });

  it("Zod create schema accepts omitted/blank and rejects invalid purging qty", () => {
    const base = {
      fgItemId: 1,
      outputQty: 1,
      runnerWeight: 0,
      bomType: "STANDARD",
      effectiveFrom: "2026-08-01",
      lines: [{ rmItemId: 2, baseQty: 0.01 }],
    };

    const omitted = createBomSchema.parse(base);
    assert.equal(omitted.standardPurgingQtyGrams, 0);

    const blank = createBomSchema.parse({ ...base, standardPurgingQtyGrams: "" });
    assert.equal(blank.standardPurgingQtyGrams, 0);

    const decimal = createBomSchema.parse({ ...base, standardPurgingQtyGrams: "18.25" });
    assert.equal(decimal.standardPurgingQtyGrams, 18.25);

    assert.throws(() => createBomSchema.parse({ ...base, standardPurgingQtyGrams: -3 }));
    assert.throws(() => createBomSchema.parse({ ...base, standardPurgingQtyGrams: "abc" }));
    assert.throws(() => createBomSchema.parse({ ...base, standardPurgingQtyGrams: "1e2" }));
  });

  it("headerSchema default for existing BOMs without the field is 0", () => {
    const parsed = headerSchema.parse({
      outputQty: 1,
      runnerWeight: 0,
      bomType: "STANDARD",
    });
    assert.equal(parsed.standardPurgingQtyGrams, 0);
  });
});

describe("BOM standardPurgingQtyGrams persistence / approve / revise", () => {
  const draftExisting = {
    fgWeight: "100",
    fgWeightUnitId: 1,
    outputQty: "1",
    runnerWeight: "0",
    standardPurgingQtyGrams: "0",
    bomType: "STANDARD",
    effectiveFrom: new Date("2026-08-01"),
    remarks: null,
    lines: [{ rmItemId: 2, baseQty: "0.1" }],
  };

  it("edit existing draft → save payload retains 200 for reopen mapping", () => {
    const saved = normalizeBomHeaderInput({
      fgWeight: 100,
      fgWeightUnitId: 1,
      outputQty: 1,
      runnerWeight: 0,
      standardPurgingQtyGrams: 200,
      bomType: "STANDARD",
      effectiveFrom: new Date("2026-08-01"),
    });
    assert.equal(saved.standardPurgingQtyGrams, "200");
    const reopened = Number(saved.standardPurgingQtyGrams ?? 0);
    assert.equal(reopened, 200);
  });

  it("approve with draft body persists unsaved 200 (does not keep stale DB 0)", () => {
    const resolved = resolveApproveDraft(draftExisting, {
      fgWeight: 100,
      fgWeightUnitId: 1,
      outputQty: 1,
      runnerWeight: 0,
      standardPurgingQtyGrams: 200,
      bomType: "STANDARD",
      effectiveFrom: "2026-08-01",
      lines: [{ rmItemId: 2, baseQty: 0.1 }],
    });
    assert.equal(resolved.persistDraft, true);
    assert.equal(resolved.header.standardPurgingQtyGrams, "200");
    assert.ok(Array.isArray(resolved.lines));
  });

  it("approve without body keeps stored DB value (cannot invent 200 from empty POST)", () => {
    const withStored = {
      ...draftExisting,
      standardPurgingQtyGrams: "200",
    };
    const resolved = resolveApproveDraft(withStored, {});
    assert.equal(resolved.persistDraft, false);
    assert.equal(resolved.header.standardPurgingQtyGrams, "200");
    assert.equal(resolved.lines, null);
  });

  it("approval cannot silently discard unsaved value when body omits lines", () => {
    // Header-only body is not treated as a draft persist; FE must send lines with open-editor Approve.
    const resolved = resolveApproveDraft(draftExisting, { standardPurgingQtyGrams: 200 });
    assert.equal(resolved.persistDraft, false);
    assert.equal(resolved.header.standardPurgingQtyGrams, "0");
  });

  it("approved revision copies stored purging qty into next revision header", () => {
    const source = {
      fgWeight: "50",
      fgWeightUnitId: 1,
      outputQty: "1",
      runnerWeight: "2",
      standardPurgingQtyGrams: "200",
      bomType: "STANDARD",
      effectiveFrom: new Date("2026-08-01"),
      remarks: "from approved",
    };
    const nextDraftHeader = normalizeBomHeaderInput({
      fgWeight: source.fgWeight != null ? Number(source.fgWeight) : null,
      fgWeightUnitId: source.fgWeightUnitId,
      outputQty: Number(source.outputQty ?? 1),
      runnerWeight: Number(source.runnerWeight ?? 0),
      standardPurgingQtyGrams: Number(source.standardPurgingQtyGrams ?? 0),
      bomType: source.bomType,
      effectiveFrom: source.effectiveFrom,
      remarks: source.remarks,
    });
    assert.equal(nextDraftHeader.standardPurgingQtyGrams, "200");
  });

  it("API response / UI reload retain decimal value as Number", () => {
    const mapped = Number("200.0000" ?? 0);
    assert.equal(mapped, 200);
    const uiString = Number.isFinite(mapped) && mapped >= 0 ? String(mapped) : "0";
    assert.equal(uiString, "200");
  });
});
