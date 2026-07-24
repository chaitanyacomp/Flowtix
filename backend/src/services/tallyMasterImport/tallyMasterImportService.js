const crypto = require("crypto");
const {
  normalizeMasterNameDisplay,
  normalizeMasterNameKey,
} = require("../masterNameNormalize");
const { normalizeGstinOnSave, resolveImportGstin, cleanGstinChars } = require("../gstinNormalize");
const { normalizeHsnOnSave } = require("../hsnNormalize");
const { normalizeUnitKey } = require("../unitMaster");
const { parseTallyMastersXml, strVal } = require("./parseTallyMastersXml");
const { mapLedgerToParty, buildPartyMapDiagnostics, ledgerDisplayName, TALLY_IMPORT_PIPELINE_ID } = require("./mapLedgerToParty");
const {
  mapStockItemToItem,
  mapTallyUnitMaster,
  buildStockGroupTaxLookup,
  resolveStockItemTaxFromStockGroups,
} = require("./mapStockItemToItem");
const {
  buildGroupMappingTable,
  buildUnitMappingTable,
  normalizeGroupKey,
  resolveErpItemType,
  suggestUnitMapping,
  suggestGroupMapping,
} = require("./tallyMasterGroupUnitMapping");
const { logActivity } = require("../activityLogService");
const {
  findEquivalentUnit,
  normalizeUnitCode: normalizeImportedUnitCode,
  unitFamily,
  cleanUnitCreateError,
} = require("./tallyUnitIdentity");

/** @typedef {"SKIP" | "UPDATE_EMPTY_FIELDS_ONLY"} DuplicateAction */
/** @typedef {"RM" | "FG"} DefaultItemType */

const SESSION_TTL_MS = 30 * 60 * 1000;
/** Pilot stock master XML ~64.5 MB UTF-16 — scoped to this router only (does not raise global API limits). */
const MAX_XML_BYTES = 72 * 1024 * 1024;
/** Apply writes in transactional batches so a failed batch does not leave an unexplained half-import. */
const IMPORT_BATCH_SIZE = 100;
/**
 * Confirm Import JSON body is intentionally tiny (token + mapping tables only).
 * Route-specific parser limit (see createApp) — measured max with large group/unit maps stays well under this.
 */
const TALLY_APPLY_JSON_LIMIT = "256kb";

/**
 * Allow tests to shrink batch size (e.g. simulate batch 20 of 43 with small fixtures).
 * @param {{ importBatchSize?: number } | null | undefined} options
 */
function resolveImportBatchSize(options) {
  const fromOpt = options && Number(options.importBatchSize);
  if (Number.isFinite(fromOpt) && fromOpt >= 1 && fromOpt <= 500) return Math.floor(fromOpt);
  const fromEnv = Number(process.env.TALLY_IMPORT_BATCH_SIZE);
  if (Number.isFinite(fromEnv) && fromEnv >= 1 && fromEnv <= 500) return Math.floor(fromEnv);
  return IMPORT_BATCH_SIZE;
}

/**
 * @typedef {{
 *   xmlUtf8: string;
 *   options: NormalizedOptions;
 *   decodeMeta: Record<string, unknown> | null;
 *   expiresAt: number;
 *   createdAt: number;
 *   ownerUserId: number | null;
 *   sourceFingerprint: string | null;
 *   sourceFilename: string | null;
 *   status: "ready" | "importing" | "consumed" | "failed";
 *   mappingSummary: Record<string, unknown> | null;
 * }} TallyPreviewSession
 */

/** @type {Map<string, TallyPreviewSession>} */
const previewSessions = new Map();

/**
 * @typedef {{
 *   defaultItemType: DefaultItemType;
 *   fallbackStateId: number | null;
 *   duplicateAction: DuplicateAction;
 *   itemTypeFgKeywords?: string[];
 *   itemTypeRmKeywords?: string[];
 * }} NormalizedOptions
 */

function gcSessions() {
  const now = Date.now();
  for (const [k, v] of previewSessions) {
    if (v.expiresAt < now) previewSessions.delete(k);
  }
}

/**
 * SHA-256 fingerprint of decoded XML text (hex).
 * @param {string} xmlUtf8
 */
function fingerprintXmlText(xmlUtf8) {
  return crypto.createHash("sha256").update(String(xmlUtf8 || ""), "utf8").digest("hex");
}

/**
 * @param {string} xmlUtf8
 * @param {NormalizedOptions} options
 * @param {Record<string, unknown> | null} [decodeMeta]
 * @param {{
 *   ownerUserId?: number | null;
 *   sourceFilename?: string | null;
 *   sourceFingerprint?: string | null;
 *   mappingSummary?: Record<string, unknown> | null;
 * }} [meta]
 * @returns {string}
 */
function createPreviewSession(xmlUtf8, options, decodeMeta = null, meta = {}) {
  gcSessions();
  const token = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  previewSessions.set(token, {
    xmlUtf8,
    options,
    decodeMeta: decodeMeta || null,
    expiresAt: now + SESSION_TTL_MS,
    createdAt: now,
    ownerUserId: meta.ownerUserId != null && Number.isFinite(Number(meta.ownerUserId)) ? Number(meta.ownerUserId) : null,
    sourceFingerprint: meta.sourceFingerprint || fingerprintXmlText(xmlUtf8),
    sourceFilename: meta.sourceFilename || options?.sourceFilename || null,
    status: "ready",
    mappingSummary: meta.mappingSummary || null,
  });
  return token;
}

/**
 * @param {string} token
 * @returns {TallyPreviewSession | null}
 */
function getPreviewSessionRaw(token) {
  gcSessions();
  const s = previewSessions.get(String(token || ""));
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    previewSessions.delete(String(token || ""));
    return null;
  }
  return s;
}

/**
 * @param {string} token
 * @returns {{ xmlUtf8: string; options: NormalizedOptions; decodeMeta: Record<string, unknown> | null } | null}
 */
function getPreviewSession(token) {
  const s = getPreviewSessionRaw(token);
  if (!s) return null;
  return { xmlUtf8: s.xmlUtf8, options: s.options, decodeMeta: s.decodeMeta || null };
}

/**
 * Validate ownership / expiry / status for Confirm Import.
 * @param {string} token
 * @param {{ actorUserId?: number | null; allowConsumedRetry?: boolean }} [opts]
 */
function claimPreviewSessionForApply(token, opts = {}) {
  const s = getPreviewSessionRaw(token);
  if (!s) {
    const err = new Error("Preview session expired or invalid. Run Preview again.");
    err.statusCode = 400;
    err.code = "PREVIEW_SESSION_INVALID";
    throw err;
  }
  if (s.status === "consumed") {
    const err = new Error("This preview was already imported. Run Preview again to import the same file.");
    err.statusCode = 409;
    err.code = "PREVIEW_SESSION_CONSUMED";
    throw err;
  }
  if (s.status === "importing") {
    const err = new Error("This preview import is already in progress. Wait for it to finish.");
    err.statusCode = 409;
    err.code = "PREVIEW_SESSION_IN_FLIGHT";
    throw err;
  }
  const actorId = opts.actorUserId != null ? Number(opts.actorUserId) : null;
  if (s.ownerUserId != null && actorId != null && s.ownerUserId !== actorId) {
    const err = new Error("This preview belongs to another user. Run Preview again under your account.");
    err.statusCode = 403;
    err.code = "PREVIEW_SESSION_FORBIDDEN";
    throw err;
  }
  s.status = "importing";
  s.expiresAt = Date.now() + SESSION_TTL_MS; // refresh TTL while importing
  return s;
}

function markPreviewSessionConsumed(token) {
  const s = previewSessions.get(String(token || ""));
  if (!s) return;
  s.status = "consumed";
  // Keep briefly so a duplicate submit gets CONSUMED rather than INVALID, then GC by TTL.
}

function markPreviewSessionReady(token) {
  const s = previewSessions.get(String(token || ""));
  if (!s) return;
  if (s.status === "importing" || s.status === "failed") s.status = "ready";
}

function deletePreviewSession(token) {
  previewSessions.delete(String(token || ""));
}

