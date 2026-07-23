const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractMasterFragments,
  extractAndParseMasters,
  shouldUseStreamingMasterExtract,
} = require("../../src/services/tallyMasterImport/tallyStreamingMasterExtract");
const { parseTallyMastersXml } = require("../../src/services/tallyMasterImport/parseTallyMastersXml");
const { prepareAndParseTallyXmlInWorker } = require("../../src/services/tallyMasterImport/tallyXmlParseWorkerHost");
const {
  beginOperation,
  updateOperation,
  getOperation,
  endOperation,
  _resetForTests,
} = require("../../src/services/tallyMasterImport/tallyImportOperationGuard");

describe("tallyStreamingMasterExtract", () => {
  it("extracts all STOCKITEM fragments with attributes", () => {
    const xml = `<?xml version="1.0"?>
<ENVELOPE>
  <TALLYMESSAGE><STOCKITEM NAME="A"><GUID>g1</GUID><PARENT>G</PARENT></STOCKITEM></TALLYMESSAGE>
  <TALLYMESSAGE><STOCKITEM NAME="B"><GUID>g2</GUID><BASEUNITS>Nos</BASEUNITS></STOCKITEM></TALLYMESSAGE>
</ENVELOPE>`;
    const frags = extractMasterFragments(xml, "STOCKITEM");
    assert.equal(frags.length, 2);
    const items = extractAndParseMasters(xml, "STOCKITEM");
    assert.equal(items.length, 2);
    assert.equal(items[0]["@_NAME"], "A");
    assert.equal(items[1]["@_NAME"], "B");
  });

  it("reports increasing processed counts via onProgress", () => {
    const parts = [];
    for (let i = 0; i < 120; i += 1) {
      parts.push(`<TALLYMESSAGE><STOCKITEM NAME="I${i}"><GUID>g${i}</GUID></STOCKITEM></TALLYMESSAGE>`);
    }
    const xml = `<ENVELOPE>${parts.join("")}</ENVELOPE>`;
    /** @type {number[]} */
    const seen = [];
    extractAndParseMasters(xml, "STOCKITEM", {
      expectedTotal: 120,
      progressEvery: 50,
      onProgress: (p) => seen.push(p.processed),
    });
    assert.ok(seen.length >= 2);
    assert.ok(seen[0] < seen[seen.length - 1]);
    assert.equal(seen[seen.length - 1], 120);
  });

  it("uses DOM path for custom flat CA* (no tagged masters)", () => {
    assert.equal(
      shouldUseStreamingMasterExtract({
        stockItemOpen: 0,
        ledgerOpen: 0,
        unitOpen: 0,
        stockGroupOpen: 0,
        caAcctTypeNameOpen: 50,
      }),
      false,
    );
    assert.equal(
      shouldUseStreamingMasterExtract({ stockItemOpen: 4246, ledgerOpen: 0, caAcctTypeNameOpen: 0 }),
      true,
    );
  });
});

describe("parseTallyMastersXml streaming mode", () => {
  it("parses STOCKITEM masters with parseMode streaming", () => {
    const xml = `<ENVELOPE>
      <TALLYMESSAGE><STOCKITEM NAME="Sheet"><GUID>abc</GUID><PARENT>Bought Out Part</PARENT><BASEUNITS>Kg</BASEUNITS></STOCKITEM></TALLYMESSAGE>
      <TALLYMESSAGE><STOCKGROUP NAME="Bought Out Part"><GUID>sg1</GUID></STOCKGROUP></TALLYMESSAGE>
    </ENVELOPE>`;
    const parsed = parseTallyMastersXml(xml, { encoding: "UTF-8", sanitizedInvalidRefCount: 0, byteLength: xml.length });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.parseStats.parseMode, "streaming");
    assert.equal(parsed.stockItems.length, 1);
    assert.equal(parsed.stockGroups.length, 1);
  });
});

describe("worker + polling responsiveness", () => {
  it("keeps updating operation progress while worker runs and recovers from worker failure", async () => {
    _resetForTests();
    beginOperation("op-worker-1", "preview", "mini.xml");
    const xml = `<ENVELOPE>${Array.from({ length: 80 }, (_, i) => `<TALLYMESSAGE><STOCKITEM NAME="N${i}"><GUID>g${i}</GUID></STOCKITEM></TALLYMESSAGE>`).join("")}</ENVELOPE>`;
    const buf = Buffer.from(xml, "utf8");

    let ticks = 0;
    const probe = setInterval(() => {
      ticks += 1;
      const op = getOperation("op-worker-1");
      assert.ok(op);
    }, 20);

    const result = await prepareAndParseTallyXmlInWorker(buf, {
      onProgress: (p) => {
        updateOperation("op-worker-1", {
          phase: p.phase || "analysing",
          percent: p.percent ?? 50,
          message: p.message || "",
          recordsDetected: p.recordsDetected ?? null,
          recordsProcessed: p.recordsProcessed ?? null,
          stockItemsProcessed: p.stockItemsProcessed ?? null,
          stockItemsTotal: p.stockItemsTotal ?? null,
        });
      },
    });
    clearInterval(probe);
    endOperation("op-worker-1", "completed");

    assert.equal(result.parsed.stockItems.length, 80);
    assert.ok(ticks >= 1, "event loop should tick during worker parse");
    const finalOp = getOperation("op-worker-1");
    assert.equal(finalOp.status, "completed");
    assert.equal(finalOp.percent, 100);

    // Failure recovery: bad buffer
    await assert.rejects(
      () => prepareAndParseTallyXmlInWorker(Buffer.from([0xff, 0xfe, 0x00, 0x00, 0x00, 0x00])),
      (err) => err && (err.code === "TALLY_XML_TRUNCATED" || err.statusCode === 400 || /incomplete|truncated|empty/i.test(err.message)),
    );
  });
});
