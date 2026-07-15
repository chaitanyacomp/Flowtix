const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  parseTallyMastersXml,
  decodeXmlFromBuffer,
  strVal,
} = require("../src/services/tallyMasterImport/parseTallyMastersXml");
const { mapLedgerToParty } = require("../src/services/tallyMasterImport/mapLedgerToParty");

const FIXTURE = path.join(__dirname, "fixtures", "tally", "Master.xml");

test("Master.xml fixture: TATA customer maps GSTIN, contact, phone, address, state, pincode", () => {
  assert.ok(fs.existsSync(FIXTURE), `missing fixture ${FIXTURE}`);
  const xml = decodeXmlFromBuffer(fs.readFileSync(FIXTURE));
  const parsed = parseTallyMastersXml(xml);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.ledgers.length >= 1);

  const led = parsed.ledgers.find(
    (l) => String(l["@_NAME"] || "") === "TATA" || strVal(l.NAME) === "TATA",
  );
  assert.ok(led, "TATA ledger must be present in Master.xml");

  const cust = mapLedgerToParty(led, "CUSTOMER");
  assert.ok(cust, "TATA must classify as Sundry Debtor customer");

  assert.equal(cust.name, "TATA");
  assert.equal(cust.gst, "27ALSKD1412A1Z5", "GSTIN from LEDGSTREGDETAILS — not PAN");
  assert.notEqual(cust.gst, "ALSKD1412A");
  assert.equal(cust.stateText, "Maharashtra");
  assert.equal(cust.pincode, "4110085");
  assert.equal(cust.country, "India");
  assert.equal(cust.contact, "Mahesh");
  assert.equal(cust.phone, "8754789587");
  assert.match(String(cust.address || ""), /985 Hinjawadi Phase 2/);
  assert.match(String(cust.address || ""), /4110085/);
  assert.match(String(cust.address || ""), /India/);
});

test("Master.xml fixture: decodeXmlFromBuffer handles UTF-16 LE BOM when present", () => {
  const desktop = "C:/Users/saniy/Desktop/Masters/Master.xml";
  if (!fs.existsSync(desktop)) {
    // Fixture path only — skip optional desktop UTF-16 check in CI.
    return;
  }
  const buf = fs.readFileSync(desktop);
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xfe);
  const xml = decodeXmlFromBuffer(buf);
  const parsed = parseTallyMastersXml(xml);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.ledgers.some((l) => String(l["@_NAME"] || "") === "TATA"));
});
