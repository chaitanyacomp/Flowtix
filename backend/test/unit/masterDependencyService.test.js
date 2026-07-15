const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBomDependencySummary,
  buildItemDependencySummary,
  summarize,
} = require("../../src/services/masterDependencyService");

function countDb(values = {}) {
  return new Proxy({}, {
    get(_target, model) {
      return { count: async () => Number(values[model] || 0) };
    },
  });
}

const draftBom = { id: 7, fgItemId: 11, docNo: "BOM-7", revisionNo: 1, status: "DRAFT", approvedAt: null, fgItem: { itemName: "Cap" } };
const approvedBom = { ...draftBom, id: 8, status: "APPROVED", approvedAt: new Date() };

test("draft unused BOM is safe to delete", async () => {
  assert.equal((await buildBomDependencySummary(countDb(), draftBom)).safeToDelete, true);
});

test("approved unused BOM is safe to delete", async () => {
  assert.equal((await buildBomDependencySummary(countDb(), approvedBom)).safeToDelete, true);
});

test("used BOM cannot be deleted and dependency counts are accurate", async () => {
  const result = await buildBomDependencySummary(countDb({ workOrderLine: 2, productionEntry: 8, stockTransaction: 56 }), approvedBom);
  assert.equal(result.safeToDelete, false);
  assert.equal(result.totalDependencies, 10);
  assert.deepEqual(result.dependencies.map((d) => [d.key, d.count]), [["workOrders", 2], ["productionEntries", 8]]);
});

test("used BOM remains eligible for inactive lifecycle", async () => {
  const result = await buildBomDependencySummary(countDb({ dispatch: 1 }), approvedBom);
  assert.equal(result.canDeactivate, true);
  assert.equal(result.safeToDelete, false);
});

test("item without dependencies is safe to delete", async () => {
  const result = await buildItemDependencySummary(countDb(), { id: 3, itemName: "Unused RM", isActive: true });
  assert.equal(result.safeToDelete, true);
});

test("item with any dependency is blocked", async () => {
  const result = await buildItemDependencySummary(countDb({ bomLine: 1, stockTransaction: 56 }), { id: 4, itemName: "PVC", isActive: true });
  assert.equal(result.safeToDelete, false);
  assert.equal(result.totalDependencies, 57);
  assert.deepEqual(result.dependencies.map((d) => d.label), ["BOM Components", "Inventory Transactions"]);
});

test("dependency summary excludes zero counts", () => {
  const result = summarize("ITEM", { id: 1, itemName: "A" }, [
    { key: "zero", label: "Zero", count: 0 },
    { key: "used", label: "Used", count: 3 },
  ]);
  assert.equal(result.totalDependencies, 3);
  assert.deepEqual(result.dependencies, [{ key: "used", label: "Used", count: 3 }]);
});
