const crypto = require("crypto");
const {
  normalizeMasterNameDisplay,
  normalizeMasterNameKey,
} = require("../masterNameNormalize");
const { normalizeGstinOnSave, resolveImportGstin, cleanGstinChars } = require("../gstinNormalize");
const { normalizeHsnOnSave } = require("../hsnNormalize");
const { normalizeUnitKey } = require("../unitMaster");
const { parseTallyMastersXml, strVal } = require("./parseTallyMastersXml");
const { mapLedgerToParty, buildPartyMapDiagnostics, TALLY_IMPORT_PIPELINE_ID } = require("./mapLedgerToParty");
const {
  mapStockItemToItem,
  mapTallyUnitMaster,
  buildStockGroupTaxLookup,
  resolveStockItemTaxFromStockGroups,
} = require("./mapStockItemToItem");

/** @typedef {"SKIP" | "UPDATE_EMPTY_FIELDS_ONLY"} DuplicateAction */
/** @typedef {"RM" | "FG"} DefaultItemType */

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_XML_BYTES = 15 * 1024 * 1024;

/** @type {Map<string, { xmlUtf8: string; options: NormalizedOptions; expiresAt: number }>} */
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
 * @param {string} xmlUtf8
 * @param {NormalizedOptions} options
 * @returns {string}
 */
