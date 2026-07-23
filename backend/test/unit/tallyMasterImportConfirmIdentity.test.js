/**
 * Tally master import: identity backfill, matching, and confirm resilience.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveExistingPartyMatch,
  tallyIdentityBackfillPatch,
  formatImportRowError,
  buildPreviewPayload,
  applyFromPreviewToken,
  createPreviewSession,
} = require("../../src/services/tallyMasterImport/tallyMasterImportService");

describe("resolveExistingPartyMatch", () => {
  it("prefers tallyGuid over name and GSTIN", () => {
    const byGuid = new Map([["guid-a", { id: 1, name: "A", tallyGuid: "guid-a" }]]);
    const byName = new Map([["b", { id: 2, name: "B" }]]);
    const byGstin = new Map([["27AAAAA0000A1Z5", { id: 3, name: "C" }]]);
    const r = resolveExistingPartyMatch({
      tallyGuid: "GUID-A",
      tallyName: "B",
      displayName: "B",
      gstNorm: "27AAAAA0000A1Z5",
      byGuid,
      byTallyName: new Map(),
      byDisplayName: byName,
      byGstin,
      entityLabel: "Supplier",
    });
    assert.equal(r.match.id, 1);
    assert.equal(r.ambiguous, false);
    assert.ok(r.matchVia.includes("tallyGuid"));
  });

  it("marks ambiguous when name and GSTIN resolve to different parties", () => {
    const byName = new Map([["abc", { id: 10, name: "ABC" }]]);
    const byGstin = new Map([["27AAAAA0000A1Z5", { id: 20, name: "XYZ" }]]);
    const r = resolveExistingPartyMatch({
      tallyGuid: null,
      tallyName: "ABC",
      displayName: "ABC",
      gstNorm: "27AAAAA0000A1Z5",
      byGuid: new Map(),
      byTallyName: new Map(),
      byDisplayName: byName,
      byGstin,
      entityLabel: "Supplier",
    });
    assert.equal(r.match, null);
    assert.equal(r.ambiguous, true);
    assert.match(r.error, /Ambiguous match/i);
    assert.match(r.error, /ABC/);
    assert.match(r.error, /XYZ/);
  });
});

describe("tallyIdentityBackfillPatch", () => {
  it("updates only empty tally identity fields", () => {
    const patch = tallyIdentityBackfillPatch(
      { tallyName: null, tallyGuid: null, tallyImportedAt: null },
      { tallyName: "Acme Ledger", tallyGuid: "g-1" },
    );
    assert.equal(patch.tallyName, "Acme Ledger");
    assert.equal(patch.tallyGuid, "g-1");
    assert.ok(patch.tallyImportedAt instanceof Date);
    assert.equal(Object.keys(patch).includes("address"), false);
  });

  it("does not overwrite existing tallyName", () => {
    const patch = tallyIdentityBackfillPatch(
      { tallyName: "Existing", tallyGuid: null, tallyImportedAt: new Date() },
      { tallyName: "New", tallyGuid: "g-2" },
    );
    assert.equal(patch.tallyName, undefined);
    assert.equal(patch.tallyGuid, "g-2");
  });
});

describe("formatImportRowError", () => {
  it("formats supplier GSTIN conflict clearly", () => {
    const msg = formatImportRowError("Supplier", "ABC", "GSTIN", "GSTIN already belongs to Supplier 'XYZ'.");
    assert.equal(msg, "Supplier 'ABC': GSTIN — GSTIN already belongs to Supplier 'XYZ'.");
  });
});

describe("buildPreviewPayload / applyFromPreviewToken", () => {
  const LEDGER_XML = `<?xml version="1.0"?>
<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE>
<LEDGER NAME="Dup Supplier" RESERVEDNAME="">
  <NAME.LIST><NAME>Dup Supplier</NAME></NAME.LIST>
  <PARENT>Sundry Creditors</PARENT>
  <MAILINGNAME.LIST><MAILINGNAME>Dup Supplier</MAILINGNAME></MAILINGNAME.LIST>
  <LEDGERGSTIN.LIST><LEDGERGSTIN>27AAAAA0000A1Z5</LEDGERGSTIN></LEDGERGSTIN.LIST>
  <PRIORSTATENAME>Maharashtra</PRIORSTATENAME>
  <GUID>sup-guid-1</GUID>
</LEDGER>
</TALLYMESSAGE>
<TALLYMESSAGE>
<LEDGER NAME="New No State" RESERVEDNAME="">
  <NAME.LIST><NAME>New No State</NAME></NAME.LIST>
  <PARENT>Sundry Creditors</PARENT>
</LEDGER>
</TALLYMESSAGE>
<TALLYMESSAGE>
<LEDGER NAME="Cust One" RESERVEDNAME="">
  <NAME.LIST><NAME>Cust One</NAME></NAME.LIST>
  <PARENT>Sundry Debtors</PARENT>
  <GUID>cust-guid-1</GUID>
</LEDGER>
</TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

  function makeDb(existingSuppliers = [], existingCustomers = []) {
    const supplierStore = existingSuppliers.map((s) => ({ ...s }));
    const customerStore = existingCustomers.map((c) => ({ ...c }));
    return {
      state: {
        findMany: async () => [{ id: 1, stateName: "Maharashtra", stateCode: "27", isActive: true }],
      },
      customer: {
        findMany: async () => customerStore,
        findUnique: async ({ where }) => customerStore.find((c) => c.id === where.id) || null,
        update: async ({ where, data }) => {
          const row = customerStore.find((c) => c.id === where.id);
          Object.assign(row, data);
          return row;
        },
        create: async ({ data }) => {
          const row = { id: 900 + customerStore.length, ...data };
          customerStore.push(row);
          return row;
        },
      },
      supplier: {
        findMany: async () => supplierStore,
        findUnique: async ({ where }) => supplierStore.find((s) => s.id === where.id) || null,
        update: async ({ where, data }) => {
          const row = supplierStore.find((s) => s.id === where.id);
          Object.assign(row, data);
          return row;
        },
        create: async ({ data }) => {
          const row = { id: 800 + supplierStore.length, ...data };
          supplierStore.push(row);
          return row;
        },
      },
      item: { findMany: async () => [] },
      unit: { findMany: async () => [] },
      customerDeliveryAddress: {
        findFirst: async () => null,
        create: async () => ({ id: 1 }),
        update: async () => ({}),
      },
      supplierLocation: {
        findFirst: async () => null,
        create: async () => ({ id: 1 }),
        update: async () => ({}),
      },
      _supplierStore: supplierStore,
      _customerStore: customerStore,
    };
  }

  it("XML without stock items reports clearly and SKIP_DUPLICATE does not block", async () => {
    const db = makeDb(
      [{ id: 5, name: "Dup Supplier", gst: "27AAAAA0000A1Z5", address: "Pune", stateId: 1, contact: "X", email: "a@b.com", tallyName: null, tallyGuid: null }],
      [{ id: 2, name: "Cust One", gst: null, address: null, stateId: null, contact: null, email: null, tallyName: null, tallyGuid: null }],
    );
    const preview = await buildPreviewPayload(db, LEDGER_XML, {
      defaultItemType: "FG",
      duplicateAction: "SKIP",
      fallbackStateId: null,
    });
    assert.equal(preview.ok, true);
    assert.ok(preview.infoNotes.some((n) => /no Stock Items or Units/i.test(n)));
    const dup = preview.suppliers.find((s) => s.tallyName === "Dup Supplier");
    assert.equal(dup.proposedAction, "SKIP_DUPLICATE");
    assert.equal(dup.status, "WARNING");
    const missingState = preview.suppliers.find((s) => s.tallyName === "New No State");
    assert.equal(missingState.proposedAction, "ERROR");
    assert.ok(missingState.errors.some((e) => /State/i.test(e)));
    assert.ok(preview.blockingErrorCount >= 1);
    // Duplicates are warnings — not counted as the sole blocker of confirm
    assert.ok(preview.summary.suppliers.skip >= 1);
  });

  it("duplicate ledger backfills tallyName/tallyGuid on confirm and leaves invalid supplier unresolved", async () => {
    const db = makeDb(
      [
        {
          id: 5,
          name: "Dup Supplier",
          gst: "27AAAAA0000A1Z5",
          address: "Pune",
          stateId: 1,
          stateName: "Maharashtra",
          stateCode: "27",
          contact: "X",
          email: "a@b.com",
          tallyName: null,
          tallyGuid: null,
          tallyImportedAt: null,
        },
      ],
      [
        {
          id: 2,
          name: "Cust One",
          gst: null,
          address: null,
          stateId: null,
          contact: null,
          email: null,
          tallyName: null,
          tallyGuid: null,
          tallyImportedAt: null,
        },
      ],
    );
    const token = createPreviewSession(LEDGER_XML, {
      defaultItemType: "FG",
      duplicateAction: "SKIP",
      fallbackStateId: null,
    });
    const result = await applyFromPreviewToken(db, token);
    assert.equal(result.ok, true);
    const dup = db._supplierStore.find((s) => s.id === 5);
    assert.equal(dup.tallyName, "Dup Supplier");
    assert.equal(dup.tallyGuid, "sup-guid-1");
    assert.ok(dup.tallyImportedAt);
    assert.equal(dup.address, "Pune"); // business data unchanged
    const unresolved = result.results.filter((r) => r.tallyName === "New No State");
    assert.ok(unresolved.length === 1);
    assert.equal(unresolved[0].action, "SKIPPED");
    assert.match(String(unresolved[0].error || ""), /State|unresolved/i);
    // Retry is idempotent: session consumed after successful apply
    await assert.rejects(() => applyFromPreviewToken(db, token), /already imported|expired|invalid/i);
  });

  it("ambiguous match requires mapping (ERROR) and does not invent a party", async () => {
    const db = makeDb(
      [
        { id: 10, name: "ABC", gst: null, address: null, stateId: 1, contact: null, email: null, tallyName: null, tallyGuid: null },
        { id: 20, name: "XYZ", gst: "27ALSKD1412A1Z5", address: null, stateId: 1, contact: null, email: null, tallyName: null, tallyGuid: null },
      ],
      [],
    );
    const xml = `<?xml version="1.0"?>
<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE>
<LEDGER NAME="ABC" RESERVEDNAME="">
  <NAME.LIST><NAME>ABC</NAME></NAME.LIST>
  <PARENT>Sundry Creditors</PARENT>
  <LEDGERGSTIN.LIST><LEDGERGSTIN>27ALSKD1412A1Z5</LEDGERGSTIN></LEDGERGSTIN.LIST>
  <PRIORSTATENAME>Maharashtra</PRIORSTATENAME>
</LEDGER>
</TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const preview = await buildPreviewPayload(db, xml, {
      defaultItemType: "FG",
      duplicateAction: "SKIP",
      fallbackStateId: 1,
    });
    const row = preview.suppliers.find((s) => s.tallyName === "ABC");
    assert.ok(row, "ABC supplier row missing");
    assert.equal(row.proposedAction, "ERROR");
    assert.match(row.errors.join(" "), /Ambiguous match/i);
  });
});
