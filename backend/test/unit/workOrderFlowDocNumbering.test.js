const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

/**
 * Unit tests for flow-wise Work Order numbering.
 * Uses a lightweight DocSequence upsert mock — no DB required.
 */

const {
  allocateWorkOrderDocNo,
  allocateDocNo,
  formatDocNo,
  year2FromDate,
  WORK_ORDER_FLOW,
  WORK_ORDER_FLOW_PREFIX,
  resolveWorkOrderFlowFromSalesOrderType,
  normalizeWorkOrderFlow,
  isLegacyWorkOrderDocNo,
  isFlowWorkOrderDocNo,
  prefixForDocType,
} = require("../../src/services/docNoService");

/** In-memory DocSequence store keyed by `${docType}:${year2}`. Serialized like a TX row lock. */
function createSequenceTx(initial = new Map()) {
  const store = new Map(initial);
  let gate = Promise.resolve();
  return {
    docSequence: {
      async upsert({ where, create, update, select }) {
        const run = gate.then(async () => {
          const docType = where.docType_year2.docType;
          const year2 = where.docType_year2.year2;
          const key = `${docType}:${year2}`;
          let row = store.get(key);
          if (!row) {
            row = { docType, year2, nextNumber: create.nextNumber };
            store.set(key, row);
          } else {
            row.nextNumber += update.nextNumber.increment;
          }
          const out = {};
          for (const k of Object.keys(select)) {
            if (select[k]) out[k] = row[k];
          }
          return out;
        });
        gate = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    },
    _store: store,
  };
}

describe("flow-wise Work Order numbering", () => {
  it("resolves flow from authoritative SO orderType only", () => {
    assert.equal(resolveWorkOrderFlowFromSalesOrderType("NO_QTY"), WORK_ORDER_FLOW.NO_QTY);
    assert.equal(resolveWorkOrderFlowFromSalesOrderType("NORMAL"), WORK_ORDER_FLOW.REGULAR_SO);
    assert.equal(resolveWorkOrderFlowFromSalesOrderType("REPLACEMENT"), WORK_ORDER_FLOW.REGULAR_SO);
    assert.equal(resolveWorkOrderFlowFromSalesOrderType(null), WORK_ORDER_FLOW.REGULAR_SO);
    assert.equal(normalizeWorkOrderFlow("GREEN_LEVEL"), WORK_ORDER_FLOW.GREEN_LEVEL);
  });

  it("formats first WO in each flow for the same year", async () => {
    const tx = createSequenceTx();
    const date = new Date("2026-07-15T12:00:00Z");
    const regular = await allocateWorkOrderDocNo(tx, { flow: WORK_ORDER_FLOW.REGULAR_SO, date });
    const noQty = await allocateWorkOrderDocNo(tx, { flow: WORK_ORDER_FLOW.NO_QTY, date });
    const green = await allocateWorkOrderDocNo(tx, { flow: WORK_ORDER_FLOW.GREEN_LEVEL, date });
    assert.equal(regular, "WO-R-26-0001");
    assert.equal(noQty, "WO-NQ-26-0001");
    assert.equal(green, "WO-GL-26-0001");
  });

  it("increments next WO independently within each flow", async () => {
    const tx = createSequenceTx();
    const date = new Date("2026-03-01T00:00:00Z");
    assert.equal(await allocateWorkOrderDocNo(tx, { flow: "REGULAR_SO", date }), "WO-R-26-0001");
    assert.equal(await allocateWorkOrderDocNo(tx, { flow: "REGULAR_SO", date }), "WO-R-26-0002");
    assert.equal(await allocateWorkOrderDocNo(tx, { flow: "NO_QTY", date }), "WO-NQ-26-0001");
    assert.equal(await allocateWorkOrderDocNo(tx, { flow: "NO_QTY", date }), "WO-NQ-26-0002");
    assert.equal(await allocateWorkOrderDocNo(tx, { flow: "REGULAR_SO", date }), "WO-R-26-0003");
  });

  it("keeps strict flow isolation — Regular sequence never advances NO_QTY/Green Level", async () => {
    const tx = createSequenceTx();
    const date = new Date("2026-01-10T00:00:00Z");
    for (let i = 0; i < 5; i += 1) {
      await allocateWorkOrderDocNo(tx, { flow: WORK_ORDER_FLOW.REGULAR_SO, date });
    }
    assert.equal(await allocateWorkOrderDocNo(tx, { flow: WORK_ORDER_FLOW.NO_QTY, date }), "WO-NQ-26-0001");
    assert.equal(await allocateWorkOrderDocNo(tx, { flow: WORK_ORDER_FLOW.GREEN_LEVEL, date }), "WO-GL-26-0001");
    assert.equal(await allocateWorkOrderDocNo(tx, { flow: WORK_ORDER_FLOW.REGULAR_SO, date }), "WO-R-26-0006");
  });

  it("supports simultaneous WO creation without duplicate numbers in a flow", async () => {
    const tx = createSequenceTx();
    const date = new Date("2026-06-01T00:00:00Z");
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        allocateWorkOrderDocNo(tx, { flow: WORK_ORDER_FLOW.NO_QTY, date }),
      ),
    );
    const unique = new Set(results);
    assert.equal(unique.size, 20);
    assert.ok(results.includes("WO-NQ-26-0001"));
    assert.ok(results.includes("WO-NQ-26-0020"));
  });

  it("rolls over to a new independent sequence on financial (calendar) year change", async () => {
    const tx = createSequenceTx();
    assert.equal(
      await allocateWorkOrderDocNo(tx, {
        flow: WORK_ORDER_FLOW.REGULAR_SO,
        date: new Date("2026-12-31T12:00:00Z"),
      }),
      "WO-R-26-0001",
    );
    assert.equal(
      await allocateWorkOrderDocNo(tx, {
        flow: WORK_ORDER_FLOW.REGULAR_SO,
        date: new Date("2027-01-01T12:00:00Z"),
      }),
      "WO-R-27-0001",
    );
    assert.equal(
      await allocateWorkOrderDocNo(tx, {
        flow: WORK_ORDER_FLOW.REGULAR_SO,
        date: new Date("2026-12-31T18:00:00Z"),
      }),
      "WO-R-26-0002",
    );
  });

  it("preserves legacy WO-YY-#### compatibility helpers without renumbering", () => {
    assert.equal(isLegacyWorkOrderDocNo("WO-26-0001"), true);
    assert.equal(isLegacyWorkOrderDocNo("WO-R-26-0001"), false);
    assert.equal(isFlowWorkOrderDocNo("WO-R-26-0001"), true);
    assert.equal(isFlowWorkOrderDocNo("WO-NQ-26-0042"), true);
    assert.equal(isFlowWorkOrderDocNo("WO-GL-27-0001"), true);
    assert.equal(isFlowWorkOrderDocNo("WO-26-0001"), false);
    // Legacy DocType.WORK_ORDER prefix remains WO for historical sequence rows.
    assert.equal(prefixForDocType("WORK_ORDER"), "WO");
    assert.equal(formatDocNo("WO", 26, 7), "WO-26-0007");
  });

  it("does not collide flow numbers with legacy shared WORK_ORDER series", async () => {
    const tx = createSequenceTx();
    const date = new Date("2026-05-01T00:00:00Z");
    // Simulate pre-existing legacy allocator usage (should not be used for new creates).
    const legacy = await allocateDocNo(tx, { docType: "WORK_ORDER", date });
    assert.equal(legacy, "WO-26-0001");
    const flow = await allocateWorkOrderDocNo(tx, { flow: WORK_ORDER_FLOW.REGULAR_SO, date });
    assert.equal(flow, "WO-R-26-0001");
    assert.notEqual(legacy, flow);
  });

  it("year2FromDate uses calendar year (same basis as other doc series)", () => {
    assert.equal(year2FromDate(new Date("2026-04-01T00:00:00Z")), 26);
    assert.equal(year2FromDate(new Date("2025-03-31T00:00:00Z")), 25);
  });

  it("exposes stable flow prefixes", () => {
    assert.equal(WORK_ORDER_FLOW_PREFIX.REGULAR_SO, "WO-R");
    assert.equal(WORK_ORDER_FLOW_PREFIX.NO_QTY, "WO-NQ");
    assert.equal(WORK_ORDER_FLOW_PREFIX.GREEN_LEVEL, "WO-GL");
  });
});
