/**
 * Shared Tally XML LIST-helper regression coverage for masters beyond parties.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseTallyMastersXml, strVal } = require("../src/services/tallyMasterImport/parseTallyMastersXml");
const { getListBlocks, masterDisplayName } = require("../src/services/tallyMasterImport/tallyXmlListHelpers");
const {
  mapStockItemToItem,
  mapTallyUnitMaster,
  mapTallyStockGroupMaster,
  mapTallyGodownMaster,
  mapTallyVoucherTypeMaster,
} = require("../src/services/tallyMasterImport/mapStockItemToItem");
const { mapLedgerToParty } = require("../src/services/tallyMasterImport/mapLedgerToParty");

function envelope(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE>${inner}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

test("parser collects STOCKGROUP / GODOWN / VOUCHERTYPE with shared walker", () => {
  const inner = `
<STOCKGROUP NAME="Raw Material"><NAME>Raw Material</NAME><PARENT>Primary</PARENT></STOCKGROUP>
<GODOWN NAME="Main Store"><NAME>Main Store</NAME><PARENT>Primary</PARENT></GODOWN>
<VOUCHERTYPE NAME="Sales"><NAME>Sales</NAME><PARENT>Sales</PARENT></VOUCHERTYPE>
<UNIT NAME="Nos"><NAME>Nos</NAME><SYMBOL>Nos</SYMBOL></UNIT>
<STOCKITEM NAME="Widget"><NAME>Widget</NAME><PARENT>Raw Material</PARENT><BASEUNITS>Nos</BASEUNITS></STOCKITEM>
`;
  const p = parseTallyMastersXml(envelope(inner));
  assert.equal(p.ok, true);
  assert.equal(p.stockGroups.length, 1);
  assert.equal(p.godowns.length, 1);
  assert.equal(p.voucherTypes.length, 1);
  assert.equal(p.units.length, 1);
  assert.equal(p.stockItems.length, 1);
  assert.equal(p.parseStats.stockGroupsParsed, 1);
  assert.equal(p.parseStats.godownsParsed, 1);
  assert.equal(p.parseStats.voucherTypesParsed, 1);

  const sg = mapTallyStockGroupMaster(p.stockGroups[0]);
  assert.equal(sg?.stockGroupName, "Raw Material");
  assert.equal(sg?.parentGroup, "Primary");

  const gd = mapTallyGodownMaster(p.godowns[0]);
  assert.equal(gd?.godownName, "Main Store");

  const vt = mapTallyVoucherTypeMaster(p.voucherTypes[0]);
  assert.equal(vt?.voucherTypeName, "Sales");

  const u = mapTallyUnitMaster(p.units[0]);
  assert.equal(u?.unitName, "Nos");
  assert.equal(u?.unitCode, "Nos");

  const mi = mapStockItemToItem(p.stockItems[0]);
  assert.equal(mi?.autoDetectedItemType, "RM");
});

test("STOCKITEM GSTDETAILS.LIST uses shared getListBlocks (array + single)", () => {
  const inner = `
<STOCKITEM NAME="Split GST">
  <NAME>Split GST</NAME>
  <BASEUNITS>Nos</BASEUNITS>
  <GSTDETAILS.LIST>
    <HSNCODE>40101200</HSNCODE>
    <STATEWISEDETAILS.LIST>
      <STATENAME>Any</STATENAME>
      <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>Central Tax</GSTRATEDUTYHEAD>
        <GSTRATE>9</GSTRATE>
      </RATEDETAILS.LIST>
      <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>State Tax</GSTRATEDUTYHEAD>
        <GSTRATE>9</GSTRATE>
      </RATEDETAILS.LIST>
    </STATEWISEDETAILS.LIST>
  </GSTDETAILS.LIST>
</STOCKITEM>`;
  const p = parseTallyMastersXml(envelope(inner));
  const stock = p.stockItems[0];
  const gstBlocks = getListBlocks(stock, "GSTDETAILS");
  assert.ok(gstBlocks.length >= 1);
  const sw = getListBlocks(gstBlocks[0], "STATEWISEDETAILS");
  assert.ok(sw.length >= 1);
  const rates = getListBlocks(sw[0], "RATEDETAILS");
  assert.equal(rates.length, 2);
  const mi = mapStockItemToItem(stock);
  assert.equal(mi?.gstRate, 18);
  assert.equal(mi?.hsnCode, "40101200");
});

test("getListBlocks normalizes single object and repeated LIST siblings", () => {
  const { getListBlocks } = require("../src/services/tallyMasterImport/tallyXmlListHelpers");
  const single = {
    "LEDMAILINGDETAILS.LIST": {
      STATE: "Maharashtra",
      "ADDRESS.LIST": { ADDRESS: "One Line" },
    },
  };
  const multi = {
    "RATEDETAILS.LIST": [
      { GSTRATEDUTYHEAD: "Central Tax", GSTRATE: "9" },
      { GSTRATEDUTYHEAD: "State Tax", GSTRATE: "9" },
    ],
  };
  assert.equal(getListBlocks(single, "LEDMAILINGDETAILS").length, 1);
  assert.equal(getListBlocks(single, "LEDMAILINGDETAILS")[0].STATE, "Maharashtra");
  assert.equal(getListBlocks(multi, "RATEDETAILS").length, 2);
});

test("multiple UNIT masters (array) map via shared helpers", () => {
  const inner = `
<UNIT NAME="Kg"><NAME>Kg</NAME><SYMBOL>Kg</SYMBOL></UNIT>
<UNIT NAME="Nos"><NAME>Nos</NAME><SYMBOL>Nos</SYMBOL></UNIT>
`;
  const p = parseTallyMastersXml(envelope(inner));
  assert.equal(p.units.length, 2);
  const mapped = p.units.map((u) => mapTallyUnitMaster(u));
  assert.deepEqual(
    mapped.map((m) => m?.unitName).sort(),
    ["Kg", "Nos"],
  );
});

test("supplier creditor ledger still maps via shared LIST helpers", () => {
  const inner = `
<LEDGER NAME="Vendor Co">
  <NAME>Vendor Co</NAME>
  <PARENT>Sundry Creditors</PARENT>
  <LEDMAILINGDETAILS.LIST>
    <STATE>Karnataka</STATE>
    <ADDRESS.LIST TYPE="String"><ADDRESS>Line A</ADDRESS><ADDRESS>Line B</ADDRESS></ADDRESS.LIST>
    <PINCODE>560001</PINCODE>
    <COUNTRY>India</COUNTRY>
  </LEDMAILINGDETAILS.LIST>
  <LEDGSTREGDETAILS.LIST>
    <GSTIN>29AAAAA0000A1Z5</GSTIN>
  </LEDGSTREGDETAILS.LIST>
  <CONTACTDETAILS.LIST>
    <NAME>Ravi</NAME>
    <PHONENUMBER>9999999999</PHONENUMBER>
  </CONTACTDETAILS.LIST>
</LEDGER>`;
  const p = parseTallyMastersXml(envelope(inner));
  const led = p.ledgers.find((l) => masterDisplayName(l) === "Vendor Co" || strVal(l.NAME) === "Vendor Co");
  const sup = mapLedgerToParty(led, "SUPPLIER");
  assert.ok(sup);
  assert.equal(sup.gst, "29AAAAA0000A1Z5");
  assert.equal(sup.stateText, "Karnataka");
  assert.equal(sup.contact, "Ravi");
  assert.equal(sup.phone, "9999999999");
  assert.match(String(sup.address), /Line A/);
  assert.match(String(sup.address), /Line B/);
  assert.match(String(sup.address), /560001/);
});
