"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Inline mirrors of report helpers (keep in sync with qcReport.js semantics).
function roundQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1000) / 1000;
}

const REWORK_DISPOSITION_STATUSES = new Set([
  "REWORK_PENDING_SUPERVISOR",
  "REWORK_APPROVED_PENDING_EXECUTION",
  "REWORK_READY_FOR_QC",
]);

function isReworkDispositionStatus(status) {
  return REWORK_DISPOSITION_STATUSES.has(String(status ?? ""));
}

function dispositionReportBucket(d, hints) {
  const status = String(d.status ?? "");
  if (status === "SCRAP") return "scrap";
  if (status === "HOLD") return "hold";
  if (isReworkDispositionStatus(status)) return "rework";
  if (status === "CLOSED") {
    if (hints.reworkDispIds.has(d.id)) return "rework";
    if (hints.holdDispIds.has(d.id)) return "hold";
  }
  return "rework";
}

function buildMetrics(q, dispositions, hints, recheckAcceptedByDispId, scrapParts) {
  const initialAcceptedQty = roundQty(Number(q.acceptedQty ?? 0));
  const rejectedQty = roundQty(Number(q.rejectedQty ?? 0));
  const inspectedQty = roundQty(initialAcceptedQty + rejectedQty);

  let reworkQty = 0;
  let holdQty = 0;
  let directScrapQty = 0;

  for (const d of dispositions) {
    const qty = roundQty(Number(d.qty ?? 0));
    const bucket = dispositionReportBucket(d, hints);
    if (bucket === "rework") reworkQty = roundQty(reworkQty + qty);
    else if (bucket === "hold") holdQty = roundQty(holdQty + qty);
    else if (bucket === "scrap") directScrapQty = roundQty(directScrapQty + qty);
  }

  let reworkAcceptedQty = 0;
  for (const d of dispositions) {
    if (dispositionReportBucket(d, hints) !== "rework") continue;
    reworkAcceptedQty = roundQty(reworkAcceptedQty + (recheckAcceptedByDispId.get(d.id) ?? 0));
  }

  const reworkFinalScrapQty = roundQty(scrapParts.reworkFinalScrapQty);
  const totalScrapQty = roundQty(directScrapQty + reworkFinalScrapQty);
  const finalUsableQty = roundQty(initialAcceptedQty + reworkAcceptedQty);

  return { inspectedQty, initialAcceptedQty, reworkQty, directScrapQty, reworkFinalScrapQty, totalScrapQty, reworkAcceptedQty, finalUsableQty };
}

describe("qc report production metrics (split reject + rework recheck)", () => {
  it("matches user scenario: 10k inspected, 9880 usable, rework 100, scrap 120", () => {
    const q = { acceptedQty: "9800", rejectedQty: "200", lossQty: "100", rejectedRoute: null };
    const dispositions = [
      { id: 1, status: "CLOSED", qty: "100", remainingQty: "0" },
      { id: 2, status: "SCRAP", qty: "100", remainingQty: "0" },
    ];
    const hints = { reworkDispIds: new Set([1]), holdDispIds: new Set() };
    const recheck = new Map([[1, 80]]);
    const scrapParts = { directScrapQty: 0, reworkFinalScrapQty: 20 };

    const m = buildMetrics(q, dispositions, hints, recheck, scrapParts);

    assert.equal(m.inspectedQty, 10000);
    assert.equal(m.initialAcceptedQty, 9800);
    assert.equal(m.reworkQty, 100);
    assert.equal(m.reworkAcceptedQty, 80);
    assert.equal(m.finalUsableQty, 9880);
    assert.equal(m.directScrapQty, 100);
    assert.equal(m.reworkFinalScrapQty, 20);
    assert.equal(m.totalScrapQty, 120);
  });

  it("does not double-count lossQty into inspected", () => {
    const q = { acceptedQty: "9800", rejectedQty: "200", lossQty: "100", rejectedRoute: null };
    const m = buildMetrics(q, [], { reworkDispIds: new Set(), holdDispIds: new Set() }, new Map(), {
      directScrapQty: 0,
      reworkFinalScrapQty: 0,
    });
    assert.equal(m.inspectedQty, 10000);
  });
});
