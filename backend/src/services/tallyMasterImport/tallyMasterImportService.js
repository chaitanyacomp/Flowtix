const crypto = require("crypto");
const {
  normalizeMasterNameDisplay,
  normalizeMasterNameKey,
} = require("../masterNameNormalize");
const { normalizeGstinOnSave } = require("../gstinNormalize");
const { normalizeHsnOnSave } = require("../hsnNormalize");
const { normalizeUnitKey } = require("../unitMaster");
const { parseTallyMastersXml, strVal } = require("./parseTallyMastersXml");
const { mapLedgerToParty } = require("./mapLedgerToParty");
const { mapStockItemToItem, mapTallyUnitMaster } = require("./mapStockItemToItem");

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
  const g = normalizeGstinOnSave(gstin);
  if (!g || g.length < 2) return null;
  const code = g.slice(0, 2);
  if (!/^\d{2}$/.test(code)) return null;
  const hit = statesByCode.get(code);
  return hit ? hit.id : null;
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

  const customersDb = await db.customer.findMany({
    select: { id: true, name: true, gst: true, address: true, stateId: true, state: true, contact: true, email: true },
  });
  const suppliersDb = await db.supplier.findMany({
    select: { id: true, name: true, gst: true, address: true, stateId: true, stateName: true, stateCode: true, contact: true, email: true },
  });
  const itemsDb = await db.item.findMany({
    select: { id: true, itemName: true, hsnCode: true, gstRate: true, unitId: true, unit: true, itemType: true },
  });
  const unitsDb = await db.unit.findMany({ where: { isActive: true }, select: { id: true, unitName: true, unitCode: true } });

  const customerByKey = new Map(customersDb.map((c) => [normalizeMasterNameKey(c.name), c]));
  const supplierByKey = new Map(suppliersDb.map((s) => [normalizeMasterNameKey(s.name), s]));
  const itemByKey = new Map(itemsDb.map((it) => [normalizeMasterNameKey(it.itemName), it]));
  const unitByKey = new Map(unitsDb.map((u) => [normalizeUnitKey(u.unitName), u]));

  const stockKeywordOpts = {
    fgKeywords: options.itemTypeFgKeywords,
    rmKeywords: options.itemTypeRmKeywords,
  };

  const warnings = [...parsed.warnings];
  const customers = [];
  const suppliers = [];
  const items = [];
  const units = [];

  /** @type {Map<string, { unitName: string; unitCode: string | null }>} */
  const tallyUnitsToImport = new Map();

  for (const uRaw of parsed.units) {
    const mu = mapTallyUnitMaster(uRaw);
    if (!mu) continue;
    const k = normalizeUnitKey(mu.unitName);
    if (!k) continue;
    tallyUnitsToImport.set(k, { unitName: normalizeMasterNameDisplay(mu.unitName), unitCode: mu.unitCode });
  }

  for (const sRaw of parsed.stockItems) {
    const mi = mapStockItemToItem(sRaw, stockKeywordOpts);
    if (!mi) continue;
    if (mi.baseUnit) {
      const k = normalizeUnitKey(mi.baseUnit);
      if (k && !tallyUnitsToImport.has(k)) {
        tallyUnitsToImport.set(k, { unitName: normalizeMasterNameDisplay(mi.baseUnit), unitCode: null });
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
      proposedAction,
      existingErpId: existing ? existing.id : null,
      warnings: rowWarnings,
      errors: rowErrors,
      mapped: { unitName: uData.unitName, unitCode: uData.unitCode },
    });
  }

  for (const lRaw of parsed.ledgers) {
    const cust = mapLedgerToParty(lRaw, "CUSTOMER");
    if (cust) {
      const nk = normalizeMasterNameKey(cust.name);
      const existing = customerByKey.get(nk);
      const gstNorm = cust.gst ? normalizeGstinOnSave(cust.gst) : null;
      const stateId =
        stateIdFromGstinPrefix(gstNorm, statesByCode) ||
        stateIdFromStateText(cust.stateText, states) ||
        (options.fallbackStateId && states.some((s) => s.id === options.fallbackStateId) ? options.fallbackStateId : null);

      const rowWarnings = [];
      const rowErrors = [];
      if (existing && gstNorm && existing.gst) {
        const eg = normalizeGstinOnSave(existing.gst);
        if (eg && gstNorm && eg !== gstNorm) rowWarnings.push("GSTIN in Tally differs from existing customer record.");
      }

      let proposedAction = "CREATE";
      if (existing) {
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
          if (proposedAction === "SKIP_DUPLICATE" && !empties) rowWarnings.push("Duplicate customer name.");
        } else {
          proposedAction = "SKIP_DUPLICATE";
          rowWarnings.push("Duplicate customer name.");
        }
      }

      customers.push({
        entityType: "CUSTOMER",
        tallyName: cust.tallyName,
        proposedAction,
        existingErpId: existing ? existing.id : null,
        warnings: rowWarnings,
        errors: rowErrors,
        mapped: {
          name: normalizeMasterNameDisplay(cust.name),
          gst: gstNorm,
          address: cust.address,
          stateText: cust.stateText,
          stateId,
          contact: cust.contact || null,
          email: safeEmailOrNull(cust.email),
        },
      });
    }

    const sup = mapLedgerToParty(lRaw, "SUPPLIER");
    if (sup) {
      const nk = normalizeMasterNameKey(sup.name);
      const existing = supplierByKey.get(nk);
      const gstNorm = sup.gst ? normalizeGstinOnSave(sup.gst) : null;
      const stateId =
        stateIdFromGstinPrefix(gstNorm, statesByCode) ||
        stateIdFromStateText(sup.stateText, states) ||
        (options.fallbackStateId && states.some((s) => s.id === options.fallbackStateId) ? options.fallbackStateId : null);

      const rowWarnings = [];
      const rowErrors = [];
      if (!stateId) {
        rowErrors.push("State could not be matched. Choose a fallback state in import options or fix the Tally address/GSTIN.");
      }
      if (existing && gstNorm && existing.gst) {
        const eg = normalizeGstinOnSave(existing.gst);
        if (eg && gstNorm && eg !== gstNorm) rowWarnings.push("GSTIN in Tally differs from existing supplier record.");
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
          if (proposedAction === "SKIP_DUPLICATE" && !empties) rowWarnings.push("Duplicate supplier name.");
        } else {
          proposedAction = "SKIP_DUPLICATE";
          rowWarnings.push("Duplicate supplier name.");
        }
      }

      suppliers.push({
        entityType: "SUPPLIER",
        tallyName: sup.tallyName,
        proposedAction,
        existingErpId: existing ? existing.id : null,
        warnings: rowWarnings,
        errors: rowErrors,
        mapped: {
          name: normalizeMasterNameDisplay(sup.name),
          gst: gstNorm,
          address: sup.address,
          stateId,
          contact: sup.contact || null,
          email: safeEmailOrNull(sup.email),
        },
      });
    }
  }

  for (const sRaw of parsed.stockItems) {
    const mi = mapStockItemToItem(sRaw, stockKeywordOpts);
    if (!mi) continue;
    const nk = normalizeMasterNameKey(mi.itemName);
    const existing = itemByKey.get(nk);
    const rowWarnings = [];
    const rowErrors = [];

    if (!mi.baseUnit) rowErrors.push("Base unit missing in Tally stock item.");
    if (!mi.hsnCode) rowErrors.push("HSN missing in Tally stock item.");

    const hsnNorm = mi.hsnCode ? normalizeHsnOnSave(mi.hsnCode) : null;
    if (mi.hsnCode && !hsnNorm) rowErrors.push("HSN could not be normalized.");

    const gstPct = normalizeGstRateForItem(mi.gstRate);

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
        const tallyHas = Boolean(hsnNorm) || mi.gstRate != null || Boolean(mi.baseUnit);
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
      proposedAction,
      existingErpId: existing ? existing.id : null,
      warnings: rowWarnings,
      errors: rowErrors,
      mapped: {
        itemName: normalizeMasterNameDisplay(mi.itemName),
        tallyStockGroup: mi.tallyStockGroup,
        autoDetectedItemType: mi.autoDetectedItemType,
        defaultItemType: options.defaultItemType,
        suggestedItemType,
        itemType: suggestedItemType,
        baseUnit: mi.baseUnit ? normalizeMasterNameDisplay(mi.baseUnit) : "",
        hsnCode: hsnNorm,
        gstRate: gstPct,
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

  return {
    ok: true,
    warnings,
    summary,
    customers,
    suppliers,
    items,
    units,
    parseStats,
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
      skipped += 1;
      pushResult("UNIT", row.tallyName, "SKIPPED", row.existingErpId, null, row.warnings[0] || null);
      continue;
    }
    try {
      if (row.proposedAction === "CREATE") {
        const createdRow = await db.unit.create({
          data: {
            unitName: row.mapped.unitName,
            unitCode: row.mapped.unitCode || null,
            isActive: true,
          },
          select: { id: true },
        });
        created += 1;
        pushResult("UNIT", row.tallyName, "CREATED", createdRow.id, null, null);
      } else if (row.proposedAction === "UPDATE_EMPTY_FIELDS" && row.existingErpId) {
        const ex = await db.unit.findUnique({ where: { id: row.existingErpId } });
        if (ex && isEmptyField(ex.unitCode) && row.mapped.unitCode) {
          await db.unit.update({ where: { id: ex.id }, data: { unitCode: row.mapped.unitCode } });
          updated += 1;
          pushResult("UNIT", row.tallyName, "UPDATED", ex.id, null, null);
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
      skipped += 1;
      pushResult("CUSTOMER", row.tallyName, "SKIPPED", row.existingErpId, null, row.warnings[0] || null);
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
          },
          select: { id: true },
        });
        created += 1;
        pushResult("CUSTOMER", row.tallyName, "CREATED", createdRow.id, null, null);
      } else if (row.proposedAction === "UPDATE_EMPTY_FIELDS" && row.existingErpId) {
        const ex = await db.customer.findUnique({ where: { id: row.existingErpId } });
        if (!ex) {
          failed += 1;
          pushResult("CUSTOMER", row.tallyName, "FAILED", null, "Customer no longer exists.", null);
          continue;
        }
        const patch = {};
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
      }
    } catch (e) {
      failed += 1;
      pushResult("CUSTOMER", row.tallyName, "FAILED", null, e instanceof Error ? e.message : String(e), null);
    }
  }

  for (const row of payload.suppliers) {
    if (row.proposedAction === "SKIP_DUPLICATE" || row.proposedAction === "ERROR") {
      skipped += 1;
      pushResult("SUPPLIER", row.tallyName, "SKIPPED", row.existingErpId, row.errors[0] || null, row.warnings[0] || null);
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
          },
          select: { id: true },
        });
        created += 1;
        pushResult("SUPPLIER", row.tallyName, "CREATED", createdRow.id, null, null);
      } else if (row.proposedAction === "UPDATE_EMPTY_FIELDS" && row.existingErpId) {
        const ex = await db.supplier.findUnique({ where: { id: row.existingErpId } });
        if (!ex) {
          failed += 1;
          pushResult("SUPPLIER", row.tallyName, "FAILED", null, "Supplier no longer exists.", null);
          continue;
        }
        const patch = {};
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
      }
    } catch (e) {
      failed += 1;
      pushResult("SUPPLIER", row.tallyName, "FAILED", null, e instanceof Error ? e.message : String(e), null);
    }
  }

  const DEFAULT_CRITICAL = 50;
  const DEFAULT_WARNING = 80;

  for (const row of payload.items) {
    if (row.proposedAction === "SKIP_DUPLICATE" || row.proposedAction === "ERROR") {
      skipped += 1;
      pushResult("ITEM", row.tallyName, "SKIPPED", row.existingErpId, row.errors[0] || null, row.warnings[0] || null);
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
        const patch = {};
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

  return {
    ok: true,
    created,
    updated,
    skipped,
    failed,
    results,
    warnings: payload.warnings,
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
};
