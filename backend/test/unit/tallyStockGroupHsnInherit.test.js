/**
 * STOCKGROUP HSN/GST inheritance + Tally control-text normalization.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeTallyControlText,
  strVal,
} = require("../../src/services/tallyMasterImport/tallyXmlListHelpers");
const {
  mapStockItemToItem,
  mapTallyStockGroupMaster,
  extractStockGroupContext,
  buildStockGroupTaxLookup,
  resolveStockItemTaxFromStockGroups,
} = require("../../src/services/tallyMasterImport/mapStockItemToItem");
const { parseTallyMastersXml } = require("../../src/services/tallyMasterImport/parseTallyMastersXml");

function envelope(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE>${inner}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

test("normalizeTallyControlText strips \\u0004 and &#4; junk", () => {
  assert.equal(normalizeTallyControlText("\u0004 Not Applicable"), "Not Applicable");
  assert.equal(normalizeTallyControlText("&#4; Not Applicable"), "Not Applicable");
  assert.equal(normalizeTallyControlText("&#04;Not Applicable"), "Not Applicable");
  assert.equal(normalizeTallyControlText("Finished Goods"), "Finished Goods");
  assert.equal(strVal("&#4; Not Applicable"), "Not Applicable");
  assert.equal(strVal({ "#text": "\u0004 Primary" }), "Primary");
});

test("extractStockGroupContext never surfaces &#4; in hierarchy text", () => {
  const ctx = extractStockGroupContext({
    PARENT: "Finished Goods",
    CATEGORY: "\u0004 Not Applicable",
  });
  assert.equal(ctx.tallyStockGroup, "Finished Goods · Not Applicable");
  assert.doesNotMatch(String(ctx.tallyStockGroup), /&#4;|\\u0004|\u0004/);
  assert.equal(ctx.parentGroup, "Finished Goods");
});

test("mapTallyStockGroupMaster extracts HSN + GST from STOCKGROUP GSTDETAILS", () => {
  const inner = `
<STOCKGROUP NAME="Finished Goods">
  <NAME>Finished Goods</NAME>
  <PARENT>Primary</PARENT>
  <GSTDETAILS.LIST>
    <HSNCODE>39269099</HSNCODE>
    <STATEWISEDETAILS.LIST>
      <STATENAME>Any</STATENAME>
      <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD>
        <GSTRATE>18</GSTRATE>
      </RATEDETAILS.LIST>
    </STATEWISEDETAILS.LIST>
  </GSTDETAILS.LIST>
</STOCKGROUP>`;
  const p = parseTallyMastersXml(envelope(inner));
  const sg = mapTallyStockGroupMaster(p.stockGroups[0]);
  assert.ok(sg);
  assert.equal(sg.hsnCode, "39269099");
  assert.equal(sg.gstRate, 18);
  assert.equal(sg.parentGroup, "Primary");
});

test("inheritance: item without HSN/GST walks parent then grandparent", () => {
  const groups = buildStockGroupTaxLookup([
    {
      NAME: "Primary",
      PARENT: "",
      HSNCODE: "99999999",
      GSTDETAILS: { GSTRATE: "5" },
    },
    {
      NAME: "Finished Goods",
      PARENT: "Primary",
      "GSTDETAILS.LIST": {
        HSNCODE: "39269099",
        "STATEWISEDETAILS.LIST": {
          "RATEDETAILS.LIST": { GSTRATEDUTYHEAD: "Integrated Tax", GSTRATE: "18" },
        },
      },
    },
    {
      NAME: "Nozzles",
      PARENT: "Finished Goods",
    },
  ]);

  const fromNearest = resolveStockItemTaxFromStockGroups(
    { hsnCode: null, gstRate: null, parentGroup: "Nozzles" },
    groups,
  );
  assert.equal(fromNearest.hsnCode, "39269099");
  assert.equal(fromNearest.gstRate, 18);
  assert.equal(fromNearest.hsnSource, "STOCKGROUP:Finished Goods");
  assert.equal(fromNearest.hsnInheritedFrom, "Finished Goods");
  assert.equal(fromNearest.gstInheritedFrom, "Finished Goods");
});

test("inheritance: mixed — HSN from nearest group, GST from parent chain", () => {
  const groups = buildStockGroupTaxLookup([
    {
      NAME: "Finished Goods",
      PARENT: "Primary",
      "GSTDETAILS.LIST": {
        "STATEWISEDETAILS.LIST": {
          "RATEDETAILS.LIST": { GSTRATEDUTYHEAD: "Integrated Tax", GSTRATE: "12" },
        },
      },
    },
    {
      NAME: "Nozzles",
      PARENT: "Finished Goods",
      HSNCODE: "84818090",
    },
  ]);

  const tax = resolveStockItemTaxFromStockGroups(
    { hsnCode: null, gstRate: null, parentGroup: "Nozzles" },
    groups,
  );
  assert.equal(tax.hsnCode, "84818090");
  assert.equal(tax.hsnSource, "STOCKGROUP:Nozzles");
  assert.equal(tax.gstRate, 12);
  assert.equal(tax.gstSource, "STOCKGROUP:Finished Goods");
});

test("inheritance: direct item HSN/GST override wins over group", () => {
  const groups = buildStockGroupTaxLookup([
    {
      NAME: "Finished Goods",
      PARENT: "Primary",
      HSNCODE: "39269099",
      "GSTDETAILS.LIST": {
        "STATEWISEDETAILS.LIST": {
          "RATEDETAILS.LIST": { GSTRATEDUTYHEAD: "Integrated Tax", GSTRATE: "18" },
        },
      },
    },
  ]);

  const tax = resolveStockItemTaxFromStockGroups(
    { hsnCode: "12345678", gstRate: 5, parentGroup: "Finished Goods" },
    groups,
  );
  assert.equal(tax.hsnCode, "12345678");
  assert.equal(tax.gstRate, 5);
  assert.equal(tax.hsnSource, "STOCKITEM");
  assert.equal(tax.gstSource, "STOCKITEM");
  assert.equal(tax.hsnInheritedFrom, null);
  assert.equal(tax.gstInheritedFrom, null);
});

test("inheritance: unresolved HSN stays null (preview ERROR path)", () => {
  const groups = buildStockGroupTaxLookup([
    { NAME: "Finished Goods", PARENT: "Primary" },
    { NAME: "Primary", PARENT: "" },
  ]);
  const tax = resolveStockItemTaxFromStockGroups(
    { hsnCode: null, gstRate: null, parentGroup: "Finished Goods" },
    groups,
  );
  assert.equal(tax.hsnCode, null);
  assert.equal(tax.hsnSource, null);
  assert.equal(tax.hsnInheritedFrom, null);
});

test("end-to-end XML: item inherits HSN/GST from STOCKGROUP; hierarchy text clean", () => {
  const inner = `
<STOCKGROUP NAME="Finished Goods">
  <NAME>Finished Goods</NAME>
  <PARENT>&#4; Not Applicable</PARENT>
  <GSTDETAILS.LIST>
    <HSNCODE>39269099</HSNCODE>
    <STATEWISEDETAILS.LIST>
      <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD>
        <GSTRATE>18</GSTRATE>
      </RATEDETAILS.LIST>
    </STATEWISEDETAILS.LIST>
  </GSTDETAILS.LIST>
</STOCKGROUP>
<STOCKITEM NAME="Nozzle A">
  <NAME>Nozzle A</NAME>
  <PARENT>Finished Goods</PARENT>
  <CATEGORY>&#4; Not Applicable</CATEGORY>
  <BASEUNITS>Nos</BASEUNITS>
</STOCKITEM>`;
  const p = parseTallyMastersXml(envelope(inner));
  assert.equal(p.stockGroups.length, 1);
  assert.equal(p.stockItems.length, 1);

  const sg = mapTallyStockGroupMaster(p.stockGroups[0]);
  assert.equal(sg?.hsnCode, "39269099");
  assert.equal(sg?.gstRate, 18);
  assert.equal(sg?.parentGroup, "Not Applicable");

  const mi = mapStockItemToItem(p.stockItems[0]);
  assert.ok(mi);
  assert.equal(mi.hsnCode, null);
  assert.doesNotMatch(String(mi.tallyStockGroup || ""), /&#4;|\u0004/);
  assert.ok(String(mi.tallyStockGroup || "").includes("Finished Goods"));
  assert.ok(String(mi.tallyStockGroup || "").includes("Not Applicable"));

  const lookup = buildStockGroupTaxLookup(p.stockGroups);
  const tax = resolveStockItemTaxFromStockGroups(
    { hsnCode: mi.hsnCode, gstRate: mi.gstRate, parentGroup: mi.parentGroup },
    lookup,
  );
  assert.equal(tax.hsnCode, "39269099");
  assert.equal(tax.gstRate, 18);
  assert.equal(tax.hsnSource, "STOCKGROUP:Finished Goods");
});
