"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildProductionQcLifecycleMetrics,
  buildReworkClearedTraceNote,
  productionQcLifecycleStatusLabel,
} = require("../../src/services/qcLifecycleProjection");

describe("qcLifecycleProjection — reported lifecycle", () => {
  it("QC-26-0001 style: 10087 inspected, 10077 first-pass, 10 rework accepted → final usable 10087, unusable 0", () => {
    const q = { acceptedQty: "10077", rejectedQty: "10", lossQty: "0", rejectedRoute: null };
    const dispositions = [{ id: 1, status: "CLOSED", qty: "10", remainingQty: "0" }];
    const hints = { reworkDispIds: new Set([1]), holdDispIds: new Set() };
    const recheck = new Map([[1, 10]]);
    const scrapParts = { directScrapQty: 0, reworkFinalScrapQty: 0 };

    const m = buildProductionQcLifecycleMetrics(q, dispositions, hints, recheck, scrapParts);

    assert.equal(m.inspectedQty, 10087);
    assert.equal(m.firstPassAcceptedQty, 10077);
    assert.equal(m.initialRejectedQty, 10);
    assert.equal(m.reworkRoutedQty, 10);
    assert.equal(m.reworkAcceptedQty, 10);
    assert.equal(m.pendingReworkQty, 0);
    assert.equal(m.holdQty, 0);
    assert.equal(m.totalScrapQty, 0);
    assert.equal(m.finalUsableQty, 10087);
    assert.equal(m.finalUnusableQty, 0);
    assert.notEqual(m.finalUnusableQty, m.initialRejectedQty);
    assert.equal(
      buildReworkClearedTraceNote(m),
      "10 initially rejected Nos were accepted after rework; no quantity remains finally rejected.",
    );
    assert.equal(productionQcLifecycleStatusLabel(q, m), "Disposition Completed");
  });

  it("pending rework: final usable stays first-pass; pending visible; no premature usable", () => {
    const q = { acceptedQty: "10077", rejectedQty: "10", lossQty: "0", rejectedRoute: null };
    const dispositions = [
      { id: 1, status: "REWORK_READY_FOR_QC", qty: "10", remainingQty: "10" },
    ];
    const hints = { reworkDispIds: new Set([1]), holdDispIds: new Set() };
    const m = buildProductionQcLifecycleMetrics(q, dispositions, hints, new Map(), {
      directScrapQty: 0,
      reworkFinalScrapQty: 0,
    });

    assert.equal(m.initialRejectedQty, 10);
    assert.equal(m.reworkRoutedQty, 10);
    assert.equal(m.pendingReworkQty, 10);
    assert.equal(m.reworkAcceptedQty, 0);
    assert.equal(m.finalUsableQty, 10077);
    assert.equal(m.finalUnusableQty, 0);
    assert.equal(productionQcLifecycleStatusLabel(q, m), "Rework Pending");
  });

  it("partial rework acceptance: final usable = 10083; remaining 4 accounted", () => {
    const q = { acceptedQty: "10077", rejectedQty: "10", lossQty: "0", rejectedRoute: null };
    const dispositions = [
      { id: 1, status: "REWORK_READY_FOR_QC", qty: "10", remainingQty: "4" },
    ];
    const hints = { reworkDispIds: new Set([1]), holdDispIds: new Set() };
    const recheck = new Map([[1, 6]]);
    const m = buildProductionQcLifecycleMetrics(q, dispositions, hints, recheck, {
      directScrapQty: 0,
      reworkFinalScrapQty: 0,
    });

    assert.equal(m.reworkAcceptedQty, 6);
    assert.equal(m.pendingReworkQty, 4);
    assert.equal(m.finalUsableQty, 10083);
    assert.equal(m.finalUnusableQty, 0);
  });

  it("rework final scrap does not enter final usable", () => {
    const q = { acceptedQty: "10077", rejectedQty: "10", lossQty: "0", rejectedRoute: null };
    const dispositions = [{ id: 1, status: "CLOSED", qty: "10", remainingQty: "0" }];
    const hints = { reworkDispIds: new Set([1]), holdDispIds: new Set() };
    const recheck = new Map([[1, 6]]);
    const scrapParts = { directScrapQty: 0, reworkFinalScrapQty: 4 };
    const m = buildProductionQcLifecycleMetrics(q, dispositions, hints, recheck, scrapParts);

    assert.equal(m.finalUsableQty, 10083);
    assert.equal(m.reworkFinalScrapQty, 4);
    assert.equal(m.finalUnusableQty, 4);
    assert.equal(m.totalScrapQty, 4);
  });

  it("matches prior scenario: 10k inspected, 9880 usable, rework 100, scrap 120", () => {
    const q = { acceptedQty: "9800", rejectedQty: "200", lossQty: "100", rejectedRoute: null };
    const dispositions = [
      { id: 1, status: "CLOSED", qty: "100", remainingQty: "0" },
      { id: 2, status: "SCRAP", qty: "100", remainingQty: "0" },
    ];
    const hints = { reworkDispIds: new Set([1]), holdDispIds: new Set() };
    const recheck = new Map([[1, 80]]);
    const scrapParts = { directScrapQty: 0, reworkFinalScrapQty: 20 };

    const m = buildProductionQcLifecycleMetrics(q, dispositions, hints, recheck, scrapParts);

    assert.equal(m.inspectedQty, 10000);
    assert.equal(m.initialAcceptedQty, 9800);
    assert.equal(m.reworkQty, 100);
    assert.equal(m.reworkAcceptedQty, 80);
    assert.equal(m.finalUsableQty, 9880);
    assert.equal(m.directScrapQty, 100);
    assert.equal(m.reworkFinalScrapQty, 20);
    assert.equal(m.totalScrapQty, 120);
    assert.equal(m.finalUnusableQty, 120);
  });

  it("does not double-count lossQty into inspected", () => {
    const q = { acceptedQty: "9800", rejectedQty: "200", lossQty: "100", rejectedRoute: null };
    const m = buildProductionQcLifecycleMetrics(
      q,
      [],
      { reworkDispIds: new Set(), holdDispIds: new Set() },
      new Map(),
      { directScrapQty: 0, reworkFinalScrapQty: 0 },
    );
    assert.equal(m.inspectedQty, 10000);
  });

  it("null/missing optional lifecycle inputs do not crash", () => {
    const m = buildProductionQcLifecycleMetrics(null, null, null, null, null);
    assert.equal(m.inspectedQty, 0);
    assert.equal(m.finalUsableQty, 0);
    assert.equal(m.finalUnusableQty, 0);
    assert.equal(m.reworkAcceptedQty, 0);
  });

  it("QC row without rework loads with first-pass only totals", () => {
    const q = { acceptedQty: "50", rejectedQty: "0", lossQty: "0", rejectedRoute: null };
    const m = buildProductionQcLifecycleMetrics(q, [], undefined, undefined, undefined);
    assert.equal(m.firstPassAcceptedQty, 50);
    assert.equal(m.finalUsableQty, 50);
    assert.equal(m.reworkAcceptedQty, 0);
    assert.equal(m.finalUnusableQty, 0);
  });
});

describe("qcLifecycleProjection — Prisma select contract", () => {
  const { readFileSync } = require("node:fs");
  const { resolve } = require("node:path");
  const source = readFileSync(resolve(__dirname, "../../src/services/qcLifecycleProjection.js"), "utf8");

  it("does not select StockTransaction.createdAt (field does not exist)", () => {
    assert.equal(source.includes("createdAt: true"), false);
    assert.match(source, /StockTransaction has `date` only/);
  });
});
