/**
 * Regression: GSTIN validation + Tally preview payload shaping.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  normalizeGstinOnSave,
  validateGstinFormatMessage,
  resolveImportGstin,
  cleanGstinChars,
  isValidGstinFormat,
} = require("../src/services/gstinNormalize");
const { decodeXmlFromBuffer } = require("../src/services/tallyMasterImport/parseTallyMastersXml");
const { mapLedgerToParty, extractGstin } = require("../src/services/tallyMasterImport/mapLedgerToParty");
const { parseTallyMastersXml } = require("../src/services/tallyMasterImport/parseTallyMastersXml");
const { buildPreviewPayload, formatFieldIssue } = require("../src/services/tallyMasterImport/tallyMasterImportService");

test("27ALSKD1412A1Z5 is a valid 15-char GSTIN after whitespace cleanup", () => {
  const g = "27ALSKD1412A1Z5";
  assert.equal(g.length, 15);
  assert.equal(cleanGstinChars(`  ${g}\n`), g);
  assert.equal(cleanGstinChars("27 AL SKD 1412 A1Z5"), g);
  assert.equal(validateGstinFormatMessage(g), null);
  assert.equal(validateGstinFormatMessage(`\n${g}\r\n`), null);
  assert.equal(validateGstinFormatMessage("27 AL SKD 1412 A1Z5"), null);
  assert.equal(normalizeGstinOnSave(`  ${g}  `), g);
  assert.equal(isValidGstinFormat(g), true);
  const resolved = resolveImportGstin(`\t${g} `);
  assert.equal(resolved.gstMsg, null);
  assert.equal(resolved.gstNorm, g);
});

test("short PAN-like value fails length validation with resolveImportGstin", () => {
  const r = resolveImportGstin("ALSKD1412A");
  assert.equal(r.gstNorm, null);
  assert.match(String(r.gstMsg), /exactly 15 characters/);
  assert.equal(r.gstRaw, "ALSKD1412A");
});

test("formatFieldIssue includes master, field, value, reason", () => {
  const fi = formatFieldIssue({
    masterName: "TATA",
    masterType: "Customer",
    field: "GSTIN",
    actualValue: "ALSKD1412A",
    reason: "GSTIN must be exactly 15 characters.",
    disposition: "GSTIN will be left blank on import",
  });
  assert.match(fi.message, /Customer "TATA"/);
  assert.match(fi.message, /Field GSTIN/);
  assert.match(fi.message, /ALSKD1412A/);
  assert.match(fi.message, /exactly 15/);
  assert.match(fi.message, /found 10 alphanumeric/);
});

test("Master.xml TATA: extract + preview accepts GSTIN 27ALSKD1412A1Z5", async () => {
  const buf = fs.readFileSync(path.join(__dirname, "fixtures/tally/Master.xml"));
  const xml = decodeXmlFromBuffer(buf);
  const parsed = parseTallyMastersXml(xml);
  assert.equal(parsed.ok, true);
  const led = parsed.ledgers.find((l) => String(l["@_NAME"] || l.NAME || "").toUpperCase() === "TATA");
  assert.ok(led);
  assert.equal(extractGstin(led), "27ALSKD1412A1Z5");
  const cust = mapLedgerToParty(led, "CUSTOMER");
  assert.equal(cust?.gst, "27ALSKD1412A1Z5");
  assert.equal(resolveImportGstin(cust.gst).gstMsg, null);

  const db = {
    state: {
      findMany: async () => [{ id: 1, stateName: "Maharashtra", stateCode: "27" }],
    },
    customer: { findMany: async () => [] },
    supplier: { findMany: async () => [] },
    item: { findMany: async () => [] },
    unit: { findMany: async () => [] },
  };

  const payload = await buildPreviewPayload(db, xml, {
    defaultItemType: "FG",
    fallbackStateId: 1,
    duplicateAction: "SKIP",
  });
  assert.equal(payload.ok, true);
  const row = payload.customers.find((c) => c.tallyName === "TATA" || c.mapped?.name === "TATA");
  assert.ok(row, "TATA customer preview row");
  assert.equal(row.mapped.gst, "27ALSKD1412A1Z5");
  assert.equal(row.mapped.contact, "Mahesh");
  assert.equal(row.mapped.phone, "8754789587");
  assert.equal(row.status, "OK");
  assert.ok(!row.warnings.some((w) => /GSTIN/i.test(w)), `unexpected GSTIN warning: ${row.warnings.join(" | ")}`);
  assert.ok(payload.parsedMasterCounts);
  assert.equal(payload.parsedMasterCounts.customers, payload.customers.length);
  assert.ok(Array.isArray(payload.infoNotes));
});

test("preview prefers valid GSTIN over short sibling-like candidates", () => {
  const ledger = {
    NAME: "Acme",
    PARENT: "Sundry Debtors",
    "LEDGSTREGDETAILS.LIST": {
      GSTREGISTRATIONNUMBER: "SHORT",
      GSTIN: "27ALSKD1412A1Z5",
    },
  };
  assert.equal(extractGstin(ledger), "27ALSKD1412A1Z5");
});

test("normalizeGstinOnSave does not truncate a longer cleaned string into a false valid GSTIN", () => {
  // Previously slice(0,15) could invent a 15-char prefix; now invalid lengths → null
  assert.equal(normalizeGstinOnSave("27ALSKD1412A1Z5EXTRA"), null);
  assert.match(String(validateGstinFormatMessage("27ALSKD1412A1Z5EXTRA")), /exactly 15 characters/);
});
