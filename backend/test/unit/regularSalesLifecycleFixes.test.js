const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  ACTIVE_ENQUIRY_STATUSES,
  parseEnquiryListScope,
  enquiryListWhereForScope,
} = require("../../src/services/enquiryListScope");
const {
  restoreEnquiryQuotedAfterLinkedSoDeleted,
  restoreOrphanClosedEnquiriesForRetainedApprovedQuotations,
  reopenEnquiryToFeasibleAfterQuotationRollback,
} = require("../../src/services/enquiryQuotationLifecycle");
const {
  assertFromQuotationCustomerPoQuantities,
  normalizeSalesOrderDraftLineQuantities,
} = require("../../src/services/regularSoBufferQty");

describe("enquiryListScope", () => {
  it("parses active vs history/all", () => {
    assert.equal(parseEnquiryListScope("active"), "active");
    assert.equal(parseEnquiryListScope("ACTIVE"), "active");
    assert.equal(parseEnquiryListScope("history"), "history");
    assert.equal(parseEnquiryListScope("all"), "history");
    assert.equal(parseEnquiryListScope(undefined), "history");
    assert.equal(parseEnquiryListScope(""), "history");
  });

  it("active where excludes CLOSED; history has no status filter", () => {
    const active = enquiryListWhereForScope("active");
    assert.deepEqual(active.status.in, [...ACTIVE_ENQUIRY_STATUSES]);
    assert.ok(!active.status.in.includes("CLOSED"));
    assert.ok(!active.status.in.includes("NOT_FEASIBLE"));
    assert.ok(!active.status.in.includes("PO_RECEIVED"));
    assert.deepEqual(enquiryListWhereForScope("history"), {});
  });
});

describe("restoreEnquiryQuotedAfterLinkedSoDeleted", () => {
  it("sets CLOSED enquiry to QUOTED when approved quotation has no remaining SO", async () => {
    let enquiryStatus = "CLOSED";
    const tx = {
      quotation: {
        findUnique: async () => ({
          id: 1,
          workflowStatus: "APPROVED",
          enquiryId: 10,
          salesOrder: null,
        }),
      },
      enquiry: {
        findUnique: async () => ({ id: 10, status: enquiryStatus }),
        update: async ({ data }) => {
          enquiryStatus = data.status;
          return { id: 10, status: enquiryStatus };
        },
      },
    };
    const out = await restoreEnquiryQuotedAfterLinkedSoDeleted(tx, { quotationId: 1, enquiryId: 10 });
    assert.equal(out.restored, true);
    assert.equal(out.fromStatus, "CLOSED");
    assert.equal(out.toStatus, "QUOTED");
    assert.equal(enquiryStatus, "QUOTED");
  });

  it("does not reopen when another SO still exists on the quotation", async () => {
    let updateCount = 0;
    const tx = {
      quotation: {
        findUnique: async () => ({
          id: 1,
          workflowStatus: "APPROVED",
          enquiryId: 10,
          salesOrder: { id: 99 },
        }),
      },
      enquiry: {
        findUnique: async () => ({ id: 10, status: "CLOSED" }),
        update: async () => {
          updateCount += 1;
        },
      },
    };
    const out = await restoreEnquiryQuotedAfterLinkedSoDeleted(tx, { quotationId: 1 });
    assert.equal(out.restored, false);
    assert.equal(updateCount, 0);
  });

  it("leaves quotation Undo Approval path targeting FEASIBLE unchanged", async () => {
    let status = "CLOSED";
    const tx = {
      enquiry: {
        findUnique: async () => ({ id: 10, status }),
        update: async ({ data }) => {
          status = data.status;
          return { id: 10, status };
        },
      },
    };
    await reopenEnquiryToFeasibleAfterQuotationRollback(tx, 10);
    assert.equal(status, "FEASIBLE");
  });
});

describe("restoreOrphanClosedEnquiriesForRetainedApprovedQuotations", () => {
  it("restores CLOSED when quotation retained without SO", async () => {
    /** @type {Array<{ id: number; status: string }>} */
    const enquiries = [
      { id: 1, status: "CLOSED" },
      { id: 2, status: "FEASIBLE" },
    ];
    const tx = {
      quotation: {
        findMany: async () => [
          { id: 11, enquiryId: 1, enquiry: enquiries[0] },
          { id: 12, enquiryId: 2, enquiry: enquiries[1] },
        ],
      },
      enquiry: {
        update: async ({ where, data }) => {
          const row = enquiries.find((e) => e.id === where.id);
          if (row) row.status = data.status;
          return row;
        },
      },
    };
    const out = await restoreOrphanClosedEnquiriesForRetainedApprovedQuotations(tx, {
      quotationIds: [11, 12],
    });
    assert.deepEqual(out.restoredEnquiryIds, [1]);
    assert.equal(enquiries[0].status, "QUOTED");
    assert.equal(enquiries[1].status, "FEASIBLE");
  });
});

describe("assertFromQuotationCustomerPoQuantities", () => {
  const qLines = [
    { itemId: 1, qty: 15000 },
    { itemId: 2, qty: 100 },
  ];

  it("accepts equal and lower qty", () => {
    assert.doesNotThrow(() =>
      assertFromQuotationCustomerPoQuantities(qLines, [
        { itemId: 1, customerPoQty: 15000 },
        { itemId: 2, customerPoQty: 50 },
      ]),
    );
  });

  it("rejects over-quoted qty with 422 and quoted/entered in message", () => {
    assert.throws(
      () =>
        assertFromQuotationCustomerPoQuantities(qLines, [
          { itemId: 1, customerPoQty: 20000 },
          { itemId: 2, customerPoQty: 50 },
        ]),
      (err) => {
        assert.equal(err.statusCode, 422);
        assert.equal(err.code, "SO_QTY_EXCEEDS_QUOTATION");
        assert.match(String(err.message), /20000/);
        assert.match(String(err.message), /15000/);
        return true;
      },
    );
  });

  it("rejects wrong item order", () => {
    assert.throws(
      () =>
        assertFromQuotationCustomerPoQuantities(qLines, [
          { itemId: 2, customerPoQty: 50 },
          { itemId: 1, customerPoQty: 100 },
        ]),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "SO_LINE_ITEM_MISMATCH");
        return true;
      },
    );
  });

  it("aggregates duplicate item lines defensively", () => {
    const dupQuote = [
      { itemId: 1, qty: 100 },
      { itemId: 1, qty: 50 },
    ];
    assert.throws(
      () =>
        assertFromQuotationCustomerPoQuantities(dupQuote, [
          { itemId: 1, customerPoQty: 100 },
          { itemId: 1, customerPoQty: 60 },
        ]),
      (err) => {
        // Per-line second exceeds its own 50 first; or aggregate 160 > 150
        assert.equal(err.statusCode, 422);
        return true;
      },
    );
  });

  it("buffer percent does not increase customer ordered qty on NORMAL normalize", () => {
    const n = normalizeSalesOrderDraftLineQuantities(
      { customerPoQty: 15000, bufferPercent: 10 },
      "NORMAL",
      20,
    );
    assert.equal(n.customerPoQty, 15000);
    assert.equal(n.plannedQty, 15000);
    assert.equal(n.bufferPercent, 0);
  });
});
