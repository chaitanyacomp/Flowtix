/**
 * Multi-batch item import failure: earlier batches stay committed; failed batch fully rolled back.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPreviewPayload,
  createPreviewSession,
  applyFromPreviewToken,
  IMPORT_BATCH_SIZE,
  resolveImportBatchSize,
} = require("../../src/services/tallyMasterImport/tallyMasterImportService");

describe("resolveImportBatchSize", () => {
  it("defaults to IMPORT_BATCH_SIZE (100) for the 4246-item pilot", () => {
    assert.equal(IMPORT_BATCH_SIZE, 100);
    assert.equal(resolveImportBatchSize({}), 100);
    assert.equal(resolveImportBatchSize({ importBatchSize: 5 }), 5);
  });
});

describe("item import multi-batch failure", () => {
  function stockItemsXml(count) {
    const msgs = [];
    for (let i = 1; i <= count; i += 1) {
      msgs.push(`<TALLYMESSAGE>
<STOCKITEM NAME="BatchItem ${String(i).padStart(3, "0")}">
  <NAME>BatchItem ${String(i).padStart(3, "0")}</NAME>
  <PARENT>Raw Material</PARENT>
  <BASEUNITS>Nos</BASEUNITS>
  <HSNCODE>39011010</HSNCODE>
  <GUID>guid-batch-${i}</GUID>
  <GSTDETAILS.LIST>
    <APPLICABLEFROM>20240401</APPLICABLEFROM>
    <STATEWISEDETAILS.LIST>
      <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD>
        <GSTRATE>18</GSTRATE>
      </RATEDETAILS.LIST>
    </STATEWISEDETAILS.LIST>
  </GSTDETAILS.LIST>
</STOCKITEM>
</TALLYMESSAGE>`);
    }
    return `<?xml version="1.0"?>
<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
${msgs.join("\n")}
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  }

  function makeDb({ failOnTransactionCall } = {}) {
    /** @type {any[]} */
    const itemStore = [];
    /** @type {any[]} */
    const activityStore = [];
    let txCalls = 0;
    let nextId = 1;

    const itemApi = {
      findMany: async () =>
        itemStore.map((it) => ({
          ...it,
          unit: it.unit ? { unitName: it.unit } : null,
        })),
      findUnique: async ({ where }) => itemStore.find((it) => it.id === where.id) || null,
      create: async ({ data }) => {
        const row = {
          id: nextId++,
          itemName: data.itemName,
          itemType: data.itemType,
          unit: data.unit,
          unitId: data.unitId,
          hsnCode: data.hsnCode ?? null,
          gstRate: data.gstRate ?? null,
          tallyName: data.tallyName ?? null,
          tallyGuid: data.tallyGuid ?? null,
          tallyImportedAt: data.tallyImportedAt ?? null,
        };
        itemStore.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = itemStore.find((it) => it.id === where.id);
        Object.assign(row, data);
        return row;
      },
    };

    const db = {
      state: {
        findMany: async () => [{ id: 1, stateName: "Maharashtra", stateCode: "27", isActive: true }],
      },
      customer: { findMany: async () => [], create: async () => ({}), update: async () => ({}), findUnique: async () => null },
      supplier: { findMany: async () => [], create: async () => ({}), update: async () => ({}), findUnique: async () => null },
      unit: {
        findMany: async () => [{ id: 10, unitName: "Nos", unitCode: "NOS", isActive: true }],
        create: async () => ({}),
        update: async () => ({}),
        findUnique: async () => null,
      },
      item: itemApi,
      customerDeliveryAddress: { findMany: async () => [], create: async () => ({ id: 1 }), update: async () => ({}) },
      supplierLocation: { findMany: async () => [], create: async () => ({ id: 1 }), update: async () => ({}) },
      activityLog: {
        create: async ({ data }) => {
          activityStore.push(data);
          return { id: activityStore.length, ...data };
        },
      },
      $transaction: async (fn) => {
        txCalls += 1;
        if (failOnTransactionCall && txCalls === failOnTransactionCall) {
          throw new Error("Simulated DB failure in item batch");
        }
        // Simulate transactional semantics with a snapshot rollback on throw from fn.
        const snapshot = itemStore.map((r) => ({ ...r }));
        const snapshotNext = nextId;
        try {
          return await fn({
            item: itemApi,
          });
        } catch (e) {
          itemStore.length = 0;
          itemStore.push(...snapshot);
          nextId = snapshotNext;
          throw e;
        }
      },
      _itemStore: itemStore,
      _activityStore: activityStore,
      _txCalls: () => txCalls,
    };
    return db;
  }

  it("if batch 3 fails after batches 1–2 committed: reports earlier commit, accurate counts, no partial failed batch, retryable", async () => {
    // 25 items, batch size 5 → 5 batches. Fail batch 3 (== transaction call 3 for items; units may not use $transaction).
    const xml = stockItemsXml(25);
    const db = makeDb({ failOnTransactionCall: 3 });
    const options = {
      defaultItemType: "RM",
      duplicateAction: "SKIP",
      fallbackStateId: 1,
      groupTypeOverrides: { "raw material": "RM" },
      unitMapOverrides: { nos: "Nos" },
      importBatchSize: 5,
    };

    const preview = await buildPreviewPayload(db, xml, options);
    assert.equal(preview.ok, true);
    // After mapping gate, importable creates should be 25 (Raw Material → RM, Nos → Nos).
    const createRows = preview.items.filter((r) => r.proposedAction === "CREATE");
    assert.equal(createRows.length, 25, `expected 25 CREATE rows, got ${createRows.length}; sample=${createRows[0]?.proposedAction} ${createRows[0]?.warnings}`);

    const token = createPreviewSession(xml, options);
    const result = await applyFromPreviewToken(db, token, {
      groupTypeOverrides: { "raw material": "RM" },
      unitMapOverrides: { nos: "Nos" },
      importBatchSize: 5,
      actorUser: { id: 1, name: "Admin", role: "ADMIN" },
    });

    assert.equal(result.partialCommit, true);
    assert.equal(result.itemBatching.batchesCommitted, 2);
    assert.equal(result.itemBatching.failure.failedBatchIndex, 3);
    assert.equal(result.itemBatching.failure.committedBatchesBeforeFailure, 2);
    assert.equal(result.itemBatching.earlierBatchesCommitted, true);
    assert.equal(result.itemBatching.safelyRetryable, true);

    // Batches 1–2 = 10 creates committed; batch 3 (5) + remaining 10 not committed → failed 15
    assert.equal(result.created, 10);
    assert.equal(db._itemStore.length, 10, "failed batch must not partially commit");
    assert.equal(result.failed, 15);
    assert.match(result.summaryMessage, /Earlier batches 1–2 of 5 already committed|Partial commit: item batches 1–2/i);
    assert.ok(result.warnings.some((w) => /batch 3 of 5 failed and was fully rolled back/i.test(w)));
    assert.ok(result.warnings.some((w) => /already committed/i.test(w)));

    const activity = db._activityStore[0];
    assert.ok(activity, "Activity Log row required");
    assert.equal(activity.subAction, "APPLY_PARTIAL");
    assert.match(activity.message, /2 item batch\(es\) committed before batch 3\/5 rolled back/i);
    const meta = activity.metadataJson || {};
    assert.equal(meta.itemBatchesCommitted, 2);
    assert.equal(meta.earlierBatchesCommitted, true);
    assert.equal(meta.safelyRetryable, true);
    assert.equal(meta.failedBatchIndex, 3);

    // Retry: remaining 15 should create; first 10 skip as duplicates — no double rows.
    const db2 = makeDb();
    // Seed committed rows from first run
    for (const row of db._itemStore) {
      db2._itemStore.push({ ...row });
    }
    // Keep nextId in sync
    const preview2 = await buildPreviewPayload(db2, xml, options);
    assert.equal(preview2.items.filter((r) => r.proposedAction === "SKIP_DUPLICATE").length, 10);
    assert.equal(preview2.items.filter((r) => r.proposedAction === "CREATE").length, 15);

    const token2 = createPreviewSession(xml, options);
    const retry = await applyFromPreviewToken(db2, token2, {
      groupTypeOverrides: { "raw material": "RM" },
      unitMapOverrides: { nos: "Nos" },
      importBatchSize: 5,
    });
    assert.equal(retry.partialCommit, false);
    assert.equal(retry.created, 15);
    assert.equal(db2._itemStore.length, 25);
    const names = db2._itemStore.map((r) => r.itemName);
    assert.equal(new Set(names).size, 25, "retry must not create duplicate item names");
  });
});
