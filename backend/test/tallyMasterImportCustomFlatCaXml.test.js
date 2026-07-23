/**
 * Custom Tally report export (CAACCTYPENAME / CALEDGERPARENT) — UTF-16 LE fixtures.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  parseTallyMastersXml,
  decodeXmlFromBuffer,
  CUSTOM_FLAT_CA_SOURCE,
} = require("../src/services/tallyMasterImport/parseTallyMastersXml");
const {
  mapLedgerToParty,
  extractOpeningBalance,
} = require("../src/services/tallyMasterImport/mapLedgerToParty");
const {
  buildPreviewPayload,
  createPreviewSession,
  applyFromPreviewToken,
} = require("../src/services/tallyMasterImport/tallyMasterImportService");

const FIXTURES = path.join(__dirname, "fixtures", "tally");
const DEBTORS_FIXTURE = path.join(FIXTURES, "sundry-debtors-custom-flat.xml");
const CREDITORS_FIXTURE = path.join(FIXTURES, "sundry-creditors-custom-flat.xml");

/** @returns {Buffer} UTF-16 LE with BOM */
function utf16LeBom(xmlUtf8) {
  const body = Buffer.from(xmlUtf8, "utf16le");
  return Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
}

function mockDbEmpty() {
  return {
    state: {
      findMany: async () => [
        { id: 1, stateName: "Maharashtra", stateCode: "27" },
      ],
    },
    customer: {
      findMany: async () => [],
      create: async ({ data }) => ({ id: Math.floor(Math.random() * 1e6) + 1, ...data }),
      update: async ({ data, where }) => ({ id: where.id, ...data }),
    },
    supplier: {
      findMany: async () => [],
      create: async ({ data }) => ({ id: Math.floor(Math.random() * 1e6) + 1, ...data }),
      update: async ({ data, where }) => ({ id: where.id, ...data }),
    },
    item: { findMany: async () => [] },
    unit: { findMany: async () => [] },
    $transaction: async (fn) => fn(mockDbEmpty()),
  };
}

