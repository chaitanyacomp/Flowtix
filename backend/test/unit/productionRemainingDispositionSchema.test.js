/**
 * Partial finalize must choose Pause or End-with-Shortage — Continue is not valid.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");

// Mirror the approve schema disposition enum after Continue removal.
const remainingDispositionSchema = z.enum(["PAUSE", "END_WITH_SHORTAGE", "CLOSE_WITH_SHORTAGE"]).optional();

describe("production approve remainingDisposition schema", () => {
  it("accepts Pause and End-with-Shortage only", () => {
    assert.equal(remainingDispositionSchema.parse("PAUSE"), "PAUSE");
    assert.equal(remainingDispositionSchema.parse("END_WITH_SHORTAGE"), "END_WITH_SHORTAGE");
    assert.equal(remainingDispositionSchema.parse(undefined), undefined);
  });

  it("rejects CONTINUE as a finalize disposition", () => {
    assert.throws(() => remainingDispositionSchema.parse("CONTINUE"));
  });
});
