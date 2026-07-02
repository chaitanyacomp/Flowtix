const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeSupplierPoNumber,
  requireSupplierPoNumber,
  SUPPLIER_PO_NUMBER_REQUIRED,
} = require("../../src/services/purchaseRequestService");

test("RM PO supplier PO number is required", () => {
  assert.throws(
    () => requireSupplierPoNumber(null),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, SUPPLIER_PO_NUMBER_REQUIRED);
      return true;
    },
  );
});

test("RM PO supplier PO number rejects whitespace only", () => {
  assert.throws(
    () => requireSupplierPoNumber("   \t  "),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, SUPPLIER_PO_NUMBER_REQUIRED);
      return true;
    },
  );
});

test("RM PO supplier PO number trims and returns stored value", () => {
  assert.equal(normalizeSupplierPoNumber("  VPO-2026-001  "), "VPO-2026-001");
  assert.equal(requireSupplierPoNumber("  VPO-2026-001  "), "VPO-2026-001");
});

test("RM PO supplier PO number enforces 100 character maximum", () => {
  assert.equal(requireSupplierPoNumber("A".repeat(100)), "A".repeat(100));
  assert.throws(
    () => requireSupplierPoNumber("A".repeat(101)),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, "SUPPLIER_PO_NUMBER_TOO_LONG");
      return true;
    },
  );
});
