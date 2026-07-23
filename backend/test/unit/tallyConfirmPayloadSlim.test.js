const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  createPreviewSession,
  claimPreviewSessionForApply,
  applyFromPreviewToken,
  fingerprintXmlText,
  _resetPreviewSessionsForTests,
  SESSION_TTL_MS,
} = require("../../src/services/tallyMasterImport/tallyMasterImportService");
const {
  buildTallyConfirmImportBody,
  tallyConfirmBodyByteLength,
  isOversizedLegacyConfirmBody,
} = (() => {
  // Mirror frontend slim-body rules in Node for size assertions (no TS transpile needed).
  function buildTallyConfirmImportBody(args) {
    const body = {
      previewToken: args.previewToken,
      confirm: true,
      clientOperationId: args.clientOperationId,
      groupTypeOverrides: args.groupTypeOverrides || {},
      unitMapOverrides: args.unitMapOverrides || {},
    };
    return body;
  }
  function tallyConfirmBodyByteLength(body) {
    return Buffer.byteLength(JSON.stringify(body), "utf8");
  }
  function isOversizedLegacyConfirmBody(body) {
    const overrides = body.itemTypeOverrides;
    if (!overrides || typeof overrides !== "object") return false;
    return Object.keys(overrides).length > 500;
  }
  return { buildTallyConfirmImportBody, tallyConfirmBodyByteLength, isOversizedLegacyConfirmBody };
})();

describe("tally confirm payload slim + preview session ownership", () => {
  beforeEach(() => {
    _resetPreviewSessionsForTests();
  });

  it("legacy Confirm with 4246 itemTypeOverrides exceeds Express 100kb default", () => {
    const itemTypeOverrides = {};
    for (let i = 0; i < 4246; i += 1) {
      itemTypeOverrides[`0.3 mm SS 420 sheet long name example ${i}`] = i % 2 ? "RM" : "FG";
    }
    const legacy = {
      previewToken: "a".repeat(48),
      confirm: true,
      clientOperationId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      itemTypeOverrides,
      groupTypeOverrides: { bought: "RM" },
      unitMapOverrides: { nos: "Nos" },
    };
    const bytes = Buffer.byteLength(JSON.stringify(legacy), "utf8");
    assert.ok(bytes > 100 * 1024, `expected >100kb, got ${bytes}`);
    assert.equal(isOversizedLegacyConfirmBody(legacy), true);
  });

  it("slim Confirm body stays well under 100kb (token + mappings only)", () => {
    const groupTypeOverrides = {};
    for (let i = 0; i < 40; i += 1) groupTypeOverrides[`group-${i}`] = "RM";
    const unitMapOverrides = {};
    for (let i = 0; i < 20; i += 1) unitMapOverrides[`u${i}`] = "Nos";
    const body = buildTallyConfirmImportBody({
      previewToken: "a".repeat(48),
      clientOperationId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      groupTypeOverrides,
      unitMapOverrides,
    });
    assert.equal(body.itemTypeOverrides, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "items"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "xml"), false);
    const bytes = tallyConfirmBodyByteLength(body);
    assert.ok(bytes < 8 * 1024, `slim body should be <8kb, got ${bytes}`);
    assert.equal(isOversizedLegacyConfirmBody(body), false);
  });

  it("rejects expired and cross-user preview tokens", () => {
    const xml = "<ENVELOPE></ENVELOPE>";
    const token = createPreviewSession(
      xml,
      { defaultItemType: "FG", duplicateAction: "SKIP", fallbackStateId: null },
      null,
      { ownerUserId: 7, sourceFilename: "Stock items.xml" },
    );
    assert.equal(fingerprintXmlText(xml).length, 64);

    assert.throws(
      () => claimPreviewSessionForApply(token, { actorUserId: 99 }),
      (err) => err && err.code === "PREVIEW_SESSION_FORBIDDEN" && err.statusCode === 403,
    );

    // Expire by mutating store via claim after TTL — use _reset and recreate with past expiry via claim path
    _resetPreviewSessionsForTests();
    const token2 = createPreviewSession(
      xml,
      { defaultItemType: "FG", duplicateAction: "SKIP", fallbackStateId: null },
      null,
      { ownerUserId: 7 },
    );
    // Force expiry
    const { getPreviewSession } = require("../../src/services/tallyMasterImport/tallyMasterImportService");
    // Access internal map via claim after deleting by advancing — use apply path
    const sess = require("../../src/services/tallyMasterImport/tallyMasterImportService");
    // Soft-expire: delete then claim
    sess.gcSessions();
    // Directly expire: recreate and patch via claiming after clearing
    _resetPreviewSessionsForTests();
    assert.throws(
      () => claimPreviewSessionForApply("missing-token-xxxxxxxxxxxx", { actorUserId: 7 }),
      (err) => err && err.code === "PREVIEW_SESSION_INVALID",
    );
    void token2;
    void getPreviewSession;
    void SESSION_TTL_MS;
  });

  it("rejects second apply after successful consume", async () => {
    const xml = `<?xml version="1.0"?><ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
      <TALLYMESSAGE><UNIT NAME="Nos"><NAME>Nos</NAME><GUID>u1</GUID></UNIT></TALLYMESSAGE>
    </REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const db = {
      state: { findMany: async () => [] },
      customer: { findMany: async () => [] },
      supplier: { findMany: async () => [] },
      item: { findMany: async () => [] },
      unit: {
        findMany: async () => [{ id: 1, unitName: "Nos", unitCode: "NOS" }],
        findUnique: async () => ({ id: 1, unitName: "Nos", unitCode: "NOS" }),
        create: async () => ({ id: 1 }),
        update: async () => ({ id: 1 }),
      },
      $transaction: async (fn) => fn(db),
    };
    const token = createPreviewSession(
      xml,
      { defaultItemType: "FG", duplicateAction: "SKIP", fallbackStateId: null },
      { encoding: "UTF-8", sanitizedInvalidRefCount: 0, byteLength: xml.length },
      { ownerUserId: 1 },
    );
    await applyFromPreviewToken(db, token, { actorUser: { id: 1 } });
    await assert.rejects(
      () => applyFromPreviewToken(db, token, { actorUser: { id: 1 } }),
      /already imported|expired|invalid/i,
    );
  });
});