function createPreviewSession(xmlUtf8, options) {
  gcSessions();
  const token = crypto.randomBytes(24).toString("hex");
  previewSessions.set(token, {
    xmlUtf8,
    options,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

/**
 * @param {string} token
 * @returns {{ xmlUtf8: string; options: NormalizedOptions } | null}
 */
function getPreviewSession(token) {
  gcSessions();
  const s = previewSessions.get(token);
  if (!s || s.expiresAt < Date.now()) return null;
  return { xmlUtf8: s.xmlUtf8, options: s.options };
}

function deletePreviewSession(token) {
  previewSessions.delete(token);
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
 */
function normalizeGstRateForItem(gstRate) {
  if (gstRate == null || !Number.isFinite(gstRate)) return 0;
  if (gstRate < 0) return 0;
  if (gstRate > 100) return 100;
  return Math.round(gstRate * 100) / 100;
}

/**
 * @param {{ tallyName: string; mapped: Record<string, unknown> }} row
 * @param {Record<string, string> | undefined} overrides
 * @param {{ defaultItemType: "RM" | "FG" }} options
 * @returns {"RM" | "FG"}
 */
function resolveItemTypeForApply(row, overrides, options) {
  const raw = overrides && typeof overrides === "object" ? overrides[row.tallyName] : undefined;
  if (raw === "RM" || raw === "FG") return raw;
  const auto = row.mapped?.autoDetectedItemType;
  if (auto === "RM" || auto === "FG") return auto;
  return options.defaultItemType === "RM" ? "RM" : "FG";
}

/**
 * @param {import("@prisma/client").PrismaClient} db
 * @param {string} xmlString
 * @param {NormalizedOptions} options
 */
async function buildPreviewPayload(db, xmlString, options) {
  const parsed = parseTallyMastersXml(xmlString);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, warnings: [], parseStats: null };
  }

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
    select: { id: true, itemName: true, hsnCode: true, gstRate: true, unitId: true, unit: true, itemType: true },
  });
  const unitsDb = await db.unit.findMany({ where: { isActive: true }, select: { id: true, unitName: true, unitCode: true } });

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
  const unitByKey = new Map(unitsDb.map((u) => [normalizeUnitKey(u.unitName), u]));

  const stockKeywordOpts = {
    fgKeywords: options.itemTypeFgKeywords,
    rmKeywords: options.itemTypeRmKeywords,
  };

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

  /** @type {Map<string, { unitName: string; unitCode: string | null; tallyGuid: string | null }>} */
  const tallyUnitsToImport = new Map();

  for (const uRaw of parsed.units) {
    const mu = mapTallyUnitMaster(uRaw);
    if (!mu) continue;
    const k = normalizeUnitKey(mu.unitName);
    if (!k) continue;
    tallyUnitsToImport.set(k, {
      unitName: normalizeMasterNameDisplay(mu.unitName),
      unitCode: mu.unitCode,
      tallyGuid: mu.tallyGuid || null,
    });
  }

  for (const sRaw of parsed.stockItems) {
    const mi = mapStockItemToItem(sRaw, stockKeywordOpts);
    if (!mi) continue;
    if (mi.baseUnit) {
      const k = normalizeUnitKey(mi.baseUnit);
      if (k && !tallyUnitsToImport.has(k)) {
        tallyUnitsToImport.set(k, {
          unitName: normalizeMasterNameDisplay(mi.baseUnit),
          unitCode: null,
          tallyGuid: null,
        });
      }
    }
  }

  for (const [uKey, uData] of tallyUnitsToImport) {
    const existing = unitByKey.get(uKey);
    const tallyName = uData.unitName;
    let proposedAction = "CREATE";
    const rowWarnings = [];
    const rowErrors = [];
    if (existing) {
      if (options.duplicateAction === "UPDATE_EMPTY_FIELDS_ONLY") {
        const canFillCode = isEmptyField(existing.unitCode) && uData.unitCode;
        proposedAction = canFillCode ? "UPDATE_EMPTY_FIELDS" : "SKIP_DUPLICATE";
        if (!canFillCode) rowWarnings.push("Unit already exists.");
      } else {
        proposedAction = "SKIP_DUPLICATE";
        rowWarnings.push("Unit already exists.");
      }
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
      mapped: { unitName: uData.unitName, unitCode: uData.unitCode },
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
        },
      });
    }
  }

  const stockGroupTaxLookup = buildStockGroupTaxLookup(parsed.stockGroups);

  for (const sRaw of parsed.stockItems) {
    const mi = mapStockItemToItem(sRaw, stockKeywordOpts);
    if (!mi) continue;
    const tax = resolveStockItemTaxFromStockGroups(
      { hsnCode: mi.hsnCode, gstRate: mi.gstRate, parentGroup: mi.parentGroup },
      stockGroupTaxLookup,
    );
    const effectiveHsn = tax.hsnCode;
    const effectiveGst = tax.gstRate;
    const nk = normalizeMasterNameKey(mi.itemName);
    const existing = itemByKey.get(nk);
    const rowWarnings = [];
    const rowErrors = [];
    /** @type {ReturnType<typeof formatFieldIssue>[]} */
    const fieldIssues = [];

    if (!mi.baseUnit) {
      pushFieldIssue(rowErrors, fieldIssues, {
        masterName: mi.itemName,
        masterType: "Item",
        field: "Base unit",
        actualValue: mi.baseUnit,
        reason: "Base unit missing in Tally stock item.",
      });
    }
    if (!effectiveHsn) {
      pushFieldIssue(rowErrors, fieldIssues, {
        masterName: mi.itemName,
        masterType: "Item",
        field: "HSN",
        actualValue: effectiveHsn,
        reason: "HSN missing in Tally stock item and parent stock groups.",
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
    if (tax.gstInheritedFrom && gstPct != null) {
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

    const unitKey = mi.baseUnit ? normalizeUnitKey(mi.baseUnit) : "";
    const unitRow = unitKey ? tallyUnitsToImport.get(unitKey) : null;
    const erpUnit = unitKey ? unitByKey.get(unitKey) : null;

    let proposedAction = "CREATE";
    if (rowErrors.length) {
      proposedAction = "ERROR";
    } else if (existing) {
      if (options.duplicateAction === "UPDATE_EMPTY_FIELDS_ONLY") {
        const gstExisting = existing.gstRate != null ? Number(existing.gstRate) : NaN;
        const gstEmpty = existing.gstRate == null || !Number.isFinite(gstExisting);
        const empties =
          isEmptyField(existing.hsnCode) ||
          gstEmpty ||
          isEmptyField(existing.unitId) ||
          isEmptyField(existing.unit);
        const tallyHas = Boolean(hsnNorm) || effectiveGst != null || Boolean(mi.baseUnit);
        proposedAction = empties && tallyHas ? "UPDATE_EMPTY_FIELDS" : "SKIP_DUPLICATE";
        if (proposedAction === "SKIP_DUPLICATE" && !empties) rowWarnings.push("Duplicate item name.");
      } else {
        proposedAction = "SKIP_DUPLICATE";
        rowWarnings.push("Duplicate item name.");
      }
    }

    const suggestedItemType =
      mi.autoDetectedItemType === "RM" || mi.autoDetectedItemType === "FG"
        ? mi.autoDetectedItemType
        : options.defaultItemType;

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
        suggestedItemType,
        itemType: suggestedItemType,
        baseUnit: mi.baseUnit ? normalizeMasterNameDisplay(mi.baseUnit) : "",
        hsnCode: hsnNorm,
        gstRate: gstPct,
        hsnSource: tax.hsnSource,
        gstSource: tax.gstSource,
        hsnInheritedFrom: tax.hsnInheritedFrom,
        gstInheritedFrom: tax.gstInheritedFrom,
        unitKey: unitKey || null,
        unitWillCreate: Boolean(unitRow && !erpUnit),
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

  const previewTotal = customers.length + suppliers.length + items.length + units.length;
  const rawTagSum =
    parseStats.tallyMessageOpenInRaw + parseStats.ledgerOpenInRaw + parseStats.stockItemOpenInRaw + parseStats.unitOpenInRaw;
  if (previewTotal === 0) {
    if (rawTagSum === 0) {
      warnings.push(
        "No supported Tally masters found in XML. Use a Tally master export that includes LEDGER / STOCKITEM / UNIT blocks (for example from Tally’s master XML / integration export), not a voucher-only or empty response file.",
      );
    }
  }
  if (parsed.ledgers.length > 0 && customers.length === 0 && suppliers.length === 0) {
    const parents = parsed.ledgers
      .slice(0, 8)
      .map((l) => strVal(/** @type {Record<string, unknown>} */ (l).PARENT))
      .filter(Boolean);
    warnings.push(
      `Found ${parsed.ledgers.length} ledger node(s) in XML, but none matched customer/supplier groups we import (e.g. Sundry Debtors / Sundry Creditors or common debtor/creditor sub-groups). Sample PARENT values: ${parents.join("; ") || "(empty)"}.`,
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
    identityBackfillEligible: identityColumnsAvailable,
    parsedMasterCounts,
    summary,
    customers,
    suppliers,
    items,
    units,
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
 * @param {Record<string, "RM" | "FG"> | undefined} itemTypeOverrides validated (values RM|FG only); unknown keys ignored
 */
async function applyFromPreviewToken(db, token, itemTypeOverrides) {
  const session = getPreviewSession(token);
  if (!session) {
    const err = new Error("Preview session expired or invalid. Run Preview again.");
    err.statusCode = 400;
    err.code = "PREVIEW_SESSION_INVALID";
    throw err;
  }

  const xmlString = session.xmlUtf8;
  const options = session.options;

  try {
  const payload = await buildPreviewPayload(db, xmlString, options);
  if (!payload.ok) {
    const err = new Error(payload.error || "Could not parse XML.");
    err.statusCode = 400;
    throw err;
  }

  const results = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  const pushResult = (entityType, tallyName, action, erpId, error, warning) => {
    results.push({ entityType, tallyName, action, erpId: erpId ?? null, error: error ?? null, warning: warning ?? null });
  };

  const stateRows = await db.state.findMany({
    where: { isActive: true },
    select: { id: true, stateName: true, stateCode: true },
  });
  const stateById = new Map(stateRows.map((s) => [s.id, s]));

  for (const row of payload.units) {
    if (row.proposedAction === "SKIP_DUPLICATE" || row.proposedAction === "ERROR") {
      if (row.proposedAction === "SKIP_DUPLICATE") {
        const outcome = await applyIdentityBackfillSafe(db, "unit", row.existingErpId, row, "UNIT", pushResult);
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
        const createdRow = await db.unit.create({
          data: {
            unitName: row.mapped.unitName,
            unitCode: row.mapped.unitCode || null,
            isActive: true,
            ...tallyIdentityCreateData(row),
          },
          select: { id: true },
        });
        created += 1;
        pushResult("UNIT", row.tallyName, "CREATED", createdRow.id, null, null);
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
      pushResult("UNIT", row.tallyName, "FAILED", null, e instanceof Error ? e.message : String(e), null);
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

  for (const row of payload.items) {
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
    try {
      const unitKey = row.mapped.unitKey;
      const u = unitKey ? unitByKeyAfter.get(unitKey) : null;
      const unitDisplay = row.mapped.baseUnit || (u ? u.unitName : "");
      if (!unitDisplay) {
        failed += 1;
        pushResult("ITEM", row.tallyName, "FAILED", null, "Unit could not be resolved.", null);
        continue;
      }
      const hsn = row.mapped.hsnCode;
      if (!hsn) {
        failed += 1;
        pushResult("ITEM", row.tallyName, "FAILED", null, "HSN required.", null);
        continue;
      }

      if (row.proposedAction === "CREATE") {
        const itemType = resolveItemTypeForApply(row, itemTypeOverrides, options);
        const createdRow = await db.item.create({
          data: {
            itemName: row.mapped.itemName,
            itemType,
            unit: unitDisplay,
            unitId: u ? u.id : null,
            minStockLevel: "0",
            hsnCode: hsn,
            gstRate: String(row.mapped.gstRate),
            redThresholdPercent: DEFAULT_CRITICAL,
            yellowThresholdPercent: DEFAULT_WARNING,
            ...tallyIdentityCreateData(row),
          },
          select: { id: true },
        });
        created += 1;
        pushResult("ITEM", row.tallyName, "CREATED", createdRow.id, null, null);
      } else if (row.proposedAction === "UPDATE_EMPTY_FIELDS" && row.existingErpId) {
        const ex = await db.item.findUnique({ where: { id: row.existingErpId } });
        if (!ex) {
          failed += 1;
          pushResult("ITEM", row.tallyName, "FAILED", null, "Item no longer exists.", null);
          continue;
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
          await db.item.update({ where: { id: ex.id }, data: patch });
          updated += 1;
          pushResult("ITEM", row.tallyName, "UPDATED", ex.id, null, null);
        } else {
          skipped += 1;
          pushResult("ITEM", row.tallyName, "SKIPPED", ex.id, null, null);
        }
      }
    } catch (e) {
      failed += 1;
      pushResult("ITEM", row.tallyName, "FAILED", null, e instanceof Error ? e.message : String(e), null);
    }
  }

  const unresolved = results.filter((r) => r.action === "FAILED" || (r.action === "SKIPPED" && r.error));
  return {
    ok: true,
    created,
    updated,
    skipped,
    failed,
    results,
    warnings: payload.warnings,
    unresolvedCount: unresolved.length,
    unresolved: unresolved.slice(0, 50),
    summaryMessage:
      failed > 0 || unresolved.length
        ? `Import finished with ${created} created, ${updated} updated (including identity backfills), ${skipped} skipped, ${failed} failed. ${unresolved.length} row(s) left unresolved — see results.`
        : `Import finished: ${created} created, ${updated} updated, ${skipped} skipped.`,
  };
  } finally {
    deletePreviewSession(token);
  }
}

module.exports = {
  buildPreviewPayload,
  createPreviewSession,
  applyFromPreviewToken,
  MAX_XML_BYTES,
  gcSessions,
  normalizeStateTextForMatch,
  stateIdFromStateText,
  formatFieldIssue,
  formatImportRowError,
  resolveExistingPartyMatch,
  tallyIdentityBackfillPatch,
  TALLY_IMPORT_PIPELINE_ID,
};