/** Test helper */
function _resetPreviewSessionsForTests() {
  previewSessions.clear();
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isEmptyField(v) {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return !Number.isFinite(v);
  return false;
}

/**
 * Persist exact Tally master identity on create.
 * @param {{ tallyName?: string | null; tallyGuid?: string | null }} row
 */
function tallyIdentityCreateData(row) {
  const tallyName = typeof row?.tallyName === "string" && row.tallyName.trim() ? row.tallyName.trim() : null;
  const tallyGuid = typeof row?.tallyGuid === "string" && row.tallyGuid.trim() ? row.tallyGuid.trim().slice(0, 64) : null;
  return {
    tallyName,
    tallyGuid,
    tallyImportedAt: new Date(),
  };
}

/**
 * Backfill empty Tally identity on existing ERP rows (including SKIP_DUPLICATE).
 * Only touches tallyName / tallyGuid / tallyImportedAt — never business fields.
 * @param {{ tallyName?: string | null; tallyGuid?: string | null; tallyImportedAt?: Date | null }} ex
 * @param {{ tallyName?: string | null; tallyGuid?: string | null }} row
 */
function tallyIdentityBackfillPatch(ex, row) {
  const patch = {};
  const tallyName = typeof row?.tallyName === "string" && row.tallyName.trim() ? row.tallyName.trim() : null;
  const tallyGuid = typeof row?.tallyGuid === "string" && row.tallyGuid.trim() ? row.tallyGuid.trim().slice(0, 64) : null;
  if (isEmptyField(ex?.tallyName) && tallyName) patch.tallyName = tallyName;
  if (isEmptyField(ex?.tallyGuid) && tallyGuid) patch.tallyGuid = tallyGuid;
  if (!ex?.tallyImportedAt && (tallyName || tallyGuid || ex?.tallyName || ex?.tallyGuid)) {
    patch.tallyImportedAt = new Date();
  }
  return patch;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isPrismaMissingColumnError(err) {
  if (!err || typeof err !== "object") return false;
  const code = /** @type {{ code?: string }} */ (err).code;
  if (code === "P2022") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /Unknown column|does not exist in the current database|Unknown arg.*tally(Name|Guid|ImportedAt)/i.test(msg);
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isPrismaValidationError(err) {
  if (!err || typeof err !== "object") return false;
  const name = /** @type {{ name?: string; constructor?: { name?: string } }} */ (err).name
    || err.constructor?.name
    || "";
  return name === "PrismaClientValidationError" || isPrismaMissingColumnError(err);
}

/**
 * Human-readable apply failure for a single master row.
 * @param {string} entityLabel
 * @param {string} masterName
 * @param {string} field
 * @param {string} reason
 */
function formatImportRowError(entityLabel, masterName, field, reason) {
  const name = String(masterName || "").trim() || "(unnamed)";
  const f = String(field || "").trim();
  const r = String(reason || "").trim() || "Import failed.";
  if (f) return `${entityLabel} '${name}': ${f} — ${r}`;
  return `${entityLabel} '${name}': ${r}`;
}

/**
 * Match an existing party by authoritative identity: tallyGuid → exact Tally name → GSTIN.
 * Strategies are tried in order; a unique hit wins. Conflicting unique hits across strategies
 * (e.g. name→A and GSTIN→B) are ambiguous and require user mapping.
 *
 * @param {{
 *   tallyGuid: string | null;
 *   tallyName: string;
 *   displayName: string;
 *   gstNorm: string | null;
 *   byGuid: Map<string, object>;
 *   byTallyName: Map<string, object>;
 *   byDisplayName: Map<string, object>;
 *   byGstin: Map<string, object>;
 *   entityLabel: string;
 * }} args
 * @returns {{ match: object | null; ambiguous: boolean; error: string | null; matchVia: string[] }}
 */
function resolveExistingPartyMatch(args) {
  const guid = typeof args.tallyGuid === "string" && args.tallyGuid.trim() ? args.tallyGuid.trim().toLowerCase() : null;
  if (guid) {
    const byGuid = args.byGuid.get(guid);
    if (byGuid) {
      return { match: byGuid, ambiguous: false, error: null, matchVia: ["tallyGuid"] };
    }
  }

  const tallyKey = normalizeMasterNameKey(args.tallyName);
  const displayKey = normalizeMasterNameKey(args.displayName);
  /** @type {Map<number, { row: object; via: string }>} */
  const nameHits = new Map();
  if (tallyKey) {
    const row = args.byTallyName.get(tallyKey);
    if (row?.id != null) nameHits.set(Number(row.id), { row, via: "tallyName" });
  }
  if (displayKey) {
    const row = args.byDisplayName.get(displayKey);
    if (row?.id != null && !nameHits.has(Number(row.id))) {
      nameHits.set(Number(row.id), { row, via: "name" });
    } else if (row?.id != null && nameHits.has(Number(row.id))) {
      // same id already recorded
    }
  }
  if (nameHits.size > 1) {
    const labels = [...nameHits.values()].map((h) => String(h.row.tallyName || h.row.name || `#${h.row.id}`));
    return {
      match: null,
      ambiguous: true,
      error: `Ambiguous match (candidates: ${labels.join(", ")}). Map the existing master explicitly instead of guessing.`,
      matchVia: [],
    };
  }

  const nameHit = nameHits.size === 1 ? [...nameHits.values()][0] : null;
  const gstHit = args.gstNorm ? args.byGstin.get(args.gstNorm) : null;

  if (nameHit && gstHit && Number(nameHit.row.id) !== Number(gstHit.id)) {
    const a = String(nameHit.row.tallyName || nameHit.row.name || `#${nameHit.row.id}`);
    const b = String(gstHit.tallyName || gstHit.name || `#${gstHit.id}`);
    return {
      match: null,
      ambiguous: true,
      error: `Ambiguous match (candidates: ${a}, ${b}). Map the existing master explicitly instead of guessing.`,
      matchVia: [],
    };
  }

  if (nameHit) {
    return { match: nameHit.row, ambiguous: false, error: null, matchVia: [nameHit.via] };
  }
  if (gstHit) {
    return { match: gstHit, ambiguous: false, error: null, matchVia: ["gstin"] };
  }
  return { match: null, ambiguous: false, error: null, matchVia: [] };
}

/**
 * Apply identity-only backfill for a SKIP_DUPLICATE row. Never throws out of this helper.
 * @returns {Promise<"UPDATED" | "SKIPPED" | "FAILED">}
 */
async function applyIdentityBackfillSafe(db, model, existingErpId, row, entityType, pushResult) {
  if (!existingErpId) {
    pushResult(entityType, row.tallyName, "SKIPPED", null, null, row.warnings?.[0] || null);
    return "SKIPPED";
  }
  try {
    const ex = await db[model].findUnique({
      where: { id: existingErpId },
      select: { id: true, tallyName: true, tallyGuid: true, tallyImportedAt: true },
    });
    if (!ex) {
      pushResult(entityType, row.tallyName, "SKIPPED", existingErpId, null, row.warnings?.[0] || null);
      return "SKIPPED";
    }
    const idPatch = tallyIdentityBackfillPatch(ex, row);
    if (Object.keys(idPatch).length) {
      await db[model].update({ where: { id: ex.id }, data: idPatch });
      pushResult(
        entityType,
        row.tallyName,
        "UPDATED",
        ex.id,
        null,
        "Tally identity backfilled (tallyName / tallyGuid / tallyImportedAt only).",
      );
      return "UPDATED";
    }
    pushResult(entityType, row.tallyName, "SKIPPED", existingErpId, null, row.warnings?.[0] || null);
    return "SKIPPED";
  } catch (e) {
    let reason = e instanceof Error ? e.message : String(e);
    if (isPrismaValidationError(e) || isPrismaMissingColumnError(e)) {
      reason =
        "Tally identity columns are missing or the Prisma client is out of date. Apply migration 20260721180000_tally_master_identity and run npx prisma generate.";
    }
    pushResult(
      entityType,
      row.tallyName,
      "FAILED",
      existingErpId,
      formatImportRowError(entityType === "CUSTOMER" ? "Customer" : entityType === "SUPPLIER" ? "Supplier" : entityType, row.tallyName, "Tally identity", reason),
      null,
    );
    return "FAILED";
  }
}

async function rebuildPreviewFromToken(db, token, mappingOptions, actorUserId) {
  const s = getPreviewSessionRaw(token);
  if (!s || s.status !== "ready") {
    const err = new Error("Preview session expired, invalid, or currently in use. Run Preview again.");
    err.statusCode = 409;
    err.code = "PREVIEW_SESSION_INVALID";
    throw err;
  }
  const actorId = actorUserId != null ? Number(actorUserId) : null;
  if (s.ownerUserId != null && actorId != null && s.ownerUserId !== actorId) {
    const err = new Error("This preview belongs to another user.");
    err.statusCode = 403;
    err.code = "PREVIEW_SESSION_FORBIDDEN";
    throw err;
  }
  const options = {
    ...s.options,
    groupTypeOverrides: mappingOptions?.groupTypeOverrides || {},
    unitMapOverrides: mappingOptions?.unitMapOverrides || {},
  };
  const payload = await buildPreviewPayload(db, s.xmlUtf8, options, s.decodeMeta);
  if (payload.ok) s.options = options;
  return payload;
}

/**
 * Recheck unit identity and create atomically. A concurrent equivalent create is
 * resolved to REUSED; unrelated unique conflicts return a sanitized business failure.
 */
async function createOrReuseImportedUnit(db, row) {
  const select = {
    id: true,
    unitName: true,
    unitCode: true,
    tallyName: true,
    tallyUnitSymbol: true,
  };
  const candidate = {
    unitName: row.mapped.unitName,
    unitCode: row.mapped.unitCode || null,
    tallyName: row.tallyName,
    tallyUnitSymbol: row.mapped.tallyUnitSymbol || null,
  };

  const perform = async (tx) => {
    const current = await tx.unit.findMany({ where: { isActive: true }, select });
    const existing = findEquivalentUnit(current, candidate);
    if (existing) return { outcome: "REUSED", row: existing };
    const created = await tx.unit.create({
      data: {
        unitName: candidate.unitName,
        unitCode: candidate.unitCode,
        tallyUnitSymbol: candidate.tallyUnitSymbol,
        isActive: true,
        ...tallyIdentityCreateData(row),
      },
      select,
    });
    return { outcome: "CREATED", row: created };
  };

  try {
    return await db.$transaction(perform);
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : null;
    if (code === "P2002") {
      const current = await db.unit.findMany({ where: { isActive: true }, select });
      const existing = findEquivalentUnit(current, candidate);
      if (existing) return { outcome: "REUSED", row: existing };
      return { outcome: "FAILED", ...cleanUnitCreateError() };
    }
    throw error;
  }
}

async function backfillReusedUnitIdentity(db, row, pushResult) {
  const existing = await db.unit.findUnique({
    where: { id: row.existingErpId },
    select: {
      id: true,
      tallyName: true,
      tallyGuid: true,
      tallyImportedAt: true,
      tallyUnitSymbol: true,
    },
  });
  if (!existing) {
    pushResult("UNIT", row.tallyName, "SKIPPED", row.existingErpId, null, "Equivalent unit is no longer available.");
    return "SKIPPED";
  }
  const patch = tallyIdentityBackfillPatch(existing, row);
  if (isEmptyField(existing.tallyUnitSymbol) && row.mapped.tallyUnitSymbol) {
    patch.tallyUnitSymbol = row.mapped.tallyUnitSymbol;
  }
  if (!Object.keys(patch).length) {
    pushResult("UNIT", row.tallyName, "REUSED", existing.id, null, row.warnings?.[0] || null);
    return "SKIPPED";
  }
  await db.unit.update({ where: { id: existing.id }, data: patch });
  pushResult("UNIT", row.tallyName, "REUSED", existing.id, null, "Equivalent ERP unit reused; Tally identity was backfilled.");
  return "UPDATED";
}

/** Simple email check to avoid Prisma issues. */
function safeEmailOrNull(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return null;
  return t.slice(0, 254);
}

/**
 * @param {string | null} gstin
 * @param {Map<string, { id: number }>} statesByCode
 * @returns {number | null}
 */
function stateIdFromGstinPrefix(gstin, statesByCode) {
  const g = cleanGstinChars(gstin);
  if (!g || g.length < 2) return null;
  const code = g.slice(0, 2);
  if (!/^\d{2}$/.test(code)) return null;
  const hit = statesByCode.get(code);
  return hit ? hit.id : null;
}

/**
 * Structured preview/import field issue (also rendered as a readable warning string).
 * @param {{
 *   masterName: string;
 *   masterType: string;
 *   field: string;
 *   actualValue: unknown;
 *   reason: string;
 *   disposition?: string;
 * }} issue
 */
function formatFieldIssue(issue) {
  const val =
    issue.actualValue == null || String(issue.actualValue).trim() === ""
      ? "(empty)"
      : String(issue.actualValue).trim();
  const cleanedLen = issue.field === "GSTIN" ? cleanGstinChars(val === "(empty)" ? "" : val).length : null;
  const reason =
    cleanedLen != null && issue.reason.includes("exactly 15")
      ? `${issue.reason} (found ${cleanedLen} alphanumeric characters)`
      : issue.reason;
  const disposition = issue.disposition ? ` — ${issue.disposition}` : "";
  return {
    masterName: issue.masterName,
    masterType: issue.masterType,
    field: issue.field,
    actualValue: val === "(empty)" ? null : val,
    reason,
    message: `${issue.masterType} "${issue.masterName}" · Field ${issue.field} · Value "${val}" · ${reason}${disposition}`,
  };
}

/**
 * @param {string[] } warnings
 * @param {object[]} fieldIssues
 * @param {Parameters<typeof formatFieldIssue>[0]} issue
 */
function pushFieldIssue(warnings, fieldIssues, issue) {
  const formatted = formatFieldIssue(issue);
  warnings.push(formatted.message);
  fieldIssues.push(formatted);
}

/**
 * Preview status for UI: ERROR | WARNING | OK
 * @param {string} proposedAction
 * @param {string[]} rowWarnings
 * @param {string[]} rowErrors
 */
function rowPreviewStatus(proposedAction, rowWarnings, rowErrors) {
  if (proposedAction === "ERROR" || rowErrors.length) return "ERROR";
  if (proposedAction === "CONFLICT") return "WARNING";
  if (rowWarnings.length) return "WARNING";
  return "OK";
}

/**
 * Normalize free-text state labels for matching ERP masters (e.g. "Maharashtra (27)") vs Tally ("Maharashtra").
 * @param {string | null | undefined} raw
 * @returns {string}
 */
function normalizeStateTextForMatch(raw) {
  if (raw == null) return "";
  let t = String(raw).trim().toLowerCase();
  if (!t) return "";
  t = t.replace(/\s*\(\s*\d{1,2}\s*\)\s*$/u, "").trim();
  t = t.replace(/\s*\(\s*[a-z]{2,4}\s*\)\s*$/iu, "").trim();
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/**
 * @param {string | null} stateText
 * @param {{ id: number; stateName: string; stateCode: string }[]} states
 * @returns {number | null}
 */
function stateIdFromStateText(stateText, states) {
  if (!stateText || !String(stateText).trim()) return null;
  const rawTrim = String(stateText).trim();
  const rawLower = rawTrim.toLowerCase();
  const normalized = normalizeStateTextForMatch(stateText);

  for (const s of states) {
    if (normalizeStateTextForMatch(s.stateName) === normalized) return s.id;
  }
  for (const s of states) {
    if (s.stateCode === rawTrim) return s.id;
    if (s.stateCode.toLowerCase() === rawLower && /^\d{2}$/.test(s.stateCode)) return s.id;
  }
  for (const s of states) {
    if (s.stateName.toLowerCase() === rawLower) return s.id;
  }
  for (const s of states) {
    const sn = normalizeStateTextForMatch(s.stateName);
    if (sn && normalized && (normalized.includes(sn) || sn.includes(normalized))) {
      const minLen = Math.min(sn.length, normalized.length);
      if (minLen >= 4) return s.id;
    }
  }
  return null;
}

function normalizeDeliveryLabelKey(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Ensure new CustomerDeliveryAddress structure stays operational for imported masters.
 * - Creates/updates ONE default "Registered Office" delivery address
 * - Avoid duplicates on re-import
 *
 * @param {import("@prisma/client").PrismaClient} db
 * @param {number} customerId
 * @param {{ address: string | null; stateId: number | null; gst: string | null; contact: string | null; contactPerson?: string | null; phone?: string | null }} src
 * @param {"CREATE" | "UPDATE_EMPTY_FIELDS"} mode
 */
async function upsertRegisteredOfficeDeliveryAddress(db, customerId, src, mode) {
  if (!customerId) return;
  const label = "Registered Office";
  const labelKey = normalizeDeliveryLabelKey(label);

  const existing = await db.customerDeliveryAddress.findMany({
    where: { customerId },
    select: {
      id: true,
      label: true,
      isDefault: true,
      address: true,
      stateId: true,
      gst: true,
      contactPerson: true,
      phone: true,
      pincode: true,
      country: true,
      locationType: true,
    },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    take: 20,
  });
  const byLabel = existing.find((r) => normalizeDeliveryLabelKey(r.label) === labelKey) ?? null;
  const target = byLabel ?? existing.find((r) => r.isDefault) ?? null;
  const hasDefault = existing.some((r) => r.isDefault);

  const desired = {
    label,
    locationType: "REGISTERED_OFFICE",
    address: src.address || null,
    city: null,
    district: null,
    stateId: src.stateId || null,
    pincode: src.pincode || null,
    country: src.country || null,
    gst: src.gst || null,
    contactPerson: src.contactPerson || src.contact || null,
    phone: src.phone || null,
    email: src.email || null,
    notes: null,
    isActive: true,
  };

  if (!target) {
    await db.customerDeliveryAddress.create({
      data: { customerId, ...desired, isDefault: !hasDefault },
      select: { id: true },
    });
    return;
  }

  const patch = {};
  if (mode === "CREATE") {
    patch.label = desired.label;
    patch.locationType = desired.locationType;
    patch.address = desired.address;
    patch.stateId = desired.stateId;
    patch.pincode = desired.pincode;
    patch.country = desired.country;
    patch.gst = desired.gst;
    patch.contactPerson = desired.contactPerson;
    patch.phone = desired.phone;
    patch.email = desired.email;
    patch.isActive = true;
    if (!hasDefault || target.isDefault) patch.isDefault = true;
  } else {
    if (isEmptyField(target.label) && desired.label) patch.label = desired.label;
    if (!target.locationType || target.locationType === "OTHER") patch.locationType = "REGISTERED_OFFICE";
    if (isEmptyField(target.address) && desired.address) patch.address = desired.address;
    if (isEmptyField(target.stateId) && desired.stateId) patch.stateId = desired.stateId;
    if (isEmptyField(target.pincode) && desired.pincode) patch.pincode = desired.pincode;
    if (isEmptyField(target.country) && desired.country) patch.country = desired.country;
    if (isEmptyField(target.gst) && desired.gst) patch.gst = desired.gst;
    if (isEmptyField(target.contactPerson) && desired.contactPerson) patch.contactPerson = desired.contactPerson;
    if (isEmptyField(target.phone) && desired.phone) patch.phone = desired.phone;
    if (target.isActive === false) patch.isActive = true;
    if (!hasDefault) patch.isDefault = true;
  }
  if (Object.keys(patch).length) {
    await db.customerDeliveryAddress.update({ where: { id: target.id }, data: patch });
  }
}

/**
 * Ensure SupplierLocation structure stays operational for imported masters.
 * - Creates/updates ONE default "Registered Office" supply location
 * - Avoid duplicates on re-import
 *
 * @param {import("@prisma/client").PrismaClient} db
 * @param {number} supplierId
 * @param {{ address: string | null; stateId: number | null; gst: string | null; contact: string | null; contactPerson?: string | null; phone?: string | null }} src
 * @param {"CREATE" | "UPDATE_EMPTY_FIELDS"} mode
 */
async function upsertRegisteredOfficeSupplierLocation(db, supplierId, src, mode) {
  if (!supplierId) return;
  const label = "Registered Office";
  const labelKey = normalizeDeliveryLabelKey(label);

  const existing = await db.supplierLocation.findMany({
    where: { supplierId },
    select: { id: true, label: true, isDefault: true, address: true, stateId: true, gst: true, contactPerson: true, phone: true },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    take: 20,
  });
  const byLabel = existing.find((r) => normalizeDeliveryLabelKey(r.label) === labelKey) ?? null;
  const target = byLabel ?? existing.find((r) => r.isDefault) ?? null;

  const desired = {
    label,
    address: src.address || null,
    city: null,
    stateId: src.stateId || null,
    gst: src.gst || null,
    contactPerson: src.contactPerson || src.contact || null,
    phone: src.phone || null,
    isDefault: true,
    isActive: true,
  };

  if (!target) {
    await db.supplierLocation.create({
      data: { supplierId, ...desired },
      select: { id: true },
    });
    return;
  }

  const patch = {};
  if (!target.isDefault) patch.isDefault = true;
  if (mode === "CREATE") {
    patch.label = desired.label;
    patch.address = desired.address;
    patch.stateId = desired.stateId;
    patch.gst = desired.gst;
    patch.contactPerson = desired.contactPerson;
    patch.phone = desired.phone;
    patch.isActive = true;
  } else {
    if (isEmptyField(target.label) && desired.label) patch.label = desired.label;
    if (isEmptyField(target.address) && desired.address) patch.address = desired.address;
    if (isEmptyField(target.stateId) && desired.stateId) patch.stateId = desired.stateId;
    if (isEmptyField(target.gst) && desired.gst) patch.gst = desired.gst;
    if (isEmptyField(target.contactPerson) && desired.contactPerson) patch.contactPerson = desired.contactPerson;
    if (isEmptyField(target.phone) && desired.phone) patch.phone = desired.phone;
    if (target.isActive === false) patch.isActive = true;
  }
  if (Object.keys(patch).length) {
    await db.supplierLocation.update({ where: { id: target.id }, data: patch });
  }
}

/**
 * @param {number | null} gstRate
 * @returns {number | null} null = Unresolved/Inherited (never silently coerce blank → 0%)
 */
function normalizeGstRateForItem(gstRate) {
  if (gstRate == null || !Number.isFinite(gstRate)) return null;
  if (gstRate < 0) return null;
  if (gstRate > 100) return 100;
  return Math.round(gstRate * 100) / 100;
}

/**
 * @param {{ tallyName: string; mapped: Record<string, unknown> }} row
 * @param {Record<string, string> | undefined} itemOverrides
 * @param {Record<string, string> | undefined} groupOverrides
 * @param {NormalizedOptions} options
 * @returns {"RM" | "FG" | "SFG" | "CONSUMABLE" | null}
 */
function resolveItemTypeForApply(row, itemOverrides, groupOverrides, options) {
  const perItem = itemOverrides && typeof itemOverrides === "object" ? itemOverrides[row.tallyName] : undefined;
  if (perItem != null && String(perItem).trim() !== "") {
    return resolveErpItemType(perItem);
  }
  const groupKey = normalizeGroupKey(/** @type {string} */ (row.mapped?.parentGroup));
  const fromGroupRaw =
    groupOverrides && typeof groupOverrides === "object"
      ? groupOverrides[groupKey] || groupOverrides[/** @type {string} */ (row.mapped?.parentGroup)]
      : undefined;
  if (fromGroupRaw != null && String(fromGroupRaw).trim() !== "") {
    return resolveErpItemType(fromGroupRaw);
  }
  const mappedChoice = row.mapped?.mappingChoice || row.mapped?.suggestedItemType;
  const fromMapped = resolveErpItemType(/** @type {string} */ (mappedChoice));
  if (fromMapped) return fromMapped;
  const auto = row.mapped?.autoDetectedItemType;
  if (auto === "RM" || auto === "FG" || auto === "SFG" || auto === "CONSUMABLE") return auto;
  if (row.mapped?.importAction === "EXCLUDE") return null;
  void options;
  return null;
}

/**
 * @param {import("@prisma/client").PrismaClient} db
 * @param {string} xmlString
 * @param {NormalizedOptions} options
 * @param {Record<string, unknown> | null} [decodeMeta]
 * @param {{ onProgress?: (p: { phase?: string; percent?: number; message?: string; recordsDetected?: number | null; recordsProcessed?: number | null; stockItemsProcessed?: number | null; stockItemsTotal?: number | null }) => void; preParsed?: object | null } | null} [progressOpts]
 */
async function buildPreviewPayload(db, xmlString, options, decodeMeta = null, progressOpts = null) {
  const onProgress = progressOpts && typeof progressOpts.onProgress === "function" ? progressOpts.onProgress : null;
  /** @type {any} */
  let parsed = progressOpts && progressOpts.preParsed ? progressOpts.preParsed : null;
  if (!parsed) {
    onProgress?.({ phase: "analysing", percent: 40, message: "Parsing Tally XML…" });
    parsed = parseTallyMastersXml(xmlString, decodeMeta, { onProgress });
  }
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, warnings: [], parseStats: null };
  }
  onProgress?.({
    phase: "analysing",
    percent: 86,
    message: `Parsed ${parsed.parseStats?.stockItemsParsed ?? 0} stock item(s), ${parsed.parseStats?.ledgersParsed ?? 0} ledger row(s)…`,
    recordsDetected: parsed.parseStats?.stockItemsParsed ?? null,
    recordsProcessed: parsed.parseStats?.stockItemsParsed ?? null,
    stockItemsProcessed: parsed.parseStats?.stockItemsParsed ?? null,
    stockItemsTotal: parsed.parseStats?.stockItemsParsed ?? null,
  });

  const parseStats = parsed.parseStats;

  const states = await db.state.findMany({
    where: { isActive: true },
    select: { id: true, stateName: true, stateCode: true },
    orderBy: { stateName: "asc" },
  });
  const statesByCode = new Map(states.map((s) => [s.stateCode, s]));

  const partySelectWithIdentity = {
    id: true,
    name: true,
    gst: true,
    address: true,
    stateId: true,
    contact: true,
    email: true,
    tallyName: true,
    tallyGuid: true,
    tallyImportedAt: true,
  };
  let identityColumnsAvailable = true;
  let customersDb;
  let suppliersDb;
  try {
    customersDb = await db.customer.findMany({
      select: { ...partySelectWithIdentity, state: true },
    });
    suppliersDb = await db.supplier.findMany({
      select: { ...partySelectWithIdentity, stateName: true, stateCode: true },
    });
  } catch (e) {
    if (!isPrismaMissingColumnError(e) && !isPrismaValidationError(e)) throw e;
    identityColumnsAvailable = false;
    customersDb = await db.customer.findMany({
      select: { id: true, name: true, gst: true, address: true, stateId: true, state: true, contact: true, email: true },
    });
    suppliersDb = await db.supplier.findMany({
      select: { id: true, name: true, gst: true, address: true, stateId: true, stateName: true, stateCode: true, contact: true, email: true },
    });
  }
  const itemsDb = await db.item.findMany({
    select: {
      id: true,
      itemName: true,
      hsnCode: true,
      gstRate: true,
      unitId: true,
      unit: true,
      itemType: true,
      tallyName: true,
      tallyGuid: true,
    },
  });
  const unitsDb = await db.unit.findMany({
    where: { isActive: true },
    select: { id: true, unitName: true, unitCode: true, tallyName: true, tallyUnitSymbol: true },
  });

  const customerByKey = new Map(customersDb.map((c) => [normalizeMasterNameKey(c.name), c]));
  const customerByTallyName = new Map(
    customersDb
      .filter((c) => c.tallyName)
      .map((c) => [normalizeMasterNameKey(c.tallyName), c]),
  );
  const customerByGuid = new Map(
    customersDb
      .filter((c) => c.tallyGuid)
      .map((c) => [String(c.tallyGuid).trim().toLowerCase(), c]),
  );
  const customerByGstin = new Map(
    customersDb
      .map((c) => ({ ...c, gstNorm: normalizeGstinOnSave(c.gst) }))
      .filter((c) => c.gstNorm)
      .map((c) => [c.gstNorm, c]),
  );
  const supplierByKey = new Map(suppliersDb.map((s) => [normalizeMasterNameKey(s.name), s]));
  const supplierByTallyName = new Map(
    suppliersDb
      .filter((s) => s.tallyName)
      .map((s) => [normalizeMasterNameKey(s.tallyName), s]),
  );
  const supplierByGuid = new Map(
    suppliersDb
      .filter((s) => s.tallyGuid)
      .map((s) => [String(s.tallyGuid).trim().toLowerCase(), s]),
  );
  const supplierByGstin = new Map(
    suppliersDb
      .map((s) => ({ ...s, gstNorm: normalizeGstinOnSave(s.gst) }))
      .filter((s) => s.gstNorm)
      .map((s) => [s.gstNorm, s]),
  );
  const itemByKey = new Map(itemsDb.map((it) => [normalizeMasterNameKey(it.itemName), it]));
  const itemByTallyName = new Map(
    itemsDb.filter((it) => it.tallyName).map((it) => [normalizeMasterNameKey(it.tallyName), it]),
  );
  const itemByGuid = new Map(
    itemsDb.filter((it) => it.tallyGuid).map((it) => [String(it.tallyGuid).trim().toLowerCase(), it]),
  );
  const unitByKey = new Map(unitsDb.map((u) => [normalizeUnitKey(u.unitName), u]));

  const stockKeywordOpts = {
    fgKeywords: options.itemTypeFgKeywords,
    rmKeywords: options.itemTypeRmKeywords,
  };

  onProgress?.({
    phase: "analysing",
    percent: 70,
    message: "Mapping parties and stock items for preview…",
    recordsDetected: parsed.parseStats?.stockItemsParsed ?? null,
  });

  const warnings = [...parsed.warnings];
  if (!identityColumnsAvailable) {
    warnings.push(
      "Tally identity columns (tallyName / tallyGuid) are not available on this database yet. Apply migration 20260721180000_tally_master_identity and regenerate the Prisma client so duplicate parties can store exact Tally names.",
    );
  }
  /** @type {unknown[]} */
  const partyDiagnostics = [];
  const customers = [];
  const suppliers = [];
  const items = [];
  const units = [];
  const tallyImportDebug =
    process.env.TALLY_IMPORT_DEBUG === "1" ||
    process.env.TALLY_IMPORT_DEBUG === "true" ||
    String(process.env.NODE_ENV || "").toLowerCase() === "development";

  /**
   * Preserve every UNIT master row for audit and preview. Operational equivalence
   * is resolved later; collapsing aliases here made XML UNIT counts disagree with
   * the preview and allowed Stage 2 to make a second, contradictory decision.
   * @type {Array<{ sourceKey: string; unitName: string; unitCode: string | null; tallyUnitSymbol: string | null; codeShortened: boolean; tallyGuid: string | null; sourceOrdinal: number }>}
   */
  const tallyUnitsToImport = [];
  const explicitUnitSourceKeys = new Set();
  const explicitUnitFamilies = new Set();

  for (const [sourceOrdinal, uRaw] of parsed.units.entries()) {
    const mu = mapTallyUnitMaster(uRaw);
    if (!mu) continue;
    const k = normalizeUnitKey(mu.unitName) || normalizeUnitKey(mu.unitCode);
    if (!k) continue;
    const normalizedCode = normalizeImportedUnitCode(mu.unitCode, mu.unitName);
    explicitUnitSourceKeys.add(k);
    const sourceFamily = unitFamily(mu.unitName) || unitFamily(mu.unitCode);
    if (sourceFamily) explicitUnitFamilies.add(sourceFamily);
    tallyUnitsToImport.push({
      sourceKey: k,
      unitName: normalizeMasterNameDisplay(mu.unitName),
      unitCode: normalizedCode.unitCode,
      tallyUnitSymbol: normalizedCode.originalSymbol,
      codeShortened: normalizedCode.shortened,
      tallyGuid: mu.tallyGuid || null,
      sourceOrdinal,
    });
  }

  /** Single mapStockItemToItem pass — reused for unit harvest and preview rows. */
  /** @type {NonNullable<ReturnType<typeof mapStockItemToItem>>[]} */
  const mappedStockItems = [];
  const stockTotal = parsed.stockItems.length;
  let stockMapped = 0;
  for (const sRaw of parsed.stockItems) {
    const mi = mapStockItemToItem(sRaw, stockKeywordOpts);
    stockMapped += 1;
    if (stockMapped % 100 === 0 || stockMapped === stockTotal) {
      onProgress?.({
        phase: "analysing",
        percent: stockTotal > 0 ? Math.min(92, Math.round(86 + (stockMapped / stockTotal) * 6)) : 88,
        message: `Mapping stock items… ${stockMapped.toLocaleString("en-IN")} of ${stockTotal.toLocaleString("en-IN")}`,
        recordsDetected: stockTotal,
        recordsProcessed: stockMapped,
        stockItemsProcessed: stockMapped,
        stockItemsTotal: stockTotal,
      });
    }
    if (!mi) continue;
    mappedStockItems.push(mi);
    if (mi.baseUnit) {
      const k = normalizeUnitKey(mi.baseUnit);
      const baseFamily = unitFamily(mi.baseUnit);
      if (k && !explicitUnitSourceKeys.has(k) && !(baseFamily && explicitUnitFamilies.has(baseFamily))) {
        explicitUnitSourceKeys.add(k);
        tallyUnitsToImport.push({
          sourceKey: k,
          unitName: normalizeMasterNameDisplay(mi.baseUnit),
          unitCode: null,
          tallyUnitSymbol: null,
          codeShortened: false,
          tallyGuid: null,
          sourceOrdinal: parsed.units.length + tallyUnitsToImport.length,
        });
      }
    }
  }

  for (const uData of tallyUnitsToImport) {
    const existing = findEquivalentUnit(unitsDb, {
      unitName: uData.unitName,
      unitCode: uData.unitCode,
      tallyName: uData.unitName,
      tallyUnitSymbol: uData.tallyUnitSymbol,
    });
    const tallyName = uData.unitName;
    let proposedAction = "CREATE";
    const rowWarnings = [];
    const rowErrors = [];
    const notApplicable = normalizeUnitKey(uData.unitName) === "not applicable";
    if (notApplicable) {
      proposedAction = "REVIEW";
      rowWarnings.push("Not Applicable is not a stock UOM. Exclude affected items or explicitly map a genuine ERP unit.");
    } else if (existing) {
      proposedAction = "REUSE";
      rowWarnings.push(`Equivalent ERP unit '${existing.unitName}' will be reused.`);
    }
    if (uData.codeShortened) {
      rowWarnings.push(
        `Tally symbol '${uData.tallyUnitSymbol}' was normalized to ERP code '${uData.unitCode}' (maximum 16 characters).`,
      );
    }
    units.push({
      entityType: "UNIT",
      tallyName,
      tallyGuid: uData.tallyGuid || null,
      proposedAction,
      existingErpId: existing ? existing.id : null,
      warnings: rowWarnings,
      errors: rowErrors,
      fieldIssues: [],
      status: rowPreviewStatus(proposedAction, rowWarnings, rowErrors),
      mapped: {
        unitName: uData.unitName,
        unitCode: uData.unitCode,
        tallyUnitSymbol: uData.tallyUnitSymbol,
        sourceKey: uData.sourceKey,
        sourceOrdinal: uData.sourceOrdinal,
        selectedErpUnitId: existing ? existing.id : null,
        selectedErpUnitName: existing ? existing.unitName : null,
        selectedErpUnitCode: existing ? existing.unitCode : null,
        authoritativeDecision: proposedAction,
      },
    });
  }

  for (const lRaw of parsed.ledgers) {
    const cust = mapLedgerToParty(lRaw, "CUSTOMER");
    if (cust) {
      const { gstRaw, gstNorm, gstMsg } = resolveImportGstin(cust.gst);
      const resolved = resolveExistingPartyMatch({
        tallyGuid: cust.tallyGuid || null,
        tallyName: cust.tallyName,
        displayName: cust.name,
        gstNorm,
        byGuid: customerByGuid,
        byTallyName: customerByTallyName,
        byDisplayName: customerByKey,
        byGstin: customerByGstin,
        entityLabel: "Customer",
      });
      const existing = resolved.match;

      const stateIdFromGst = gstNorm ? stateIdFromGstinPrefix(gstNorm, statesByCode) : null;
      const stateIdFromText = stateIdFromStateText(cust.stateText, states);
      const fallbackStateId =
        options.fallbackStateId && states.some((s) => s.id === options.fallbackStateId) ? options.fallbackStateId : null;
      const stateId = stateIdFromGst || stateIdFromText || fallbackStateId;

      const rowWarnings = [];
      const rowErrors = [];
      /** @type {ReturnType<typeof formatFieldIssue>[]} */
      const fieldIssues = [];
      if (gstMsg) {
        pushFieldIssue(rowWarnings, fieldIssues, {
          masterName: cust.name,
          masterType: "Customer",
          field: "GSTIN",
          actualValue: gstRaw,
          reason: gstMsg,
          disposition: "GSTIN will be left blank on import",
        });
      }
      if (stateIdFromGst && stateIdFromText && stateIdFromGst !== stateIdFromText) {
        rowWarnings.push("GSTIN state differs from Tally state. GSTIN state will be used.");
      }
      if (resolved.ambiguous && resolved.error) {
        pushFieldIssue(rowErrors, fieldIssues, {
          masterName: cust.tallyName || cust.name,
          masterType: "Customer",
          field: "Match",
          actualValue: cust.tallyName || cust.name,
          reason: resolved.error,
        });
      }
      if (existing && gstNorm && existing.gst) {
        const eg = normalizeGstinOnSave(existing.gst);
        if (eg && gstNorm && eg !== gstNorm) rowWarnings.push("GSTIN in Tally differs from existing customer record.");
      }
      if (existing && resolved.matchVia?.includes("gstin") && !resolved.matchVia.includes("name") && !resolved.matchVia.includes("tallyName")) {
        rowWarnings.push(
          `Matched existing customer '${existing.name}' by GSTIN (Tally ledger '${cust.tallyName}'). Identity will be backfilled; business fields are not overwritten.`,
        );
      }

      let proposedAction = "CREATE";
      if (rowErrors.length) {
        proposedAction = "ERROR";
      } else if (existing) {
        if (options.duplicateAction === "UPDATE_EMPTY_FIELDS_ONLY") {
          const empties =
            isEmptyField(existing.contact) ||
            isEmptyField(existing.email) ||
            isEmptyField(existing.address) ||
            isEmptyField(existing.gst) ||
            isEmptyField(existing.stateId);
          const tallyHas =
            cust.contact ||
            safeEmailOrNull(cust.email) ||
            cust.address ||
            gstNorm ||
            stateId;
          proposedAction = empties && tallyHas ? "UPDATE_EMPTY_FIELDS" : "SKIP_DUPLICATE";
          if (proposedAction === "SKIP_DUPLICATE" && !empties) {
            rowWarnings.push(
              "Duplicate customer — existing non-empty fields will not be overwritten. Tally identity (tallyName / tallyGuid) will still be backfilled when empty.",
            );
          }
        } else {
          proposedAction = "SKIP_DUPLICATE";
          rowWarnings.push(
            "Duplicate customer — business fields skipped. Tally identity (tallyName / tallyGuid) will be backfilled when empty.",
          );
        }
      }

      customers.push({
        entityType: "CUSTOMER",
        tallyName: cust.tallyName,
        tallyGuid: cust.tallyGuid || null,
        proposedAction,
        existingErpId: existing ? existing.id : null,
        warnings: rowWarnings,
        errors: rowErrors,
        fieldIssues,
        status: rowPreviewStatus(proposedAction, rowWarnings, rowErrors),
        mapped: {
          name: normalizeMasterNameDisplay(cust.name),
          gst: gstNorm,
          gstin: gstNorm,
          gstRaw: gstRaw,
          address: cust.address,
          stateText: cust.stateText,
          state: cust.stateText,
          stateId,
          pincode: cust.pincode || null,
          country: cust.country || null,
          contact: cust.contact || null,
          contactPerson: cust.contact || null,
          phone: cust.phone || null,
          email: safeEmailOrNull(cust.email),
          openingBalance: cust.openingBalance ?? 0,
          sourceSerial: cust.sourceSerial || null,
          parentGroup: cust.parentGroup || null,
        },
      });

      if (tallyImportDebug && /tata/i.test(String(cust.tallyName || cust.name || ""))) {
        const diag = buildPartyMapDiagnostics(/** @type {Record<string, unknown>} */ (lRaw), cust);
        partyDiagnostics.push(diag);
        // eslint-disable-next-line no-console
        console.info("[tally-import][party-map]", diag);
      }
    }

    const sup = mapLedgerToParty(lRaw, "SUPPLIER");
    if (sup) {
      const { gstRaw, gstNorm, gstMsg } = resolveImportGstin(sup.gst);
      const resolved = resolveExistingPartyMatch({
        tallyGuid: sup.tallyGuid || null,
        tallyName: sup.tallyName,
        displayName: sup.name,
        gstNorm,
        byGuid: supplierByGuid,
        byTallyName: supplierByTallyName,
        byDisplayName: supplierByKey,
        byGstin: supplierByGstin,
        entityLabel: "Supplier",
      });
      const existing = resolved.match;
      const stateId =
        stateIdFromGstinPrefix(gstNorm, statesByCode) ||
        stateIdFromStateText(sup.stateText, states) ||
        (options.fallbackStateId && states.some((s) => s.id === options.fallbackStateId) ? options.fallbackStateId : null);

      const rowWarnings = [];
      const rowErrors = [];
      /** @type {ReturnType<typeof formatFieldIssue>[]} */
      const fieldIssues = [];
      if (gstMsg) {
        pushFieldIssue(rowWarnings, fieldIssues, {
          masterName: sup.name,
          masterType: "Supplier",
          field: "GSTIN",
          actualValue: gstRaw,
          reason: gstMsg,
          disposition: "GSTIN will be left blank on import",
        });
      }
      if (resolved.ambiguous && resolved.error) {
        pushFieldIssue(rowErrors, fieldIssues, {
          masterName: sup.tallyName || sup.name,
          masterType: "Supplier",
          field: "Match",
          actualValue: sup.tallyName || sup.name,
          reason: resolved.error,
        });
      }
      // State is required only when creating a new supplier — existing matches stay eligible for identity backfill.
      if (!existing && !stateId) {
        pushFieldIssue(rowErrors, fieldIssues, {
          masterName: sup.name,
          masterType: "Supplier",
          field: "State",
          actualValue: sup.stateText,
          reason: "State could not be matched. Choose a fallback state in import options or fix the Tally address/GSTIN.",
        });
      } else if (existing && !stateId) {
        rowWarnings.push(
          "State could not be matched from Tally; existing supplier will keep its ERP state. Identity backfill still applies.",
        );
      }
      if (existing && gstNorm && existing.gst) {
        const eg = normalizeGstinOnSave(existing.gst);
        if (eg && gstNorm && eg !== gstNorm) rowWarnings.push("GSTIN in Tally differs from existing supplier record.");
      }
      if (existing && resolved.matchVia?.includes("gstin") && !resolved.matchVia.includes("name") && !resolved.matchVia.includes("tallyName")) {
        rowWarnings.push(
          `Matched existing supplier '${existing.name}' by GSTIN (Tally ledger '${sup.tallyName}'). Identity will be backfilled; business fields are not overwritten.`,
        );
      }

      let proposedAction = "CREATE";
      if (rowErrors.length) {
        proposedAction = "ERROR";
      } else if (existing) {
        if (options.duplicateAction === "UPDATE_EMPTY_FIELDS_ONLY") {
          const empties =
            isEmptyField(existing.contact) ||
            isEmptyField(existing.email) ||
            isEmptyField(existing.address) ||
            isEmptyField(existing.gst) ||
            isEmptyField(existing.stateId);
          const tallyHas =
            sup.contact ||
            safeEmailOrNull(sup.email) ||
            sup.address ||
            gstNorm ||
            stateId;
          proposedAction = empties && tallyHas ? "UPDATE_EMPTY_FIELDS" : "SKIP_DUPLICATE";
          if (proposedAction === "SKIP_DUPLICATE" && !empties) {
            rowWarnings.push(
              "Duplicate supplier — existing non-empty fields will not be overwritten. Tally identity (tallyName / tallyGuid) will still be backfilled when empty.",
            );
          }
        } else {
          proposedAction = "SKIP_DUPLICATE";
          rowWarnings.push(
            "Duplicate supplier — business fields skipped. Tally identity (tallyName / tallyGuid) will be backfilled when empty.",
          );
        }
      }

      suppliers.push({
        entityType: "SUPPLIER",
        tallyName: sup.tallyName,
        tallyGuid: sup.tallyGuid || null,
        proposedAction,
        existingErpId: existing ? existing.id : null,
        warnings: rowWarnings,
        errors: rowErrors,
        fieldIssues,
        status: rowPreviewStatus(proposedAction, rowWarnings, rowErrors),
        mapped: {
          name: normalizeMasterNameDisplay(sup.name),
          gst: gstNorm,
          gstin: gstNorm,
          gstRaw: gstRaw,
          address: sup.address,
          stateText: sup.stateText,
          state: sup.stateText,
          stateId,
          pincode: sup.pincode || null,
          country: sup.country || null,
          contact: sup.contact || null,
          contactPerson: sup.contact || null,
          phone: sup.phone || null,
          email: safeEmailOrNull(sup.email),
          openingBalance: sup.openingBalance ?? 0,
          sourceSerial: sup.sourceSerial || null,
          parentGroup: sup.parentGroup || null,
        },
      });
    }
  }

  const stockGroupTaxLookup = buildStockGroupTaxLookup(parsed.stockGroups);

  let conflictChecked = 0;
  for (const mi of mappedStockItems) {
    conflictChecked += 1;
    if (conflictChecked % 200 === 0 || conflictChecked === mappedStockItems.length) {
      onProgress?.({
        phase: "preparing_preview",
        percent: mappedStockItems.length
          ? Math.min(95, Math.round(90 + (conflictChecked / mappedStockItems.length) * 5))
          : 92,
        message: `Checking conflicts… ${conflictChecked.toLocaleString("en-IN")} of ${mappedStockItems.length.toLocaleString("en-IN")}`,
        recordsDetected: mappedStockItems.length,
        recordsProcessed: conflictChecked,
        stockItemsProcessed: conflictChecked,
        stockItemsTotal: mappedStockItems.length,
      });
    }
    const tax = resolveStockItemTaxFromStockGroups(
      { hsnCode: mi.hsnCode, gstRate: mi.gstRate, parentGroup: mi.parentGroup },
      stockGroupTaxLookup,
    );
    const effectiveHsn = tax.hsnCode;
    const effectiveGst = tax.gstRate;
    const guidKey = mi.tallyGuid ? String(mi.tallyGuid).trim().toLowerCase() : "";
    const existing =
      (guidKey && itemByGuid.get(guidKey)) ||
      itemByTallyName.get(normalizeMasterNameKey(mi.tallyName)) ||
      itemByKey.get(normalizeMasterNameKey(mi.itemName)) ||
      null;
    const rowWarnings = [];
    const rowErrors = [];
    /** @type {ReturnType<typeof formatFieldIssue>[]} */
    const fieldIssues = [];

    if (!mi.baseUnit) {
      pushFieldIssue(rowWarnings, fieldIssues, {
        masterName: mi.itemName,
        masterType: "Item",
        field: "Base unit",
        actualValue: mi.baseUnit,
        reason: "Base unit missing in Tally stock item — map or exclude before import.",
      });
    }
    if (!effectiveHsn) {
      pushFieldIssue(rowWarnings, fieldIssues, {
        masterName: mi.itemName,
        masterType: "Item",
        field: "HSN",
        actualValue: effectiveHsn,
        reason: "HSN missing in Tally stock item and parent stock groups.",
        disposition: "May import with blank HSN; review in preview",
      });
    } else if (tax.hsnInheritedFrom) {
      fieldIssues.push(
        formatFieldIssue({
          masterName: mi.itemName,
          masterType: "Item",
          field: "HSN",
          actualValue: effectiveHsn,
          reason: `HSN inherited from stock group ${tax.hsnInheritedFrom}.`,
          disposition: "Inherited from STOCKGROUP",
        }),
      );
    }

    const hsnNorm = effectiveHsn ? normalizeHsnOnSave(effectiveHsn) : null;
    if (effectiveHsn && !hsnNorm) {
      pushFieldIssue(rowErrors, fieldIssues, {
        masterName: mi.itemName,
        masterType: "Item",
        field: "HSN",
        actualValue: effectiveHsn,
        reason: "HSN could not be normalized.",
      });
    }
    const gstPct = normalizeGstRateForItem(effectiveGst);
    if (gstPct == null) {
      pushFieldIssue(rowWarnings, fieldIssues, {
        masterName: mi.itemName,
        masterType: "Item",
        field: "GST rate",
        actualValue: null,
        reason: "GST Unresolved/Inherited — IGST blank on latest GSTDETAILS (not coerced to 0%).",
        disposition: "Resolve during preview or import with blank GST",
      });
    } else if (tax.gstInheritedFrom) {
      fieldIssues.push(
        formatFieldIssue({
          masterName: mi.itemName,
          masterType: "Item",
          field: "GST rate",
          actualValue: gstPct,
          reason: `GST rate inherited from stock group ${tax.gstInheritedFrom}.`,
          disposition: "Inherited from STOCKGROUP",
        }),
      );
    }

    const suggestedUnitAlias = suggestUnitMapping(mi.baseUnit);
    const unitKey = suggestedUnitAlias.aliasKey || (mi.baseUnit ? normalizeUnitKey(mi.baseUnit) : "");
    const explicitUnitOverride =
      options.unitMapOverrides &&
      Object.prototype.hasOwnProperty.call(options.unitMapOverrides, unitKey)
        ? options.unitMapOverrides[unitKey]
        : undefined;
    const suggestedErpUnitName =
      explicitUnitOverride === undefined
        ? suggestedUnitAlias.suggestedErpUnitName
        : explicitUnitOverride == null || String(explicitUnitOverride).trim() === ""
          ? null
          : String(explicitUnitOverride).trim();
    const unitAlias = {
      ...suggestedUnitAlias,
      suggestedErpUnitName,
      unresolved: !suggestedErpUnitName,
    };
    const erpUnit =
      (!unitAlias.unresolved
        ? findEquivalentUnit(unitsDb, {
            unitName: suggestedErpUnitName || mi.baseUnit,
            unitCode: mi.baseUnit,
          })
        : null) ||
      (!unitAlias.unresolved
        ? suggestedErpUnitName
          ? unitByKey.get(normalizeUnitKey(suggestedErpUnitName))
          : unitKey
            ? unitByKey.get(unitKey)
            : null
        : null);
    const unitRow = unitKey ? units.find((u) => normalizeUnitKey(u.tallyName) === unitKey) : null;

    let proposedAction = "CREATE";
    let matchClass = "NEW";
    if (rowErrors.length) {
      proposedAction = "ERROR";
    } else if (existing) {
      const conflictFields = [];
      if (
        !isEmptyField(existing.hsnCode) &&
        hsnNorm &&
        String(existing.hsnCode).trim() !== String(hsnNorm).trim()
      ) {
        conflictFields.push("HSN");
      }
      const eg = existing.gstRate != null ? Number(existing.gstRate) : null;
      if (eg != null && Number.isFinite(eg) && gstPct != null && Math.abs(eg - gstPct) > 0.001) {
        conflictFields.push("GST");
      }
      if (
        !isEmptyField(existing.itemType) &&
        mi.autoDetectedItemType &&
        existing.itemType !== mi.autoDetectedItemType
      ) {
        conflictFields.push("itemType");
      }
      if (conflictFields.length) {
        proposedAction = "CONFLICT";
        matchClass = "CONFLICT";
        rowWarnings.push(
          `Existing ERP item differs on ${conflictFields.join(", ")} — will not overwrite without explicit confirmation.`,
        );
      } else if (options.duplicateAction === "UPDATE_EMPTY_FIELDS_ONLY") {
        const gstExisting = existing.gstRate != null ? Number(existing.gstRate) : NaN;
        const gstEmpty = existing.gstRate == null || !Number.isFinite(gstExisting);
        const empties =
          isEmptyField(existing.hsnCode) ||
          gstEmpty ||
          isEmptyField(existing.unitId) ||
          isEmptyField(existing.unit);
        const tallyHas = Boolean(hsnNorm) || gstPct != null || Boolean(mi.baseUnit);
        proposedAction = empties && tallyHas ? "UPDATE_EMPTY_FIELDS" : "SKIP_DUPLICATE";
        matchClass = proposedAction === "UPDATE_EMPTY_FIELDS" ? "SAFE_UPDATE" : "EXACT_MATCH";
        if (proposedAction === "SKIP_DUPLICATE" && !empties) rowWarnings.push("Duplicate item — Exact Match; business fields skipped.");
      } else {
        proposedAction = "SKIP_DUPLICATE";
        matchClass = "EXACT_MATCH";
        rowWarnings.push("Duplicate item name / Tally GUID — skipped (idempotent).");
      }
    }

    const groupSuggestion = suggestGroupMapping(mi.parentGroup);
    const mappingChoice = groupSuggestion.suggested;
    const erpFromGroup = resolveErpItemType(mappingChoice);
    const suggestedItemType = erpFromGroup || mi.autoDetectedItemType || null;
    const requiresUnitReview = normalizeUnitKey(mi.baseUnit) === "not applicable" && !erpUnit;
    if (requiresUnitReview) {
      proposedAction = "EXCLUDED";
      rowWarnings.push("Item excluded: Not Applicable cannot be auto-assigned as a stock UOM. Select a genuine ERP unit to import.");
    }

    items.push({
      entityType: "ITEM",
      tallyName: mi.tallyName,
      tallyGuid: mi.tallyGuid || null,
      proposedAction,
      existingErpId: existing ? existing.id : null,
      warnings: rowWarnings,
      errors: rowErrors,
      fieldIssues,
      status: rowPreviewStatus(proposedAction, rowWarnings, rowErrors),
      mapped: {
        itemName: normalizeMasterNameDisplay(mi.itemName),
        tallyStockGroup: mi.tallyStockGroup,
        parentGroup: mi.parentGroup,
        autoDetectedItemType: mi.autoDetectedItemType,
        defaultItemType: options.defaultItemType,
        mappingChoice,
        suggestedItemType,
        itemType: suggestedItemType,
        importAction: requiresUnitReview ? "EXCLUDE" : erpFromGroup ? "IMPORT" : "EXCLUDE",
        matchClass,
        baseUnit: mi.baseUnit ? normalizeMasterNameDisplay(mi.baseUnit) : "",
        proposedErpUnitName: suggestedErpUnitName,
        proposedErpUnitId: erpUnit ? erpUnit.id : null,
        unitUnresolved: !erpUnit,
        hsnCode: hsnNorm,
        gstRate: gstPct,
        gstStatus: gstPct == null ? "Unresolved/Inherited" : "Resolved",
        hsnSource: tax.hsnSource,
        gstSource: tax.gstSource || mi.gstSource,
        hsnInheritedFrom: tax.hsnInheritedFrom,
        gstInheritedFrom: tax.gstInheritedFrom,
        unitKey: unitKey || null,
        unitWillCreate: Boolean(unitRow && !erpUnit),
        openingBalanceNotPosted: true,
      },
    });
  }

  const summary = {
    customers: {
      total: customers.length,
      create: customers.filter((r) => r.proposedAction === "CREATE").length,
      skip: customers.filter((r) => r.proposedAction === "SKIP_DUPLICATE").length,
      update: customers.filter((r) => r.proposedAction === "UPDATE_EMPTY_FIELDS").length,
      error: customers.filter((r) => r.proposedAction === "ERROR").length,
    },
    suppliers: {
      total: suppliers.length,
      create: suppliers.filter((r) => r.proposedAction === "CREATE").length,
      skip: suppliers.filter((r) => r.proposedAction === "SKIP_DUPLICATE").length,
      update: suppliers.filter((r) => r.proposedAction === "UPDATE_EMPTY_FIELDS").length,
      error: suppliers.filter((r) => r.proposedAction === "ERROR").length,
    },
    items: {
      total: items.length,
      create: items.filter((r) => r.proposedAction === "CREATE").length,
      skip: items.filter((r) => r.proposedAction === "SKIP_DUPLICATE").length,
      update: items.filter((r) => r.proposedAction === "UPDATE_EMPTY_FIELDS").length,
      error: items.filter((r) => r.proposedAction === "ERROR").length,
    },
    units: {
      total: units.length,
      create: units.filter((r) => r.proposedAction === "CREATE").length,
      skip: units.filter((r) => r.proposedAction === "SKIP_DUPLICATE").length,
      update: units.filter((r) => r.proposedAction === "UPDATE_EMPTY_FIELDS").length,
      error: units.filter((r) => r.proposedAction === "ERROR").length,
    },
  };

  let excludedParentGroupRows = 0;
  let partyInvalidNameRows = 0;
  for (const lRaw of parsed.ledgers) {
    const ledger = /** @type {Record<string, unknown>} */ (lRaw);
    const display = ledgerDisplayName(ledger);
    if (!display) {
      partyInvalidNameRows += 1;
      continue;
    }
    const asCust = mapLedgerToParty(lRaw, "CUSTOMER");
    const asSup = mapLedgerToParty(lRaw, "SUPPLIER");
    if (!asCust && !asSup) excludedParentGroupRows += 1;
  }

  const partyRows = {
    totalRowsDetected:
      (parseStats.customFlatRowsDetected ?? 0) > 0
        ? parseStats.customFlatRowsDetected
        : parsed.ledgers.length,
    eligibleCustomers: customers.length,
    eligibleSuppliers: suppliers.length,
    excludedParentGroup: excludedParentGroupRows,
    duplicates:
      customers.filter((r) => r.proposedAction === "SKIP_DUPLICATE").length +
      suppliers.filter((r) => r.proposedAction === "SKIP_DUPLICATE").length,
    invalidRows: (parseStats.customFlatInvalidRows ?? 0) + partyInvalidNameRows,
  };
  summary.partyRows = partyRows;

  const groupTypeOverrides =
    options.groupTypeOverrides && typeof options.groupTypeOverrides === "object" ? options.groupTypeOverrides : {};
  const unitMapOverrides =
    options.unitMapOverrides && typeof options.unitMapOverrides === "object" ? options.unitMapOverrides : {};

  const groupMapping = buildGroupMappingTable(
    items.map((r) => ({
      parentGroup: r.mapped?.parentGroup,
      tallyStockGroup: r.mapped?.tallyStockGroup,
      itemName: r.mapped?.itemName,
    })),
    groupTypeOverrides,
  );
  const unitMapping = buildUnitMappingTable(
    items.map((r) => ({ baseUnit: r.mapped?.baseUnit })),
    unitMapOverrides,
    unitsDb,
    units,
  );
  const groupChoiceByKey = new Map(groupMapping.map((g) => [g.groupKey, g]));
  const unitChoiceByKey = new Map(unitMapping.map((u) => [u.aliasKey, u]));

  // Gate stock import on resolved group + unit mapping (never silently import Labour Charges etc.).
  for (const row of items) {
    const gKey = normalizeGroupKey(row.mapped?.parentGroup) || "(blank)";
    const gRow = groupChoiceByKey.get(gKey);
    const erpType = gRow ? resolveErpItemType(gRow.choice) : null;
    row.mapped.mappingChoice = gRow?.choice || row.mapped.mappingChoice;
    row.mapped.itemType = erpType;
    row.mapped.suggestedItemType = erpType || row.mapped.suggestedItemType;
    row.mapped.importAction = erpType ? "IMPORT" : "EXCLUDE";

    const uKey = normalizeUnitKey(row.mapped?.baseUnit) || "(blank)";
    const uRow = unitChoiceByKey.get(uKey);
    if (uRow) {
      row.mapped.proposedErpUnitName = uRow.proposedErpUnitName;
      row.mapped.proposedErpUnitId = uRow.proposedErpUnitId;
      row.mapped.unitUnresolved = uRow.unresolved;
    }

    if (!erpType) {
      if (row.proposedAction === "CREATE" || row.proposedAction === "UPDATE_EMPTY_FIELDS") {
        row.proposedAction = "EXCLUDED";
        row.warnings.push("Excluded by stock-group mapping (review Stage 2 mapping table).");
        row.status = rowPreviewStatus(row.proposedAction, row.warnings, row.errors);
      }
      continue;
    }
    if (row.mapped.unitUnresolved) {
      if (row.proposedAction === "CREATE" || row.proposedAction === "UPDATE_EMPTY_FIELDS") {
        row.proposedAction = "ERROR";
        row.errors.push("Unit unresolved — select a genuine ERP unit or exclude the item's stock group.");
        row.status = rowPreviewStatus(row.proposedAction, row.warnings, row.errors);
      }
    }
  }

  const stockPreview = {
    encoding: parseStats.encoding || decodeMeta?.encoding || null,
    totalStockItems: parseStats.stockItemsParsed ?? items.length,
    sanitizedInvalidRefCount: parseStats.sanitizedInvalidRefCount ?? 0,
    importable: items.filter((r) => r.proposedAction === "CREATE" || r.proposedAction === "UPDATE_EMPTY_FIELDS").length,
    excluded: items.filter((r) => r.proposedAction === "EXCLUDED").length,
    duplicates: items.filter((r) => r.proposedAction === "SKIP_DUPLICATE").length,
    conflicts: items.filter((r) => r.proposedAction === "CONFLICT").length,
    missingNames: Math.max(0, (parseStats.stockItemOpenInRaw || 0) - (parseStats.stockItemsParsed || 0)),
    blankGroups: items.filter((r) => !String(r.mapped?.parentGroup || "").trim()).length,
    unresolvedUnits: items.filter((r) => r.mapped?.unitUnresolved).length,
    unresolvedGst: items.filter((r) => r.mapped?.gstStatus === "Unresolved/Inherited").length,
    openingBalanceNotPosted: true,
  };
  stockPreview.effectiveItemTypes = {
    RM: items.filter((r) => r.mapped?.importAction === "IMPORT" && r.mapped?.itemType === "RM").length,
    FG: items.filter((r) => r.mapped?.importAction === "IMPORT" && r.mapped?.itemType === "FG").length,
    SFG: items.filter((r) => r.mapped?.importAction === "IMPORT" && r.mapped?.itemType === "SFG").length,
    CONSUMABLE: items.filter(
      (r) => r.mapped?.importAction === "IMPORT" && r.mapped?.itemType === "CONSUMABLE",
    ).length,
    EXCLUDED: items.filter((r) => r.mapped?.importAction === "EXCLUDE").length,
  };
  stockPreview.expectedActions = {
    created: items.filter((r) => r.proposedAction === "CREATE").length,
    reused: items.filter((r) => r.proposedAction === "SKIP_DUPLICATE").length,
    updated: items.filter((r) => r.proposedAction === "UPDATE_EMPTY_FIELDS").length,
    skipped: items.filter((r) => r.proposedAction === "CONFLICT" || r.proposedAction === "ERROR").length,
    excluded: items.filter((r) => r.proposedAction === "EXCLUDED").length,
  };

  const warningCategoryRows = {
    missingHsn: new Set(),
    inheritedHsn: new Set(),
    invalidHsnGst: new Set(),
    excludedByGroup: new Set(),
    unitMappingIssue: new Set(),
    duplicateItem: new Set(),
    sanitizedXmlReferences: new Set(),
    other: new Set(),
  };
  for (const [index, row] of items.entries()) {
    const messages = [...(row.warnings || []), ...(row.errors || []), ...(row.fieldIssues || []).map((i) => i.message)];
    let categorized = false;
    for (const message of messages) {
      const text = String(message || "");
      if (/HSN missing/i.test(text)) {
        warningCategoryRows.missingHsn.add(index);
        categorized = true;
      } else if (/HSN inherited/i.test(text)) {
        warningCategoryRows.inheritedHsn.add(index);
        categorized = true;
      } else if (/HSN could not be normalized|GST.*(?:invalid|unresolved)|IGST blank/i.test(text)) {
        warningCategoryRows.invalidHsnGst.add(index);
        categorized = true;
      } else if (/Excluded by stock-group mapping/i.test(text)) {
        warningCategoryRows.excludedByGroup.add(index);
        categorized = true;
      } else if (/unit.*(?:unresolved|map|stock UOM)/i.test(text)) {
        warningCategoryRows.unitMappingIssue.add(index);
        categorized = true;
      } else if (/duplicate item/i.test(text) || row.proposedAction === "SKIP_DUPLICATE") {
        warningCategoryRows.duplicateItem.add(index);
        categorized = true;
      }
    }
    if (!categorized && messages.length) warningCategoryRows.other.add(index);
  }
  const warningSummary = {
    missingHsn: warningCategoryRows.missingHsn.size,
    inheritedHsn: warningCategoryRows.inheritedHsn.size,
    invalidHsnGst: warningCategoryRows.invalidHsnGst.size,
    excludedByGroup: warningCategoryRows.excludedByGroup.size,
    unitMappingIssue: warningCategoryRows.unitMappingIssue.size,
    duplicateItem: warningCategoryRows.duplicateItem.size,
    sanitizedXmlReferences: parseStats.sanitizedInvalidRefCount ?? 0,
    other: warningCategoryRows.other.size,
  };

  summary.stockPreview = stockPreview;
  summary.items.excluded = stockPreview.excluded;
  summary.items.conflict = stockPreview.conflicts;

  const parsedMasterCounts = {
    customers: customers.length,
    suppliers: suppliers.length,
    items: items.length,
    units: units.length,
    stockGroups: parseStats.stockGroupsParsed ?? 0,
    godowns: parseStats.godownsParsed ?? 0,
    voucherTypes: parseStats.voucherTypesParsed ?? 0,
    ledgers: parseStats.ledgersParsed ?? 0,
    stockItems: parseStats.stockItemsParsed ?? 0,
    warnings: warnings.length,
    totalPartyRowsDetected: partyRows.totalRowsDetected,
    excludedParentGroup: partyRows.excludedParentGroup,
    partyDuplicates: partyRows.duplicates,
    partyInvalidRows: partyRows.invalidRows,
  };

  /** Informational notes for masters parsed but not imported in Release-1 (not errors). */
  const infoNotes = [];
  const deferredNote = "Parsed successfully. Release-1 does not import these master types.";
  if ((parseStats.stockGroupsParsed ?? 0) > 0) {
    infoNotes.push(`Stock Groups (${parseStats.stockGroupsParsed}): ${deferredNote}`);
  }
  if ((parseStats.godownsParsed ?? 0) > 0) {
    infoNotes.push(`Godowns (${parseStats.godownsParsed}): ${deferredNote}`);
  }
  if ((parseStats.voucherTypesParsed ?? 0) > 0) {
    infoNotes.push(`Voucher Types (${parseStats.voucherTypesParsed}): ${deferredNote}`);
  }
  if ((parseStats.stockItemsParsed ?? 0) === 0 && (parseStats.unitsParsed ?? 0) === 0) {
    infoNotes.push(
      "This XML contains no Stock Items or Units. Item identities were not updated. Export Stock Items and Units separately from Tally (master export including STOCKITEM / UNIT), then run Preview again.",
    );
  }
  infoNotes.push(
    "Opening balance not posted — party CALEDGEROPBAL / stock openings are retained on preview only. No fake GRNs or ledger postings are created.",
  );
  if (parseStats.encoding) {
    infoNotes.push(`Detected file encoding: ${parseStats.encoding}.`);
  }

  const blockingErrors = [...customers, ...suppliers, ...items, ...units]
    .filter((r) => r.proposedAction === "ERROR" || (Array.isArray(r.errors) && r.errors.length > 0))
    .map((r) => ({
      entityType: r.entityType,
      tallyName: r.tallyName,
      proposedAction: r.proposedAction,
      errors: r.errors,
      fieldIssues: r.fieldIssues || [],
      message:
        (r.fieldIssues && r.fieldIssues[0] && r.fieldIssues[0].message) ||
        (Array.isArray(r.errors) && r.errors[0]) ||
        `${r.entityType} '${r.tallyName}' has a blocking error.`,
    }));
  const confirmBlockingErrors = blockingErrors.filter(
    (e) =>
      e.entityType === "ITEM" &&
      /unit unresolved|item[- ]type|no importable ERP item type/i.test(
        [e.message, ...(e.errors || [])].join(" "),
      ),
  );

  const previewTotal = customers.length + suppliers.length + items.length + units.length;
  const rawTagSum =
    parseStats.tallyMessageOpenInRaw +
    parseStats.ledgerOpenInRaw +
    parseStats.stockItemOpenInRaw +
    parseStats.unitOpenInRaw +
    (parseStats.caAcctTypeNameOpenInRaw ?? 0);
  if (previewTotal === 0) {
    if (rawTagSum === 0) {
      warnings.push(
        "No supported Tally masters found in XML. Use a Tally master export that includes LEDGER / STOCKITEM / UNIT blocks, or a custom ledger report with CAACCTYPENAME / CALEDGERPARENT (Sundry Debtors / Sundry Creditors).",
      );
    }
  }
  if (partyRows.excludedParentGroup > 0) {
    warnings.push(
      `Excluded ${partyRows.excludedParentGroup} ledger row(s) whose parent group is not Sundry Debtors / Sundry Creditors (or a debtor/creditor sub-group).`,
    );
  }
  if (parsed.ledgers.length > 0 && customers.length === 0 && suppliers.length === 0) {
    const parents = parsed.ledgers
      .slice(0, 8)
      .map((l) => {
        const o = /** @type {Record<string, unknown>} */ (l);
        return strVal(o.PARENT) || strVal(o.CALEDGERPARENT);
      })
      .filter(Boolean);
    warnings.push(
      `Found ${parsed.ledgers.length} ledger row(s) in XML, but none matched customer/supplier groups we import (e.g. Sundry Debtors / Sundry Creditors or common debtor/creditor sub-groups). Sample PARENT values: ${parents.join("; ") || "(empty)"}.`,
    );
  }
  const stockUnmapped = parsed.stockItems.filter((s) => !mapStockItemToItem(s)).length;
  if (stockUnmapped > 0) {
    warnings.push(`${stockUnmapped} STOCKITEM node(s) could not be read (missing item name).`);
  }

  // Keep warning count on parsedMasterCounts in sync after late warning pushes.
  parsedMasterCounts.warnings = warnings.length;

  return {
    ok: true,
    warnings,
    infoNotes,
    blockingErrors,
    blockingErrorCount: blockingErrors.length,
    confirmBlockingErrors,
    confirmBlockingErrorCount: confirmBlockingErrors.length,
    identityBackfillEligible: identityColumnsAvailable,
    parsedMasterCounts,
    summary,
    customers,
    suppliers,
    items,
    units,
    groupMapping,
    unitMapping,
    warningSummary,
    stockPreview,
    parseStats,
    runtime: {
      pipelineId: TALLY_IMPORT_PIPELINE_ID,
      pid: process.pid,
      // Static module ids — do NOT use require.resolve() (breaks esbuild single-file server.js)
      mapperModule: "tallyMasterImport/mapLedgerToParty",
      parseModule: "tallyMasterImport/parseTallyMastersXml",
      helpersModule: "tallyMasterImport/tallyXmlListHelpers",
      gstinModule: "gstinNormalize",
    },
    ...(tallyImportDebug && partyDiagnostics.length ? { partyDiagnostics } : {}),
  };
}

/**
 * @param {import("@prisma/client").PrismaClient} db
 * @param {string} token
 * @param {{
 *   itemTypeOverrides?: Record<string, string>;
 *   groupTypeOverrides?: Record<string, string>;
 *   unitMapOverrides?: Record<string, string | null>;
 *   confirmConflicts?: boolean;
 *   actorUser?: { id?: number; name?: string; email?: string; role?: string } | null;
 *   sourceFilename?: string | null;
 * } | Record<string, string> | undefined} applyOpts
 *   Back-compat: plain Record treated as itemTypeOverrides only.
 */
async function applyFromPreviewToken(db, token, applyOpts) {
  const actorUser = applyOpts?.actorUser || null;
  const actorUserId = actorUser && actorUser.id != null ? Number(actorUser.id) : null;
  const session = claimPreviewSessionForApply(token, { actorUserId });

  const plainOverrides =
    applyOpts &&
    typeof applyOpts === "object" &&
    applyOpts.itemTypeOverrides == null &&
    applyOpts.groupTypeOverrides == null &&
    applyOpts.unitMapOverrides == null &&
    applyOpts.actorUser == null &&
    applyOpts.onProgress == null &&
    applyOpts.confirmConflicts == null &&
    applyOpts.clientOperationId == null
      ? /** @type {Record<string, string>} */ (applyOpts)
      : null;
  // Per-item overrides are optional and must stay small. Confirm Import must not resend all preview rows.
  const rawItemOverrides = plainOverrides || applyOpts?.itemTypeOverrides || undefined;
  if (rawItemOverrides && typeof rawItemOverrides === "object" && Object.keys(rawItemOverrides).length > 500) {
    markPreviewSessionReady(token);
    const err = new Error(
      "Too many per-item type overrides in Confirm Import. Use Stage 2 group mappings instead of sending every stock item.",
    );
    err.statusCode = 400;
    err.code = "ITEM_OVERRIDES_TOO_LARGE";
    throw err;
  }
  const itemTypeOverrides = rawItemOverrides;
  const groupTypeOverrides = applyOpts?.groupTypeOverrides || session.options.groupTypeOverrides || {};
  const unitMapOverrides = applyOpts?.unitMapOverrides || session.options.unitMapOverrides || {};
  const confirmConflicts = Boolean(applyOpts?.confirmConflicts);
  const sourceFilename = applyOpts?.sourceFilename || session.sourceFilename || session.options.sourceFilename || null;
  const onProgress = typeof applyOpts?.onProgress === "function" ? applyOpts.onProgress : null;

  const xmlString = session.xmlUtf8;
  const options = {
    ...session.options,
    groupTypeOverrides,
    unitMapOverrides,
    importBatchSize: applyOpts?.importBatchSize ?? session.options.importBatchSize,
    ...(applyOpts?.duplicateAction ? { duplicateAction: applyOpts.duplicateAction } : {}),
  };

  let completedOk = false;
  try {
  const payload = await buildPreviewPayload(db, xmlString, options, session.decodeMeta);
  if (!payload.ok) {
    const err = new Error(payload.error || "Could not parse XML.");
    err.statusCode = 400;
    throw err;
  }
  if (payload.confirmBlockingErrorCount > 0) {
    const err = new Error(
      `Confirm Import is blocked: ${payload.confirmBlockingErrorCount} importable row(s) still have unresolved unit or item-type errors.`,
    );
    err.statusCode = 409;
    err.code = "TALLY_IMPORT_PREVIEW_BLOCKED";
    err.blockingErrors = payload.confirmBlockingErrors;
    throw err;
  }

  const results = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let excluded = 0;
  let conflicted = 0;

  const pushResult = (entityType, tallyName, action, erpId, error, warning) => {
    results.push({ entityType, tallyName, action, erpId: erpId ?? null, error: error ?? null, warning: warning ?? null });
  };

  const stateRows = await db.state.findMany({
    where: { isActive: true },
    select: { id: true, stateName: true, stateCode: true },
  });
  const stateById = new Map(stateRows.map((s) => [s.id, s]));

  for (const row of payload.units) {
    if (row.proposedAction === "REVIEW") {
      excluded += 1;
      pushResult(
        "UNIT",
        row.tallyName,
        "EXCLUDED",
        row.existingErpId,
        null,
        "Not Applicable requires explicit review and is never auto-assigned as a stock UOM.",
      );
      continue;
    }
    if (row.proposedAction === "SKIP_DUPLICATE" || row.proposedAction === "REUSE" || row.proposedAction === "ERROR") {
      if (row.proposedAction === "SKIP_DUPLICATE" || row.proposedAction === "REUSE") {
        const outcome =
          row.proposedAction === "REUSE"
            ? await backfillReusedUnitIdentity(db, row, pushResult)
            : await applyIdentityBackfillSafe(db, "unit", row.existingErpId, row, "UNIT", pushResult);
        if (outcome === "UPDATED") updated += 1;
        else if (outcome === "FAILED") failed += 1;
        else skipped += 1;
      } else {
        skipped += 1;
        pushResult("UNIT", row.tallyName, "SKIPPED", row.existingErpId, row.errors[0] || null, row.warnings[0] || null);
      }
      continue;
    }
    try {
      if (row.proposedAction === "CREATE") {
        const outcome = await createOrReuseImportedUnit(db, row);
        if (outcome.outcome === "CREATED") {
          created += 1;
          pushResult("UNIT", row.tallyName, "CREATED", outcome.row.id, null, null);
        } else if (outcome.outcome === "REUSED") {
          skipped += 1;
          pushResult(
            "UNIT",
            row.tallyName,
            "REUSED",
            outcome.row.id,
            null,
            "Equivalent ERP unit already exists; reused without creating a duplicate.",
          );
        } else {
          failed += 1;
          pushResult("UNIT", row.tallyName, "FAILED", null, outcome.reason, outcome.correctiveAction);
        }
      } else if (row.proposedAction === "UPDATE_EMPTY_FIELDS" && row.existingErpId) {
        const ex = await db.unit.findUnique({ where: { id: row.existingErpId } });
        if (ex) {
          const patch = { ...tallyIdentityBackfillPatch(ex, row) };
          if (isEmptyField(ex.unitCode) && row.mapped.unitCode) patch.unitCode = row.mapped.unitCode;
          if (Object.keys(patch).length) {
            await db.unit.update({ where: { id: ex.id }, data: patch });
            updated += 1;
            pushResult("UNIT", row.tallyName, "UPDATED", ex.id, null, null);
          } else {
            skipped += 1;
            pushResult("UNIT", row.tallyName, "SKIPPED", row.existingErpId, null, null);
          }
        } else {
          skipped += 1;
          pushResult("UNIT", row.tallyName, "SKIPPED", row.existingErpId, null, null);
        }
      }
    } catch (e) {
      failed += 1;
      pushResult(
        "UNIT",
        row.tallyName,
        "FAILED",
        null,
        "The unit could not be imported safely.",
        "Review the unit mapping and retry. No duplicate unit was created.",
      );
    }
  }

  const unitsDbAfter = await db.unit.findMany({ where: { isActive: true }, select: { id: true, unitName: true } });
  const unitByKeyAfter = new Map(unitsDbAfter.map((u) => [normalizeUnitKey(u.unitName), u]));

  for (const row of payload.customers) {
    if (row.proposedAction === "SKIP_DUPLICATE" || row.proposedAction === "ERROR") {
      if (row.proposedAction === "SKIP_DUPLICATE") {
        const outcome = await applyIdentityBackfillSafe(db, "customer", row.existingErpId, row, "CUSTOMER", pushResult);
        if (outcome === "UPDATED") updated += 1;
        else if (outcome === "FAILED") failed += 1;
        else skipped += 1;
      } else {
        skipped += 1;
        pushResult("CUSTOMER", row.tallyName, "SKIPPED", row.existingErpId, row.errors[0] || null, row.warnings[0] || null);
      }
      continue;
    }
    try {
      if (row.proposedAction === "CREATE") {
        const createdRow = await db.customer.create({
          data: {
            name: row.mapped.name,
            gst: row.mapped.gst,
            address: row.mapped.address,
            stateId: row.mapped.stateId,
            state: row.mapped.stateId
              ? stateById.get(row.mapped.stateId)?.stateName ?? null
              : row.mapped.stateText || null,
            contact: row.mapped.contact,
            email: row.mapped.email,
            isActive: true,
            ...tallyIdentityCreateData(row),
          },
          select: { id: true },
        });
        await upsertRegisteredOfficeDeliveryAddress(
          db,
          createdRow.id,
          {
            address: row.mapped.address || null,
            stateId: row.mapped.stateId || null,
            gst: row.mapped.gst || null,
            contact: row.mapped.contact || null,
            contactPerson: row.mapped.contact || null,
            phone: row.mapped.phone || null,
            pincode: row.mapped.pincode || null,
            country: row.mapped.country || null,
            email: row.mapped.email || null,
          },
          "CREATE",
        );
        created += 1;
        pushResult("CUSTOMER", row.tallyName, "CREATED", createdRow.id, null, null);
      } else if (row.proposedAction === "UPDATE_EMPTY_FIELDS" && row.existingErpId) {
        const ex = await db.customer.findUnique({ where: { id: row.existingErpId } });
        if (!ex) {
          failed += 1;
          pushResult("CUSTOMER", row.tallyName, "FAILED", null, "Customer no longer exists.", null);
          continue;
        }
        const patch = { ...tallyIdentityBackfillPatch(ex, row) };
        if (isEmptyField(ex.contact) && row.mapped.contact) patch.contact = row.mapped.contact;
        if (isEmptyField(ex.email) && row.mapped.email) patch.email = row.mapped.email;
        if (isEmptyField(ex.address) && row.mapped.address) patch.address = row.mapped.address;
        if (isEmptyField(ex.gst) && row.mapped.gst) patch.gst = row.mapped.gst;
        if (isEmptyField(ex.stateId) && row.mapped.stateId) {
          patch.stateId = row.mapped.stateId;
          patch.state = stateById.get(row.mapped.stateId)?.stateName ?? null;
        }
        if (Object.keys(patch).length) {
          await db.customer.update({ where: { id: ex.id }, data: patch });
          updated += 1;
          pushResult("CUSTOMER", row.tallyName, "UPDATED", ex.id, null, null);
        } else {
          skipped += 1;
          pushResult("CUSTOMER", row.tallyName, "SKIPPED", ex.id, null, null);
        }

        // Delivery address backfill: ensure at least one default delivery address exists.
        await upsertRegisteredOfficeDeliveryAddress(
          db,
          ex.id,
          {
            address: row.mapped.address || ex.address || null,
            stateId: row.mapped.stateId || ex.stateId || null,
            gst: row.mapped.gst || ex.gst || null,
            contact: row.mapped.contact || ex.contact || null,
            contactPerson: row.mapped.contact || ex.contact || null,
            phone: row.mapped.phone || null,
            pincode: row.mapped.pincode || null,
            country: row.mapped.country || null,
            email: row.mapped.email || null,
          },
          "UPDATE_EMPTY_FIELDS",
        );
      }
    } catch (e) {
      failed += 1;
      let msg = e instanceof Error ? e.message : String(e);
      if (isPrismaValidationError(e) || isPrismaMissingColumnError(e)) {
        msg = formatImportRowError(
          "Customer",
          row.tallyName,
          "Tally identity",
          "Database/Prisma schema is out of date for Tally identity fields. Apply migration 20260721180000_tally_master_identity and run npx prisma generate.",
        );
      } else {
        msg = formatImportRowError("Customer", row.tallyName, "Apply", msg);
      }
      pushResult("CUSTOMER", row.tallyName, "FAILED", null, msg, null);
    }
  }

  for (const row of payload.suppliers) {
    if (row.proposedAction === "SKIP_DUPLICATE" || row.proposedAction === "ERROR") {
      if (row.proposedAction === "SKIP_DUPLICATE") {
        const outcome = await applyIdentityBackfillSafe(db, "supplier", row.existingErpId, row, "SUPPLIER", pushResult);
        if (outcome === "UPDATED") updated += 1;
        else if (outcome === "FAILED") failed += 1;
        else skipped += 1;
      } else {
        skipped += 1;
        pushResult(
          "SUPPLIER",
          row.tallyName,
          "SKIPPED",
          row.existingErpId,
          row.errors[0] || formatImportRowError("Supplier", row.tallyName, "Import", "Row left unresolved due to a blocking error."),
          row.warnings[0] || null,
        );
      }
      continue;
    }
    try {
      const sid = row.mapped.stateId;
      if (!sid) {
        failed += 1;
        pushResult("SUPPLIER", row.tallyName, "FAILED", null, "Missing state for supplier.", null);
        continue;
      }
      const st = stateById.get(sid);
      if (!st) {
        failed += 1;
        pushResult("SUPPLIER", row.tallyName, "FAILED", null, "Invalid state.", null);
        continue;
      }

      if (row.proposedAction === "CREATE") {
        const createdRow = await db.supplier.create({
          data: {
            name: row.mapped.name,
            gst: row.mapped.gst,
            address: row.mapped.address,
            stateId: sid,
            state: st.stateName,
            stateName: st.stateName,
            stateCode: st.stateCode,
            contact: row.mapped.contact,
            email: row.mapped.email,
            ...tallyIdentityCreateData(row),
          },
          select: { id: true },
        });
        await upsertRegisteredOfficeSupplierLocation(
          db,
          createdRow.id,
          {
            address: row.mapped.address || null,
            stateId: row.mapped.stateId || null,
            gst: row.mapped.gst || null,
            contact: row.mapped.contact || null,
            contactPerson: row.mapped.contact || null,
            phone: row.mapped.phone || null,
          },
          "CREATE",
        );
        created += 1;
        pushResult("SUPPLIER", row.tallyName, "CREATED", createdRow.id, null, null);
      } else if (row.proposedAction === "UPDATE_EMPTY_FIELDS" && row.existingErpId) {
        const ex = await db.supplier.findUnique({ where: { id: row.existingErpId } });
        if (!ex) {
          failed += 1;
          pushResult("SUPPLIER", row.tallyName, "FAILED", null, "Supplier no longer exists.", null);
          continue;
        }
        const patch = { ...tallyIdentityBackfillPatch(ex, row) };
        if (isEmptyField(ex.contact) && row.mapped.contact) patch.contact = row.mapped.contact;
        if (isEmptyField(ex.email) && row.mapped.email) patch.email = row.mapped.email;
        if (isEmptyField(ex.address) && row.mapped.address) patch.address = row.mapped.address;
        if (isEmptyField(ex.gst) && row.mapped.gst) patch.gst = row.mapped.gst;
        if (isEmptyField(ex.stateId) && sid) {
          patch.stateId = sid;
          patch.state = st.stateName;
          patch.stateName = st.stateName;
          patch.stateCode = st.stateCode;
        }
        if (Object.keys(patch).length) {
          await db.supplier.update({ where: { id: ex.id }, data: patch });
          updated += 1;
          pushResult("SUPPLIER", row.tallyName, "UPDATED", ex.id, null, null);
        } else {
          skipped += 1;
          pushResult("SUPPLIER", row.tallyName, "SKIPPED", ex.id, null, null);
        }

        await upsertRegisteredOfficeSupplierLocation(
          db,
          ex.id,
          {
            address: row.mapped.address || ex.address || null,
            stateId: row.mapped.stateId || ex.stateId || null,
            gst: row.mapped.gst || ex.gst || null,
            contact: row.mapped.contact || ex.contact || null,
            contactPerson: row.mapped.contact || ex.contact || null,
            phone: row.mapped.phone || null,
          },
          "UPDATE_EMPTY_FIELDS",
        );
      }
    } catch (e) {
      failed += 1;
      let msg = e instanceof Error ? e.message : String(e);
      if (isPrismaValidationError(e) || isPrismaMissingColumnError(e)) {
        msg = formatImportRowError(
          "Supplier",
          row.tallyName,
          "Tally identity",
          "Database/Prisma schema is out of date for Tally identity fields. Apply migration 20260721180000_tally_master_identity and run npx prisma generate.",
        );
      } else if (/unique|duplicate|already/i.test(msg) && row.mapped?.gst) {
        msg = formatImportRowError(
          "Supplier",
          row.tallyName,
          "GSTIN",
          `GSTIN already belongs to another supplier (value ${row.mapped.gst}).`,
        );
      } else {
        msg = formatImportRowError("Supplier", row.tallyName, "Apply", msg);
      }
      pushResult("SUPPLIER", row.tallyName, "FAILED", null, msg, null);
    }
  }

  const DEFAULT_CRITICAL = 50;
  const DEFAULT_WARNING = 80;

  /** @type {typeof payload.items} */
  const itemWork = [];
  for (const row of payload.items) {
    if (row.proposedAction === "EXCLUDED") {
      excluded += 1;
      pushResult("ITEM", row.tallyName, "EXCLUDED", row.existingErpId, null, row.warnings[0] || "Excluded by mapping.");
      continue;
    }
    if (row.proposedAction === "CONFLICT") {
      if (!confirmConflicts) {
        conflicted += 1;
        pushResult(
          "ITEM",
          row.tallyName,
          "CONFLICTED",
          row.existingErpId,
          "Conflict with existing ERP item — confirmConflicts required; fields not overwritten.",
          row.warnings[0] || null,
        );
        continue;
      }
      // Explicit confirm still only backfills identity — never silent overwrite of HSN/GST/type/unit.
      const outcome = await applyIdentityBackfillSafe(db, "item", row.existingErpId, row, "ITEM", pushResult);
      if (outcome === "UPDATED") updated += 1;
      else if (outcome === "FAILED") failed += 1;
      else {
        conflicted += 1;
        skipped += 1;
      }
      continue;
    }
    if (row.proposedAction === "SKIP_DUPLICATE" || row.proposedAction === "ERROR") {
      if (row.proposedAction === "SKIP_DUPLICATE") {
        const outcome = await applyIdentityBackfillSafe(db, "item", row.existingErpId, row, "ITEM", pushResult);
        if (outcome === "UPDATED") updated += 1;
        else if (outcome === "FAILED") failed += 1;
        else skipped += 1;
      } else {
        skipped += 1;
        pushResult("ITEM", row.tallyName, "SKIPPED", row.existingErpId, row.errors[0] || null, row.warnings[0] || null);
      }
      continue;
    }
    itemWork.push(row);
  }

  const batchSize = resolveImportBatchSize(options);
  const totalItemBatches = itemWork.length ? Math.ceil(itemWork.length / batchSize) : 0;
  let committedItemBatches = 0;
  /** @type {null | { failedBatchIndex: number; totalBatches: number; committedBatchesBeforeFailure: number; createdBeforeFailure: number; remainingNotAttempted: number }} */
  let itemBatchFailure = null;
  /** @type {string[]} */
  const importBatchWarnings = [];

  for (let offset = 0; offset < itemWork.length; offset += batchSize) {
    const batchIndex = Math.floor(offset / batchSize) + 1;
    const batch = itemWork.slice(offset, offset + batchSize);
    onProgress?.({
      batchIndex,
      batchTotal: totalItemBatches,
      itemsProcessed: Math.min(offset, itemWork.length),
      itemsTotal: itemWork.length,
      percent: Math.round(5 + (offset / Math.max(1, itemWork.length)) * 90),
      message: `Importing batch ${batchIndex} of ${totalItemBatches} — ${Math.min(offset, itemWork.length)} of ${itemWork.length} items processed`,
    });
    try {
      const batchResults = await db.$transaction(async (tx) => {
        /** @type {{ entityType: string; tallyName: string; action: string; erpId: number | null; error: string | null; warning: string | null }[]} */
        const local = [];
        for (const row of batch) {
          const proposedUnitName = row.mapped.proposedErpUnitName || row.mapped.baseUnit;
          const unitKey = proposedUnitName ? normalizeUnitKey(proposedUnitName) : row.mapped.unitKey;
          const u = unitKey ? unitByKeyAfter.get(unitKey) : null;
          const unitDisplay = (u && u.unitName) || proposedUnitName || row.mapped.baseUnit || "";
          if (!unitDisplay || !u) {
            // Hard-fail the whole batch: never commit a partial batch with mixed success/failure.
            throw Object.assign(new Error(`Unit could not be resolved for item '${row.tallyName}'.`), {
              code: "TALLY_ITEM_BATCH_ROW_FAILED",
            });
          }
          const hsn = row.mapped.hsnCode || null;
          const itemType = resolveItemTypeForApply(row, itemTypeOverrides, groupTypeOverrides, options);
          if (!itemType) {
            throw Object.assign(new Error(`No importable ERP item type for '${row.tallyName}' after mapping.`), {
              code: "TALLY_ITEM_BATCH_ROW_FAILED",
            });
          }

          if (row.proposedAction === "CREATE") {
            const createdRow = await tx.item.create({
              data: {
                itemName: row.mapped.itemName,
                itemType,
                unit: unitDisplay,
                unitId: u.id,
                minStockLevel: "0",
                hsnCode: hsn,
                gstRate: row.mapped.gstRate == null ? null : String(row.mapped.gstRate),
                redThresholdPercent: DEFAULT_CRITICAL,
                yellowThresholdPercent: DEFAULT_WARNING,
                ...tallyIdentityCreateData(row),
              },
              select: { id: true },
            });
            local.push({
              entityType: "ITEM",
              tallyName: row.tallyName,
              action: "CREATED",
              erpId: createdRow.id,
              error: null,
              warning: null,
            });
          } else if (row.proposedAction === "UPDATE_EMPTY_FIELDS" && row.existingErpId) {
            const ex = await tx.item.findUnique({ where: { id: row.existingErpId } });
            if (!ex) {
              throw Object.assign(new Error(`Item '${row.tallyName}' no longer exists.`), {
                code: "TALLY_ITEM_BATCH_ROW_FAILED",
              });
            }
            const patch = { ...tallyIdentityBackfillPatch(ex, row) };
            if (isEmptyField(ex.hsnCode) && hsn) patch.hsnCode = hsn;
            if ((ex.gstRate == null || !Number.isFinite(Number(ex.gstRate))) && row.mapped.gstRate != null) {
              patch.gstRate = String(row.mapped.gstRate);
            }
            if (isEmptyField(ex.unitId) && u) {
              patch.unitId = u.id;
              patch.unit = unitDisplay;
            } else if (isEmptyField(ex.unit) && unitDisplay) {
              patch.unit = unitDisplay;
            }
            if (Object.keys(patch).length) {
              await tx.item.update({ where: { id: ex.id }, data: patch });
              local.push({
                entityType: "ITEM",
                tallyName: row.tallyName,
                action: "UPDATED",
                erpId: ex.id,
                error: null,
                warning: null,
              });
            } else {
              local.push({
                entityType: "ITEM",
                tallyName: row.tallyName,
                action: "SKIPPED",
                erpId: ex.id,
                error: null,
                warning: null,
              });
            }
          }
        }
        return local;
      });
      for (const r of batchResults) {
        results.push(r);
        if (r.action === "CREATED") created += 1;
        else if (r.action === "UPDATED") updated += 1;
        else if (r.action === "EXCLUDED") excluded += 1;
        else if (r.action === "FAILED") failed += 1;
        else skipped += 1;
      }
      committedItemBatches += 1;
      onProgress?.({
        batchIndex,
        batchTotal: totalItemBatches,
        itemsProcessed: Math.min(offset + batch.length, itemWork.length),
        itemsTotal: itemWork.length,
        percent: Math.round(5 + ((offset + batch.length) / Math.max(1, itemWork.length)) * 90),
        message: `Importing batch ${batchIndex} of ${totalItemBatches} — ${Math.min(offset + batch.length, itemWork.length)} of ${itemWork.length} items processed`,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      itemBatchFailure = {
        failedBatchIndex: batchIndex,
        totalBatches: totalItemBatches,
        committedBatchesBeforeFailure: committedItemBatches,
        createdBeforeFailure: created,
        remainingNotAttempted: Math.max(0, itemWork.length - offset - batch.length),
      };
      const earlierNote =
        committedItemBatches > 0
          ? `Earlier batches 1–${committedItemBatches} of ${totalItemBatches} already committed (${created} item row(s) created/updated in those batches).`
          : `No earlier item batches had committed before this failure.`;
      const batchFailWarning =
        `Item import batch ${batchIndex} of ${totalItemBatches} failed and was fully rolled back (no partial writes in this batch). ${earlierNote} ` +
        `Import stopped; ${itemBatchFailure.remainingNotAttempted} later item row(s) were not attempted. ` +
        `Re-run the same file safely — committed rows match by Tally GUID/name and will skip as duplicates.`;
      importBatchWarnings.push(batchFailWarning);
      for (const row of batch) {
        failed += 1;
        pushResult("ITEM", row.tallyName, "FAILED", null, errMsg, batchFailWarning);
      }
      // Do not continue with later batches after a hard transaction failure (avoids gaps).
      const remaining = itemWork.slice(offset + batch.length);
      for (const row of remaining) {
        failed += 1;
        pushResult(
          "ITEM",
          row.tallyName,
          "FAILED",
          null,
          `Not attempted — import stopped after item batch ${batchIndex} of ${totalItemBatches} failed.`,
          earlierNote,
        );
      }
      break;
    }
  }

  const unresolved = results.filter((r) => r.action === "FAILED" || (r.action === "SKIPPED" && r.error));
  const responseWarnings = [...(payload.warnings || []), ...importBatchWarnings];
  const partialCommitSummary = itemBatchFailure
    ? ` Partial commit: item batches 1–${itemBatchFailure.committedBatchesBeforeFailure} of ${itemBatchFailure.totalBatches} committed; batch ${itemBatchFailure.failedBatchIndex} rolled back; later batches not attempted. Retry the same file safely (no duplicates).`
    : "";
  const activityMessage = itemBatchFailure
    ? `Tally master import (partial): ${created} created, ${updated} updated, ${skipped} skipped, ${excluded} excluded, ${conflicted} conflicted, ${failed} failed. ${itemBatchFailure.committedBatchesBeforeFailure} item batch(es) committed before batch ${itemBatchFailure.failedBatchIndex}/${itemBatchFailure.totalBatches} rolled back.`
    : `Tally master import: ${created} created, ${updated} updated, ${skipped} skipped, ${excluded} excluded, ${conflicted} conflicted, ${failed} failed`;
  try {
    await logActivity({
      tx: db,
      user: actorUser,
      module: "TALLY_IMPORT",
      entityType: "TALLY_MASTER_IMPORT",
      entityId: null,
      docNo: null,
      action: "IMPORT",
      subAction: itemBatchFailure ? "APPLY_PARTIAL" : "APPLY",
      message: activityMessage.slice(0, 512),
      metadata: {
        sourceFilename: sourceFilename || "",
        encoding: String(payload.parseStats?.encoding || session.decodeMeta?.encoding || ""),
        sourceRowCount:
          (payload.summary?.partyRows?.totalRowsDetected || 0) + (payload.stockPreview?.totalStockItems || 0),
        created,
        updated,
        skipped,
        excluded,
        conflicted,
        failed,
        sanitizedInvalidRefCount: payload.parseStats?.sanitizedInvalidRefCount ?? 0,
        openingBalanceNotPosted: true,
        itemBatchSize: batchSize,
        itemBatchesCommitted: committedItemBatches,
        itemBatchesTotal: totalItemBatches,
        failedBatchIndex: itemBatchFailure?.failedBatchIndex ?? null,
        earlierBatchesCommitted: Boolean(itemBatchFailure && itemBatchFailure.committedBatchesBeforeFailure > 0),
        safelyRetryable: true,
      },
    });
  } catch {
    /* activity log is best-effort */
  }

  const result = {
    ok: true,
    partialCommit: Boolean(itemBatchFailure),
    created,
    updated,
    skipped,
    excluded,
    conflicted,
    failed,
    results,
    warnings: responseWarnings,
    unresolvedCount: unresolved.length,
    unresolved: unresolved.slice(0, 50),
    openingBalanceNotPosted: true,
    itemBatching: {
      batchSize,
      batchesCommitted: committedItemBatches,
      batchesTotal: totalItemBatches,
      failure: itemBatchFailure,
      earlierBatchesCommitted: Boolean(itemBatchFailure && itemBatchFailure.committedBatchesBeforeFailure > 0),
      safelyRetryable: true,
    },
    summaryMessage:
      (failed > 0 || unresolved.length || itemBatchFailure
        ? `Import finished with ${created} created, ${updated} updated, ${skipped} skipped, ${excluded} excluded, ${conflicted} conflicted, ${failed} failed.${partialCommitSummary}`
        : `Import finished: ${created} created, ${updated} updated, ${skipped} skipped, ${excluded} excluded.`) +
      (itemBatchFailure ? "" : ""),
  };
  completedOk = true;
  return result;
  } catch (e) {
    markPreviewSessionReady(token);
    throw e;
  } finally {
    if (completedOk) {
      markPreviewSessionConsumed(token);
      // Drop heavy XML after successful consume to free memory; token remains briefly as consumed.
      const s = previewSessions.get(String(token || ""));
      if (s) {
        s.xmlUtf8 = "";
      }
    }
  }
}

module.exports = {
  buildPreviewPayload,
  createPreviewSession,
  getPreviewSession,
  rebuildPreviewFromToken,
  claimPreviewSessionForApply,
  fingerprintXmlText,
  applyFromPreviewToken,
  MAX_XML_BYTES,
  IMPORT_BATCH_SIZE,
  TALLY_APPLY_JSON_LIMIT,
  SESSION_TTL_MS,
  resolveImportBatchSize,
  gcSessions,
  _resetPreviewSessionsForTests,
  normalizeStateTextForMatch,
  stateIdFromStateText,
  formatFieldIssue,
  formatImportRowError,
  resolveExistingPartyMatch,
  tallyIdentityBackfillPatch,
  createOrReuseImportedUnit,
  TALLY_IMPORT_PIPELINE_ID,
};
