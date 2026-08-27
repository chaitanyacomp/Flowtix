const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  INVALID_MESSAGE,
  parseStrictIsoDateOnly,
  assertStrictIsoDateOnly,
} = require("../../src/services/strictIsoDate");
const { normalizeProductionRunInputs } = require("../../src/services/woProductionRunAllocationService");

describe("strictIsoDate", () => {
  it("accepts 1900 and 2100", () => {
    assert.equal(parseStrictIsoDateOnly("1900-01-01").ok, true);
    assert.equal(parseStrictIsoDateOnly("2100-12-31").ok, true);
  });

  it("rejects 1899 and 2101", () => {
    assert.equal(parseStrictIsoDateOnly("1899-12-31").ok, false);
    assert.equal(parseStrictIsoDateOnly("2101-01-01").ok, false);
  });

  it("rejects 5/6-digit years and impossible dates", () => {
    assert.equal(parseStrictIsoDateOnly("20261-01-01").ok, false);
    assert.equal(parseStrictIsoDateOnly("120261-01-01").ok, false);
    assert.equal(parseStrictIsoDateOnly("2026-02-30").ok, false);
    assert.equal(parseStrictIsoDateOnly("2025-02-29").ok, false);
    assert.equal(parseStrictIsoDateOnly("2024-02-29").ok, true);
  });

  it("uses DD-MM-YYYY operator message (never YYYY-MM-DD)", () => {
    const bad = parseStrictIsoDateOnly("not-a-date");
    assert.equal(bad.ok, false);
    assert.equal(bad.message, INVALID_MESSAGE);
    assert.equal(/YYYY-MM-DD/.test(bad.message), false);
  });

  it("assertStrictIsoDateOnly throws on malformed write payloads", () => {
    assert.throws(() => assertStrictIsoDateOnly("2026-13-01", { required: true }), (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, INVALID_MESSAGE);
      return true;
    });
  });

  it("normalizeProductionRunInputs rejects malformed plannedDate", () => {
    assert.throws(
      () =>
        normalizeProductionRunInputs([
          {
            fgItemId: 1,
            runSequence: 1,
            machineId: 1,
            plannedQty: 10,
            plannedDate: "20261-08-26",
          },
        ]),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /DD-MM-YYYY/);
        assert.equal(/YYYY-MM-DD/.test(err.message), false);
        return true;
      },
    );
  });
});
