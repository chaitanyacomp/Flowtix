const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  findEquivalentUnit,
  normalizeUnitCode,
  unitFamily,
  unitsAreEquivalent,
} = require("../../src/services/tallyMasterImport/tallyUnitIdentity");
const {
  buildPreviewPayload,
  createOrReuseImportedUnit,
} = require("../../src/services/tallyMasterImport/tallyMasterImportService");
const { buildUnitMappingTable } = require("../../src/services/tallyMasterImport/tallyMasterGroupUnitMapping");

describe("Tally unit identity", () => {
  it("recognizes required aliases case-insensitively", () => {
    for (const value of ["Kg", "Kgs", "Kg."]) assert.equal(unitFamily(value), "KG");
    for (const value of ["Nos", "No.", "Pcs"]) assert.equal(unitFamily(value), "NOS");
    for (const value of ["Sq.Ft", "Sq. Ft.", "Square Feet"]) assert.equal(unitFamily(value), "SQFT");
    for (const value of ["Sq.Mtr", "Sq.Meter", "Square Metres"]) assert.equal(unitFamily(value), "SQM");
    assert.equal(unitsAreEquivalent({ unitName: "Pcs" }, { unitName: "No." }), true);
  });

  it("never conflates linear feet, square feet, litres, kilolitres, or square-area families", () => {
    assert.equal(unitsAreEquivalent({ unitName: "ft" }, { unitName: "Sq.Ft" }), false);
    assert.equal(unitsAreEquivalent({ unitName: "Linear Feet" }, { unitName: "Square Feet" }), false);
    assert.equal(unitsAreEquivalent({ unitName: "Ltrs" }, { unitName: "Kilolitres" }), false);
    assert.equal(unitsAreEquivalent({ unitCode: "LTR" }, { unitCode: "KL" }), false);
    assert.equal(unitsAreEquivalent({ unitName: "Sq.Ft" }, { unitName: "Sq.Mtr" }), false);
    assert.equal(
      unitsAreEquivalent(
        { unitName: "Linear Feet", unitCode: "FT", tallyUnitSymbol: "SQF-SQUARE FEET" },
        { unitName: "Sq.Ft", unitCode: "SQFT" },
      ),
      false,
    );
    assert.equal(unitFamily("SQF-SQUARE FEET"), "SQFT");
    assert.equal(unitFamily("KLR-KILOLITRE"), "KL");
  });

  it("selects the approved canonical equivalent deterministically", () => {
    const candidates = [
      { id: 105, unitName: "Pcs", unitCode: "PCS-PIECES", isActive: true },
      { id: 102, unitName: "No.", unitCode: "NOS-NUMBERS", isActive: true },
      { id: 120, unitName: "Nos", unitCode: "NOS", isActive: true },
    ];
    assert.equal(findEquivalentUnit(candidates, { unitName: "Pcs" }).id, 120);
    assert.equal(findEquivalentUnit(candidates.slice(0, 2), { unitName: "Nos" }).id, 102);
    assert.equal(findEquivalentUnit([...candidates].reverse(), { unitName: "Nos" }).id, 120);
  });

  it("normalizes long symbols during preview and retains the original", () => {
    const value = normalizeUnitCode("SQM-SQUARE METERS", "Sq.Mtr");
    assert.equal(value.unitCode, "SQM");
    assert.equal(value.originalSymbol, "SQM-SQUARE METERS");
    assert.equal(value.shortened, true);
    assert.ok(value.unitCode.length <= 16);
  });

  it("preview reuses an equivalent ERP unit instead of proposing CREATE", async () => {
    const xml = `<?xml version="1.0"?><ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
      <TALLYMESSAGE><UNIT NAME="Kgs"><NAME>Kgs</NAME><SYMBOL>KGS-KILOGRAMS</SYMBOL></UNIT></TALLYMESSAGE>
      <TALLYMESSAGE><UNIT NAME="Sq.Mtr"><NAME>Sq.Mtr</NAME><SYMBOL>SQM-SQUARE METERS</SYMBOL></UNIT></TALLYMESSAGE>
    </REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const db = {
      state: { findMany: async () => [] },
      customer: { findMany: async () => [] },
      supplier: { findMany: async () => [] },
      item: { findMany: async () => [] },
      unit: {
        findMany: async () => [
          { id: 8, unitName: "Kg.", unitCode: "KGS-KILOGRAMS", tallyName: "Kg." },
          { id: 9, unitName: "Sq.Meter", unitCode: "SQM" },
        ],
      },
    };
    const preview = await buildPreviewPayload(db, xml, {
      defaultItemType: "FG",
      duplicateAction: "SKIP",
      fallbackStateId: null,
    });
    assert.equal(preview.ok, true);
    assert.equal(preview.units.length, 2);
    assert.deepEqual(preview.units.map((row) => row.proposedAction), ["REUSE", "REUSE"]);
    assert.deepEqual(preview.units.map((row) => row.existingErpId), [8, 9]);
    assert.equal(preview.units[1].mapped.unitCode, "SQM");
    assert.equal(preview.units[1].mapped.tallyUnitSymbol, "SQM-SQUARE METERS");
  });

  it("keeps Not Applicable under review unless a genuine ERP unit is explicitly selected", async () => {
    const xml = `<?xml version="1.0"?><ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
      <TALLYMESSAGE><UNIT NAME="Not Applicable"><NAME>Not Applicable</NAME></UNIT></TALLYMESSAGE>
      <TALLYMESSAGE><STOCKITEM NAME="Review Item"><NAME>Review Item</NAME><PARENT>Raw Material</PARENT><BASEUNITS>Not Applicable</BASEUNITS><HSNCODE>3901</HSNCODE></STOCKITEM></TALLYMESSAGE>
    </REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const units = [
      { id: 110, unitName: "Not Applicable", unitCode: null },
      { id: 111, unitName: "Nos", unitCode: "NOS" },
    ];
    const db = {
      state: { findMany: async () => [] },
      customer: { findMany: async () => [] },
      supplier: { findMany: async () => [] },
      item: { findMany: async () => [] },
      unit: { findMany: async () => units },
    };
    const baseOptions = {
      defaultItemType: "RM",
      duplicateAction: "SKIP",
      fallbackStateId: null,
      groupTypeOverrides: { "raw material": "RM" },
    };
    const review = await buildPreviewPayload(db, xml, baseOptions);
    assert.equal(review.units[0].proposedAction, "REVIEW");
    assert.equal(review.unitMapping[0].unresolved, true);
    assert.equal(review.items[0].proposedAction, "EXCLUDED");
    assert.equal(review.items[0].mapped.proposedErpUnitId, null);

    const explicitlyMapped = await buildPreviewPayload(db, xml, {
      ...baseOptions,
      unitMapOverrides: { "not applicable": "Nos" },
    });
    assert.equal(explicitlyMapped.unitMapping[0].importAction, "MAP");
    assert.equal(explicitlyMapped.items[0].mapped.proposedErpUnitId, 111);
    assert.notEqual(explicitlyMapped.items[0].proposedAction, "EXCLUDED");
  });

  it("authoritatively reuses partial-import rows and creates only unresolved units", async () => {
    const store = [{ id: 101, unitName: "Kg.", unitCode: "KGS-KILOGRAMS", tallyName: "Kg." }];
    let creates = 0;
    const db = {
      unit: {
        findMany: async () => store,
        create: async ({ data }) => {
          creates += 1;
          const row = { id: 102, ...data };
          store.push(row);
          return row;
        },
      },
      $transaction: async (fn) => fn(db),
    };
    const kg = await createOrReuseImportedUnit(db, {
      tallyName: "Kgs",
      tallyGuid: null,
      mapped: { unitName: "Kgs", unitCode: "KG", tallyUnitSymbol: "KGS-KILOGRAMS" },
    });
    const sqft = await createOrReuseImportedUnit(db, {
      tallyName: "Sq.Ft",
      tallyGuid: "u-sqft",
      mapped: { unitName: "Sq.Ft", unitCode: "SQFT", tallyUnitSymbol: "SQF-SQUARE FEET" },
    });
    assert.equal(kg.outcome, "REUSED");
    assert.equal(sqft.outcome, "CREATED");
    assert.equal(creates, 1);
  });

  it("handles concurrent duplicate creation without leaking Prisma details", async () => {
    const concurrent = { id: 77, unitName: "Nos", unitCode: "NOS" };
    const db = {
      unit: {
        findMany: async () => (db._after ? [concurrent] : []),
        create: async () => {
          db._after = true;
          throw Object.assign(new Error("Prisma path C:\\repo\\node_modules\\client.js:99"), { code: "P2002" });
        },
      },
      $transaction: async (fn) => fn(db),
      _after: false,
    };
    const outcome = await createOrReuseImportedUnit(db, {
      tallyName: "Pcs",
      tallyGuid: null,
      mapped: { unitName: "Pcs", unitCode: "NOS", tallyUnitSymbol: "PCS" },
    });
    assert.equal(outcome.outcome, "REUSED");
    assert.equal(outcome.row.id, 77);
    assert.equal(JSON.stringify(outcome).includes("Prisma"), false);
  });

  it("finds code-equivalent rows even when display names differ", () => {
    const match = findEquivalentUnit(
      [{ id: 1, unitName: "Square Feet", unitCode: "SQFT" }],
      { unitName: "Sq. Ft.", unitCode: "SQF-SQUARE FEET" },
    );
    assert.equal(match.id, 1);
  });

  it("preserves every source UNIT row while resolving aliases to one authoritative ERP unit", async () => {
    const names = ["Kg", "Kgs", "No.", "Nos", "Pcs", "ft", "Sq.Ft.", "Sq.Mtr", "Ltrs", "Set", "Pkt", "Pair", "Roll", "Not Applicable"];
    const xml = `<?xml version="1.0"?><ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>${names
      .map((name) => `<TALLYMESSAGE><UNIT NAME="${name}"><NAME>${name}</NAME><SYMBOL>${name}</SYMBOL></UNIT></TALLYMESSAGE>`)
      .join("")}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const db = {
      state: { findMany: async () => [] },
      customer: { findMany: async () => [] },
      supplier: { findMany: async () => [] },
      item: { findMany: async () => [] },
      unit: {
        findMany: async () => [
          { id: 1, unitName: "Kg", unitCode: "KG" },
          { id: 2, unitName: "Nos", unitCode: "NOS" },
          { id: 3, unitName: "Linear Feet", unitCode: "FT" },
          { id: 4, unitName: "Ltr", unitCode: "LTR" },
          { id: 5, unitName: "Set", unitCode: "SET" },
          { id: 6, unitName: "Pkt", unitCode: "PKT" },
          { id: 7, unitName: "Pair", unitCode: "PAIR" },
          { id: 8, unitName: "Roll", unitCode: "ROLL" },
        ],
      },
    };
    const preview = await buildPreviewPayload(db, xml, {
      defaultItemType: "RM",
      duplicateAction: "SKIP",
      fallbackStateId: null,
    });
    assert.equal(preview.parseStats.unitsParsed, 14);
    assert.equal(preview.units.length, 14);
    assert.deepEqual(preview.units.map((row) => row.tallyName), names);
    assert.equal(preview.units.find((row) => row.tallyName === "ft").existingErpId, 3);
    assert.equal(preview.units.find((row) => row.tallyName === "Ltrs").existingErpId, 4);
    assert.equal(preview.units.find((row) => row.tallyName === "Not Applicable").proposedAction, "REVIEW");
  });

  it("rejects dimensional unit overrides instead of mapping linear feet or litres incorrectly", () => {
    const erpUnits = [
      { id: 10, unitName: "Sq.Ft", unitCode: "SQFT" },
      { id: 11, unitName: "Kilolitre", unitCode: "KL" },
    ];
    const rows = buildUnitMappingTable(
      [{ baseUnit: "ft" }, { baseUnit: "Ltrs" }],
      { ft: "Sq.Ft", ltrs: "Kilolitre" },
      erpUnits,
      [],
    );
    assert.equal(rows.every((row) => row.unresolved && row.semanticMismatch), true);
  });

  it("uses the approved stock-group type as the effective and persisted preview type", async () => {
    const xml = `<?xml version="1.0"?><ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
      <TALLYMESSAGE><UNIT NAME="Nos"><NAME>Nos</NAME><SYMBOL>NOS</SYMBOL></UNIT></TALLYMESSAGE>
      <TALLYMESSAGE><STOCKITEM NAME="1&quot; Ball Valve"><NAME>1&quot; Ball Valve</NAME><PARENT>Raw Material</PARENT><BASEUNITS>Nos</BASEUNITS><HSNCODE>8481</HSNCODE></STOCKITEM></TALLYMESSAGE>
      <TALLYMESSAGE><STOCKITEM NAME="Polybags"><NAME>Polybags</NAME><PARENT>Packing Material</PARENT><BASEUNITS>Nos</BASEUNITS><HSNCODE>3923</HSNCODE></STOCKITEM></TALLYMESSAGE>
    </REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const db = {
      state: { findMany: async () => [] },
      customer: { findMany: async () => [] },
      supplier: { findMany: async () => [] },
      item: { findMany: async () => [] },
      unit: { findMany: async () => [{ id: 2, unitName: "Nos", unitCode: "NOS" }] },
    };
    const preview = await buildPreviewPayload(db, xml, {
      defaultItemType: "FG",
      duplicateAction: "SKIP",
      fallbackStateId: null,
      groupTypeOverrides: { "raw material": "RM", "packing material": "PACKING" },
    });
    assert.equal(preview.items[0].mapped.itemType, "RM");
    assert.equal(preview.items[1].mapped.itemType, "CONSUMABLE");
    assert.deepEqual(preview.stockPreview.effectiveItemTypes, {
      RM: 1,
      FG: 0,
      SFG: 0,
      CONSUMABLE: 1,
      EXCLUDED: 0,
    });
  });
});
