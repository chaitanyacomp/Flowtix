/**
 * Pilot Tally master import — decode/sanitize, exact Sundry parents, stock mapping.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  prepareTallyMasterXmlFromBuffer,
  sanitizeInvalidXml10CharRefs,
  assertCompleteTallyXmlEnvelope,
  TRUNCATED_XML_MESSAGE,
} = require("../src/services/tallyMasterImport/tallyXmlDecode");
const {
  parseTallyMastersXml,
} = require("../src/services/tallyMasterImport/parseTallyMastersXml");
const { mapLedgerToParty, classifySundryLedgerParent } = require("../src/services/tallyMasterImport/mapLedgerToParty");
const {
  mapStockItemToItem,
  extractLatestApplicableIgst,
} = require("../src/services/tallyMasterImport/mapStockItemToItem");
const {
  suggestGroupMapping,
  resolveErpItemType,
  suggestUnitMapping,
  buildUnitMappingTable,
} = require("../src/services/tallyMasterImport/tallyMasterGroupUnitMapping");
const { MAX_XML_BYTES } = require("../src/services/tallyMasterImport/tallyMasterImportService");

const FIXTURES = path.join(__dirname, "fixtures", "tally");
const DEBTORS = path.join(FIXTURES, "sundry-debtors-custom-flat.xml");
const CREDITORS = path.join(FIXTURES, "sundry-creditors-custom-flat.xml");
const DESKTOP_STOCK = "C:/Users/saniy/Desktop/Masters/Stock items.xml";

function utf16LeBom(xmlUtf8) {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xmlUtf8, "utf16le")]);
}

describe("tallyXmlDecode + sanitization", () => {
  test("BOM detection returns encoding diagnostics", () => {
    const prepared = prepareTallyMasterXmlFromBuffer(
      utf16LeBom("<ENVELOPE><CAACCTYPENAME>A</CAACCTYPENAME></ENVELOPE>"),
    );
    assert.equal(prepared.encoding, "UTF-16LE");
    assert.match(prepared.text, /ENVELOPE/);
  });

  test("removes &#4; / &#x4; only; preserves &amp; and &#39;", () => {
    const raw =
      "<ENVELOPE><N>A&#4;B &amp; C &#39;x&#39; &#x4;Y</N></ENVELOPE>";
    const { text, sanitizedInvalidRefCount } = sanitizeInvalidXml10CharRefs(raw);
    assert.equal(sanitizedInvalidRefCount, 2);
    assert.match(text, /AB &amp; C &#39;x&#39; Y/);
    assert.doesNotMatch(text, /&#4;/);
  });

  test("truncated XML rejected with business message", () => {
    const r = assertCompleteTallyXmlEnvelope("<ENVELOPE><STOCKITEM>");
    assert.equal(r.ok, false);
    assert.equal(r.error, TRUNCATED_XML_MESSAGE);
  });

  test("upload limit supports ~65MB stock file", () => {
    assert.ok(MAX_XML_BYTES >= 65 * 1024 * 1024);
  });
});

describe("exact Sundry parent eligibility", () => {
  test("only exact Sundry Debtors / Sundry Creditors", () => {
    assert.equal(classifySundryLedgerParent("Sundry Debtors"), "DEBTOR");
    assert.equal(classifySundryLedgerParent("  sundry creditors "), "CREDITOR");
    assert.equal(classifySundryLedgerParent("Deflashing Charges"), null);
    assert.equal(classifySundryLedgerParent("North Zone Debtors"), null);
  });

  test("debtors fixture: 182 eligible customers", () => {
    const prepared = prepareTallyMasterXmlFromBuffer(fs.readFileSync(DEBTORS));
    assert.equal(prepared.encoding, "UTF-16LE");
    const parsed = parseTallyMastersXml(prepared.text, {
      encoding: prepared.encoding,
      sanitizedInvalidRefCount: prepared.sanitizedInvalidRefCount,
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ledgers.length, 182);
    const customers = parsed.ledgers.map((l) => mapLedgerToParty(l, "CUSTOMER")).filter(Boolean);
    assert.equal(customers.length, 182);
  });

  test("creditors fixture: 299 eligible, 11 excluded including Deflashing Charges", () => {
    const prepared = prepareTallyMasterXmlFromBuffer(fs.readFileSync(CREDITORS));
    const parsed = parseTallyMastersXml(prepared.text, {
      encoding: prepared.encoding,
      sanitizedInvalidRefCount: prepared.sanitizedInvalidRefCount,
    });
    assert.equal(parsed.ledgers.length, 310);
    const suppliers = parsed.ledgers.map((l) => mapLedgerToParty(l, "SUPPLIER")).filter(Boolean);
    const excluded = parsed.ledgers.filter(
      (l) => !mapLedgerToParty(l, "SUPPLIER") && !mapLedgerToParty(l, "CUSTOMER"),
    );
    assert.equal(suppliers.length, 299);
    assert.equal(excluded.length, 11);
    assert.ok(excluded.some((l) => String(l.PARENT).includes("Deflashing")));
  });
});

describe("stock GST / group / unit mapping", () => {
  test("latest APPLICABLEFROM IGST wins; blank stays unresolved", () => {
    const xml = `<?xml version="1.0"?>
<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE>
<STOCKITEM NAME="Widget">
  <NAME>Widget</NAME>
  <PARENT>Raw Material</PARENT>
  <BASEUNITS>Nos</BASEUNITS>
  <GSTDETAILS.LIST>
    <APPLICABLEFROM>20200401</APPLICABLEFROM>
    <STATEWISEDETAILS.LIST>
      <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD>
        <GSTRATE>12</GSTRATE>
      </RATEDETAILS.LIST>
    </STATEWISEDETAILS.LIST>
  </GSTDETAILS.LIST>
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
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const parsed = parseTallyMastersXml(xml);
    const mi = mapStockItemToItem(parsed.stockItems[0]);
    assert.equal(mi.gstRate, 18);
    const blank = extractLatestApplicableIgst({
      "GSTDETAILS.LIST": { APPLICABLEFROM: "20250101", "RATEDETAILS.LIST": { GSTRATEDUTYHEAD: "Integrated Tax", GSTRATE: "" } },
    });
    assert.equal(blank.rate, null);
  });

  test("group suggestions: Labour Charges EXCLUDE, Raw Material RM, Packing → CONSUMABLE on apply", () => {
    assert.equal(suggestGroupMapping("Labour Charges").suggested, "EXCLUDE");
    assert.equal(suggestGroupMapping("Raw Material").suggested, "RM");
    assert.equal(resolveErpItemType("PACKING"), "CONSUMABLE");
    assert.equal(resolveErpItemType("SCRAP"), null);
    assert.equal(resolveErpItemType("SFG"), "SFG");
  });

  test("unit aliases Nos/Kg; unknown unresolved", () => {
    assert.equal(suggestUnitMapping("No.").suggestedErpUnitName, "Nos");
    assert.equal(suggestUnitMapping("Kgs").suggestedErpUnitName, "Kg");
    assert.equal(suggestUnitMapping("Sq.Ft.").unresolved, true);
    const table = buildUnitMappingTable([{ baseUnit: "Nos" }, { baseUnit: "Pcs" }], {}, [
      { id: 1, unitName: "Nos", unitCode: "NOS" },
    ]);
    assert.ok(table.some((r) => r.proposedErpUnitId === 1));
  });

  test("ISDELETED stock items are skipped", () => {
    const xml = `<?xml version="1.0"?>
<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE>
<STOCKITEM NAME="Gone"><NAME>Gone</NAME><ISDELETED>Yes</ISDELETED><PARENT>Raw Material</PARENT><BASEUNITS>Nos</BASEUNITS></STOCKITEM>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const parsed = parseTallyMastersXml(xml);
    assert.equal(mapStockItemToItem(parsed.stockItems[0]), null);
  });
});

describe("desktop Stock items.xml (optional)", () => {
  test("detect 4246 STOCKITEM and sanitize &#4; count when file present", () => {
    if (!fs.existsSync(DESKTOP_STOCK)) {
      // Skip quietly in CI without the pilot file.
      return;
    }
    const buf = fs.readFileSync(DESKTOP_STOCK);
    assert.ok(buf.length > 60 * 1024 * 1024);
    assert.equal(buf[0], 0xff);
    assert.equal(buf[1], 0xfe);
    const prepared = prepareTallyMasterXmlFromBuffer(buf);
    assert.equal(prepared.encoding, "UTF-16LE");
    assert.ok(prepared.sanitizedInvalidRefCount >= 40000);
    // Full parse of 64MB is heavy — count tags on sanitized text for verification target.
    const stockOpen = (prepared.text.match(/<STOCKITEM\b/gi) || []).length;
    assert.equal(stockOpen, 4246);
  });
});
