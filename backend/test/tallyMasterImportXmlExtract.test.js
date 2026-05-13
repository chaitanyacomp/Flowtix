const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseTallyMastersXml, strVal } = require("../src/services/tallyMasterImport/parseTallyMastersXml");
const { mapStockItemToItem } = require("../src/services/tallyMasterImport/mapStockItemToItem");
const { mapLedgerToParty } = require("../src/services/tallyMasterImport/mapLedgerToParty");
const {
  normalizeStateTextForMatch,
  stateIdFromStateText,
} = require("../src/services/tallyMasterImport/tallyMasterImportService");

function envelope(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE>${inner}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

test("STOCKITEM: HSN + GST nested under GSTDETAILS.LIST / STATEWISEDETAILS / RATEDETAILS (Tally Prime style)", () => {
  const inner = `
<STOCKITEM NAME="Widget A">
  <NAME>Widget A</NAME>
  <BASEUNITS>Nos</BASEUNITS>
  <GSTDETAILS.LIST>
    <HSNCODE>84713010</HSNCODE>
    <STATEWISEDETAILS.LIST>
      <STATENAME>Any</STATENAME>
      <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD>
        <GSTRATE>18</GSTRATE>
      </RATEDETAILS.LIST>
    </STATEWISEDETAILS.LIST>
  </GSTDETAILS.LIST>
</STOCKITEM>`;
  const p = parseTallyMastersXml(envelope(inner));
  assert.equal(p.ok, true);
  assert.ok(p.stockItems.length >= 1);
  const mi = mapStockItemToItem(p.stockItems[0]);
  assert.ok(mi);
  assert.equal(mi.hsnCode, "84713010");
  assert.equal(mi.gstRate, 18);
});

test("STOCKITEM: no root HSNCODE — deep HSNCODE only under GST block", () => {
  const inner = `
<STOCKITEM NAME="Deep HSN">
  <NAME>Deep HSN</NAME>
  <BASEUNITS>Pcs</BASEUNITS>
  <GSTDETAILS.LIST>
    <HSNCODE>998313</HSNCODE>
    <STATEWISEDETAILS.LIST>
      <STATENAME>Any</STATENAME>
      <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD>
        <GSTRATE>5</GSTRATE>
      </RATEDETAILS.LIST>
    </STATEWISEDETAILS.LIST>
  </GSTDETAILS.LIST>
</STOCKITEM>`;
  const p = parseTallyMastersXml(envelope(inner));
  const mi = mapStockItemToItem(p.stockItems[0]);
  assert.ok(mi);
  assert.equal(mi.hsnCode, "998313");
  assert.equal(mi.gstRate, 5);
});

test("STOCKITEM: CGST + SGST rows combine to total GST %", () => {
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
  const mi = mapStockItemToItem(p.stockItems[0]);
  assert.ok(mi);
  assert.equal(mi.gstRate, 18);
});

test("LEDGER: state + GSTIN from LEDMAILINGDETAILS.LIST (Sundry Creditors)", () => {
  const inner = `
<LEDGER>
  <NAME>Acme Supplies</NAME>
  <PARENT>Sundry Creditors</PARENT>
  <LEDMAILINGDETAILS.LIST>
    <LEDMAILINGDETAILS>
      <MAILINGNAME>Acme Supplies</MAILINGNAME>
      <STATENAME>Maharashtra</STATENAME>
      <ADDRESS>Plot 1, MIDC</ADDRESS>
    </LEDMAILINGDETAILS>
  </LEDMAILINGDETAILS.LIST>
  <LEDGSTREGISTRATION.LIST>
    <LEDGSTREGISTRATION>
      <GSTIN>27AAAAA0000A1Z5</GSTIN>
    </LEDGSTREGISTRATION>
  </LEDGSTREGISTRATION.LIST>
</LEDGER>`;
  const p = parseTallyMastersXml(envelope(inner));
  const led = p.ledgers.find((l) => strVal(l.NAME) === "Acme Supplies" || l["@_NAME"] === "Acme Supplies");
  assert.ok(led, "ledger parsed");
  const sup = mapLedgerToParty(led, "SUPPLIER");
  assert.ok(sup);
  assert.equal(sup.stateText, "Maharashtra");
  assert.equal(sup.gst, "27AAAAA0000A1Z5");
  assert.ok(String(sup.address || "").includes("MIDC"));
});

test("mapStockItemToItem: PARENT Raw Material → auto RM (HDPE-style)", () => {
  const mi = mapStockItemToItem({ NAME: "HDPE", PARENT: "Raw Material", BASEUNITS: "Kg" }, {});
  assert.ok(mi);
  assert.equal(mi.autoDetectedItemType, "RM");
  assert.ok(String(mi.tallyStockGroup || "").toLowerCase().includes("raw material"));
});

test("mapStockItemToItem: PARENT Finished Goods → auto FG (Nozzle-style)", () => {
  const mi = mapStockItemToItem({ NAME: "Nozzle", PARENT: "Finished Goods", BASEUNITS: "Nos" }, {});
  assert.ok(mi);
  assert.equal(mi.autoDetectedItemType, "FG");
});

test("mapStockItemToItem: custom RM keywords override defaults", () => {
  const mi = mapStockItemToItem({ NAME: "Widget", PARENT: "Polymer Stock", BASEUNITS: "Nos" }, { rmKeywords: ["polymer stock"] });
  assert.ok(mi);
  assert.equal(mi.autoDetectedItemType, "RM");
});

test("STOCKITEM: PARENT in XML sets tallyStockGroup + auto RM", () => {
  const inner = `
<STOCKITEM NAME="HDPE Granules">
  <NAME>HDPE Granules</NAME>
  <PARENT>Raw Material</PARENT>
  <BASEUNITS>Kg</BASEUNITS>
  <HSNCODE>39012000</HSNCODE>
</STOCKITEM>`;
  const p = parseTallyMastersXml(envelope(inner));
  const mi = mapStockItemToItem(p.stockItems[0], {});
  assert.ok(mi);
  assert.equal(mi.autoDetectedItemType, "RM");
  assert.ok(String(mi.tallyStockGroup || "").includes("Raw Material"));
});

test("stateIdFromStateText: ERP-style name with GST code suffix matches plain Tally state", () => {
  const states = [
    { id: 10, stateName: "Maharashtra", stateCode: "27" },
    { id: 11, stateName: "Karnataka", stateCode: "29" },
  ];
  assert.equal(stateIdFromStateText("Maharashtra (27)", states), 10);
  assert.equal(stateIdFromStateText("maharashtra", states), 10);
  assert.equal(stateIdFromStateText("  Maharashtra  ", states), 10);
  assert.equal(normalizeStateTextForMatch("Maharashtra (27)"), "maharashtra");
});
