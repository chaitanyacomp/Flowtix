/**
 * Control Tower / accounts dashboard Decimal must come from generated client
 * (prismaClientPackage), not bare @prisma/client — packaged Batch 3 runtime.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Prisma } = require("../../src/prismaClientPackage");

describe("accountsDashboard Decimal (packaged-runtime safe)", () => {
  it("Prisma.Decimal from prismaClientPackage is a constructor", () => {
    assert.equal(typeof Prisma.Decimal, "function");
    const d = new Prisma.Decimal("0.0001");
    assert.equal(d.toString(), "0.0001");
    assert.ok(d.gt(0));
  });

  it("accountsDashboardService imports Prisma via prismaClientPackage only", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/services/accountsDashboardService.js"),
      "utf8",
    );
    assert.match(src, /require\(["']\.\.\/prismaClientPackage["']\)/);
    assert.doesNotMatch(src, /require\(["']@prisma\/client["']\)/);
    assert.match(src, /new Prisma\.Decimal\(/);
  });
});
