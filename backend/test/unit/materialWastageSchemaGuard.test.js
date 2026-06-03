const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isMaterialWastageSchemaUnavailable } = require("../../src/services/materialWastageSchemaGuard");

describe("materialWastageSchemaGuard", () => {
  it("detects P2021 on MaterialWastageNote", () => {
    assert.equal(
      isMaterialWastageSchemaUnavailable({ code: "P2021", meta: { table: "MaterialWastageNote" } }),
      true,
    );
  });

  it("ignores unrelated P2021", () => {
    assert.equal(
      isMaterialWastageSchemaUnavailable({ code: "P2021", meta: { table: "PurchaseBill" } }),
      false,
    );
  });
});