describe("custom flat CA* ledger XML (UTF-16 LE)", () => {
  test("decodeXmlFromBuffer: FF FE = UTF-16 LE, FE FF = UTF-16 BE, EF BB BF = UTF-8 BOM", () => {
    const sample = "<ENVELOPE><CAACCTYPENAME>X</CAACCTYPENAME></ENVELOPE>";
    const le = utf16LeBom(sample);
    assert.equal(le[0], 0xff);
    assert.equal(le[1], 0xfe);
    assert.match(decodeXmlFromBuffer(le), /CAACCTYPENAME/);

    const bePairs = Buffer.from(sample, "utf16le");
    const be = Buffer.alloc(2 + bePairs.length);
    be[0] = 0xfe;
    be[1] = 0xff;
    for (let i = 0; i < bePairs.length; i += 2) {
      be[2 + i] = bePairs[i + 1];
      be[2 + i + 1] = bePairs[i];
    }
    assert.match(decodeXmlFromBuffer(be), /CAACCTYPENAME/);

    const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(sample, "utf8")]);
    assert.equal(decodeXmlFromBuffer(utf8Bom), sample);
  });

  test("representative UTF-16 LE mini fixture: entities, empty OPBAL, excluded parent", () => {
    const xml = `<?xml version="1.0"?>
<ENVELOPE>
 <CALEDGERSLNO>1</CALEDGERSLNO>
 <CAACCTYPENAME>Tools &amp; Hardware</CAACCTYPENAME>
 <CALEDGERPARENT>Sundry Creditors</CALEDGERPARENT>
 <CALEDGEROPBAL></CALEDGEROPBAL>
 <CALEDGERSLNO>2</CALEDGERSLNO>
 <CAACCTYPENAME>Deflash Worker</CAACCTYPENAME>
 <CALEDGERPARENT>Deflashing Charges</CALEDGERPARENT>
 <CALEDGEROPBAL>100.000</CALEDGEROPBAL>
 <CALEDGERSLNO>3</CALEDGERSLNO>
 <CAACCTYPENAME>Buyer One</CAACCTYPENAME>
 <CALEDGERPARENT>Sundry Debtors</CALEDGERPARENT>
 <CALEDGEROPBAL>250.500</CALEDGEROPBAL>
</ENVELOPE>`;
    const buf = utf16LeBom(xml);
    const decoded = decodeXmlFromBuffer(buf);
    const parsed = parseTallyMastersXml(decoded);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.parseStats.customFlatRowsDetected, 3);
    assert.equal(parsed.ledgers.length, 3);
    assert.equal(parsed.ledgers[0]._tallySourceFormat, CUSTOM_FLAT_CA_SOURCE);

    const tools = mapLedgerToParty(parsed.ledgers[0], "SUPPLIER");
    assert.ok(tools);
    assert.equal(tools.tallyName, "Tools & Hardware");
    assert.equal(tools.openingBalance, 0);
    assert.equal(tools.sourceSerial, "1");

    assert.equal(mapLedgerToParty(parsed.ledgers[1], "SUPPLIER"), null);
    assert.equal(mapLedgerToParty(parsed.ledgers[1], "CUSTOMER"), null);

    const buyer = mapLedgerToParty(parsed.ledgers[2], "CUSTOMER");
    assert.ok(buyer);
    assert.equal(buyer.openingBalance, 250.5);
    assert.equal(extractOpeningBalance(parsed.ledgers[0]), 0);
  });

  test("Sundry Debtors fixture: UTF-16 LE BOM, 182 customers, no suppliers", async () => {
    assert.ok(fs.existsSync(DEBTORS_FIXTURE), `missing ${DEBTORS_FIXTURE}`);
    const buf = fs.readFileSync(DEBTORS_FIXTURE);
    assert.equal(buf[0], 0xff);
    assert.equal(buf[1], 0xfe);

    const xml = decodeXmlFromBuffer(buf);
    const parsed = parseTallyMastersXml(xml);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.parseStats.customFlatRowsDetected, 182);
    assert.equal(parsed.ledgers.length, 182);
    assert.equal(parsed.parseStats.ledgerOpenInRaw, 0);

    const customers = parsed.ledgers.map((l) => mapLedgerToParty(l, "CUSTOMER")).filter(Boolean);
    const suppliers = parsed.ledgers.map((l) => mapLedgerToParty(l, "SUPPLIER")).filter(Boolean);
    assert.equal(customers.length, 182);
    assert.equal(suppliers.length, 0);

    const emptyOp = parsed.ledgers.filter((l) => extractOpeningBalance(l) === 0);
    assert.ok(emptyOp.length >= 150, "most debtors have empty OPBAL → 0");

    const preview = await buildPreviewPayload(mockDbEmpty(), xml, {
      defaultItemType: "FG",
      fallbackStateId: 1,
      duplicateAction: "SKIP",
    });
    assert.equal(preview.ok, true);
    assert.equal(preview.summary.partyRows.totalRowsDetected, 182);
    assert.equal(preview.summary.partyRows.eligibleCustomers, 182);
    assert.equal(preview.summary.partyRows.eligibleSuppliers, 0);
    assert.equal(preview.summary.partyRows.excludedParentGroup, 0);
    assert.equal(preview.customers.length, 182);
    assert.equal(preview.summary.customers.create, 182);
  });

  test("Sundry Creditors fixture: 310 rows, 299 eligible suppliers, 11 excluded parents", async () => {
    assert.ok(fs.existsSync(CREDITORS_FIXTURE), `missing ${CREDITORS_FIXTURE}`);
    const buf = fs.readFileSync(CREDITORS_FIXTURE);
    assert.equal(buf[0], 0xff);
    assert.equal(buf[1], 0xfe);

    const xml = decodeXmlFromBuffer(buf);
    const parsed = parseTallyMastersXml(xml);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.parseStats.customFlatRowsDetected, 310);
    assert.equal(parsed.ledgers.length, 310);

    const suppliers = parsed.ledgers.map((l) => mapLedgerToParty(l, "SUPPLIER")).filter(Boolean);
    const customers = parsed.ledgers.map((l) => mapLedgerToParty(l, "CUSTOMER")).filter(Boolean);
    assert.equal(suppliers.length, 299);
    assert.equal(customers.length, 0);

    const excluded = parsed.ledgers.filter(
      (l) => !mapLedgerToParty(l, "SUPPLIER") && !mapLedgerToParty(l, "CUSTOMER"),
    );
    assert.equal(excluded.length, 11);
    assert.ok(excluded.some((l) => String(l.PARENT).includes("Deflashing")));

    const withAmp = suppliers.find((s) => s.tallyName.includes("&"));
    assert.ok(withAmp, "XML entities like &amp; must decode to &");

    const preview = await buildPreviewPayload(mockDbEmpty(), xml, {
      defaultItemType: "FG",
      fallbackStateId: 1,
      duplicateAction: "SKIP",
    });
    assert.equal(preview.ok, true);
    assert.equal(preview.summary.partyRows.totalRowsDetected, 310);
    assert.equal(preview.summary.partyRows.eligibleSuppliers, 299);
    assert.equal(preview.summary.partyRows.eligibleCustomers, 0);
    assert.equal(preview.summary.partyRows.excludedParentGroup, 11);
    assert.equal(preview.suppliers.length, 299);
    assert.equal(preview.summary.suppliers.create, 299);
  });

  test("standard LEDGER format still works alongside custom flat support", () => {
    const xml = `<?xml version="1.0"?>
<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE>
<LEDGER NAME="Classic Debtor">
  <NAME>Classic Debtor</NAME>
  <PARENT>Sundry Debtors</PARENT>
</LEDGER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const parsed = parseTallyMastersXml(xml);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.parseStats.customFlatRowsDetected, 0);
    assert.equal(parsed.ledgers.length, 1);
    const cust = mapLedgerToParty(parsed.ledgers[0], "CUSTOMER");
    assert.ok(cust);
    assert.equal(cust.tallyName, "Classic Debtor");
  });

  test("import is idempotent: second apply skips duplicates (no double create)", async () => {
    const xml = decodeXmlFromBuffer(utf16LeBom(`<?xml version="1.0"?>
<ENVELOPE>
 <CALEDGERSLNO>1</CALEDGERSLNO>
 <CAACCTYPENAME>Idempotent Party</CAACCTYPENAME>
 <CALEDGERPARENT>Sundry Debtors</CALEDGERPARENT>
 <CALEDGEROPBAL></CALEDGEROPBAL>
</ENVELOPE>`));

    /** @type {any[]} */
    const customerStore = [];
    let createCalls = 0;

    const db = {
      state: {
        findMany: async () => [{ id: 1, stateName: "Maharashtra", stateCode: "27", isActive: true }],
      },
      customer: {
        findMany: async () => customerStore.map((c) => ({ ...c, state: null })),
        findUnique: async ({ where }) => customerStore.find((c) => c.id === where.id) || null,
        create: async ({ data }) => {
          createCalls += 1;
          const row = {
            id: 1000 + customerStore.length,
            name: data.name,
            tallyName: data.tallyName ?? null,
            tallyGuid: data.tallyGuid ?? null,
            gst: data.gst ?? null,
            address: data.address ?? null,
            stateId: data.stateId ?? null,
            contact: data.contact ?? null,
            email: data.email ?? null,
            tallyImportedAt: data.tallyImportedAt ?? null,
          };
          customerStore.push(row);
          return row;
        },
        update: async ({ where, data }) => {
          const cur = customerStore.find((c) => c.id === where.id);
          Object.assign(cur, data);
          return cur;
        },
      },
      supplier: {
        findMany: async () => [],
        findUnique: async () => null,
        create: async () => ({}),
        update: async () => ({}),
      },
      item: { findMany: async () => [] },
      unit: { findMany: async () => [] },
      customerDeliveryAddress: {
        findMany: async () => [],
        findFirst: async () => null,
        create: async () => ({ id: 1 }),
        update: async () => ({}),
      },
      supplierLocation: {
        findMany: async () => [],
        findFirst: async () => null,
        create: async () => ({ id: 1 }),
        update: async () => ({}),
      },
    };

    const options = { defaultItemType: "FG", fallbackStateId: 1, duplicateAction: "SKIP" };
    const preview1 = await buildPreviewPayload(db, xml, options);
    assert.equal(preview1.customers.length, 1);
    assert.equal(preview1.customers[0].proposedAction, "CREATE");
    const token1 = createPreviewSession(xml, options);
    const apply1 = await applyFromPreviewToken(db, token1);
    assert.equal(apply1.created, 1);
    assert.equal(createCalls, 1);

    const preview2 = await buildPreviewPayload(db, xml, options);
    assert.equal(preview2.customers[0].proposedAction, "SKIP_DUPLICATE");
    assert.equal(preview2.summary.partyRows.duplicates, 1);
    const token2 = createPreviewSession(xml, options);
    const apply2 = await applyFromPreviewToken(db, token2);
    assert.equal(apply2.created, 0);
    assert.ok(apply2.skipped >= 1);
    assert.equal(createCalls, 1, "must not create a second customer on retry");
    assert.equal(customerStore.length, 1);
  });
});
