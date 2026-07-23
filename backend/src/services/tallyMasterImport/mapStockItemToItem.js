const {
  strVal,
  normalizeTallyControlText,
  getByLocalTag,
  getListBlocks,
  firstDirectText,
  findFirstTextByTags,
  masterDisplayName,
  masterGuid,
  asArray,
} = require("./tallyXmlListHelpers");

/**
 * HSN / SAC may appear only under GSTDETAILS.LIST in Tally Prime exports (not only at STOCKITEM root).
 * @param {unknown} node
 * @returns {string | null}
 */
function extractHsnDeep(node) {
  const t = findFirstTextByTags(node, ["HSNCODE", "HSNSAC", "HSN", "SACCODE", "SERVICECODE"], 28);
  return t || null;
}

/**
 * Parse Tally APPLICABLEFROM (often YYYYMMDD or DD-MMM-YY style) for ordering.
 * @param {unknown} raw
 * @returns {number} sortable timestamp (0 if unknown)
 */
function applicableFromSortKey(raw) {
  const t = String(raw || "")
    .trim()
    .replace(/[^0-9]/g, "");
  if (/^\d{8}$/.test(t)) {
    const y = Number(t.slice(0, 4));
    const m = Number(t.slice(4, 6));
    const d = Number(t.slice(6, 8));
    if (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return Date.UTC(y, m - 1, d);
    }
  }
  if (/^\d{1,10}$/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * IGST rate from a single GSTDETAILS block (Integrated / IGST duty head only).
 * Blank / missing → null (Unresolved/Inherited — never coerce to 0%).
 * @param {unknown} gd
 * @returns {number | null}
 */
function extractIgstRateFromGstDetailsBlock(gd) {
  if (!gd || typeof gd !== "object") return null;
  /** @type {number[]} */
  const igst = [];

  for (const sw of getListBlocks(gd, "STATEWISEDETAILS")) {
    for (const r of getListBlocks(sw, "RATEDETAILS")) {
      const duty = String(firstDirectText(r, ["GSTRATEDUTYHEAD"]) || "").toLowerCase();
      if (!(duty.includes("integrated") || duty.includes("igst"))) continue;
      const rateStr = firstDirectText(r, ["GSTRATE", "RATE", "GSTPERCENT", "TAXRATE"]);
      if (!String(rateStr || "").trim()) continue;
      const n = Number(rateStr);
      if (Number.isFinite(n) && n >= 0 && n <= 100) igst.push(n);
    }
  }
  for (const r of getListBlocks(gd, "RATEDETAILS")) {
    const duty = String(firstDirectText(r, ["GSTRATEDUTYHEAD"]) || "").toLowerCase();
    if (!(duty.includes("integrated") || duty.includes("igst"))) continue;
    const rateStr = firstDirectText(r, ["GSTRATE", "RATE", "GSTPERCENT", "TAXRATE"]);
    if (!String(rateStr || "").trim()) continue;
    const n = Number(rateStr);
    if (Number.isFinite(n) && n >= 0 && n <= 100) igst.push(n);
  }

  // Some exports put a single GSTRATE on the GSTDETAILS block with TAXTYPE Integrated.
  const taxType = String(firstDirectText(gd, ["TAXTYPE", "GSTREGISTRATIONTYPE", "HSNMASTERNAME"]) || "").toLowerCase();
  const direct = firstDirectText(gd, ["GSTRATE", "RATE", "GSTPERCENT"]);
  if (String(direct || "").trim() && (taxType.includes("integrated") || taxType.includes("igst"))) {
    const n = Number(direct);
    if (Number.isFinite(n) && n >= 0 && n <= 100) igst.push(n);
  }

  if (!igst.length) return null;
  return igst[igst.length - 1];
}

/**
 * Select IGST from the **latest applicable** GSTDETAILS record (by APPLICABLEFROM).
 * Do not use the first GSTRATE blindly. Blank/inherited stays null.
 * @param {unknown} stockRoot
 * @returns {{ rate: number | null; source: "STOCKITEM_LATEST_IGST" | null; applicableFrom: string | null }}
 */
function extractLatestApplicableIgst(stockRoot) {
  if (!stockRoot || typeof stockRoot !== "object") {
    return { rate: null, source: null, applicableFrom: null };
  }
  const blocks = getListBlocks(stockRoot, "GSTDETAILS");
  if (!blocks.length) return { rate: null, source: null, applicableFrom: null };

  const ranked = blocks.map((gd, idx) => {
    const applicableFrom = firstDirectText(gd, ["APPLICABLEFROM", "APPDATE", "FROMDATE"]) || "";
    return {
      gd,
      idx,
      sortKey: applicableFromSortKey(applicableFrom),
      applicableFrom,
    };
  });
  ranked.sort((a, b) => b.sortKey - a.sortKey || b.idx - a.idx);

  for (const row of ranked) {
    const rate = extractIgstRateFromGstDetailsBlock(row.gd);
    if (rate != null) {
      return { rate, source: "STOCKITEM_LATEST_IGST", applicableFrom: row.applicableFrom || null };
    }
  }
  // Latest block(s) present but IGST blank → unresolved (do not fall back to arbitrary GSTRATE).
  return { rate: null, source: null, applicableFrom: ranked[0]?.applicableFrom || null };
}

/**
 * Legacy helper kept for STOCKGROUP tax inherit — prefers IGST when labelled.
 * Prefer extractLatestApplicableIgst for STOCKITEM masters.
 * @param {unknown} stockRoot
 * @returns {number | null}
 */
function extractGstPercentFromGstBlocks(stockRoot) {
  const latest = extractLatestApplicableIgst(stockRoot);
  if (latest.rate != null) return latest.rate;
  return null;
}

/**
 * Deep-scan for GST % under stock item (prefers Integrated Tax row when labeled).
 * @param {unknown} node
 * @param {number} depth
 * @returns {number | null}
 */
function extractGstPercentDeep(node, depth = 0) {
  if (depth > 30 || node == null) return null;
  if (typeof node === "string" || typeof node === "number") {
    const n = Number(node);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  }
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = extractGstPercentDeep(x, depth + 1);
      if (r != null) return r;
    }
    return null;
  }
  if (typeof node !== "object") return null;

  const o = /** @type {Record<string, unknown>} */ (node);
  const duty = String(strVal(getByLocalTag(o, "GSTRATEDUTYHEAD")) || "").toLowerCase();
  const rateStr = firstDirectText(o, ["GSTRATE", "RATE", "GSTPERCENT"]);
  if (rateStr && (duty.includes("integrated") || duty.includes("igst"))) {
    const n = Number(rateStr);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  }

  let fallback = null;
  for (const v of Object.values(o)) {
    const r = extractGstPercentDeep(v, depth + 1);
    if (r != null && fallback == null) fallback = r;
  }
  if (fallback != null) return fallback;

  if (rateStr) {
    const n = Number(rateStr);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  }
  return null;
}

/** Default FG hints from Tally stock group / category naming (case-insensitive). */
const DEFAULT_ITEM_TYPE_FG_KEYWORDS = ["finished goods", "finish goods", "finished good", "finished", "fg"];

/** Default RM hints from Tally stock group / category naming (case-insensitive). */
const DEFAULT_ITEM_TYPE_RM_KEYWORDS = [
  "raw material",
  "raw materials",
  "consumables",
  "consumable",
  "packing",
  "raw",
  "rm",
];

/**
 * @param {string} s
 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} raw
 */
function normalizeMatchText(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * @param {string} hayNormalized
 * @param {string} keyword
 */
function keywordMatchesHaystack(hayNormalized, keyword) {
  const k = normalizeMatchText(keyword);
  if (!k || !hayNormalized) return false;
  if (k.includes(" ")) return hayNormalized.includes(k);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(k)}([^a-z0-9]|$)`, "i").test(hayNormalized);
}

/**
 * @param {string} hayNormalized
 * @param {string[]} keywords
 * @returns {{ keyword: string; len: number } | null}
 */
function bestKeywordMatch(hayNormalized, keywords) {
  let best = /** @type {{ keyword: string; len: number } | null} */ (null);
  for (const kw of keywords) {
    if (!kw || typeof kw !== "string") continue;
    if (keywordMatchesHaystack(hayNormalized, kw)) {
      const len = normalizeMatchText(kw).length;
      if (!best || len > best.len) best = { keyword: kw, len };
    }
  }
  return best;
}

/**
 * @param {string} hayNormalized
 * @param {{ rmKeywords?: string[]; fgKeywords?: string[] }} opts
 * @returns {"RM" | "FG" | null}
 */
function classifyItemTypeFromStockGroupHaystack(hayNormalized, opts = {}) {
  const rmList = opts.rmKeywords?.length ? opts.rmKeywords : DEFAULT_ITEM_TYPE_RM_KEYWORDS;
  const fgList = opts.fgKeywords?.length ? opts.fgKeywords : DEFAULT_ITEM_TYPE_FG_KEYWORDS;
  const rm = bestKeywordMatch(hayNormalized, rmList);
  const fg = bestKeywordMatch(hayNormalized, fgList);
  if (!rm && !fg) return null;
  if (!rm) return "FG";
  if (!fg) return "RM";
  if (rm.len > fg.len) return "RM";
  if (fg.len > rm.len) return "FG";
  return "RM";
}

/**
 * Collect Tally stock-group context from STOCKITEM (PARENT, CATEGORY, STOCKGROUP blocks).
 * Display text is normalized so Tally control junk (`\u0004` / `&#4;`) never reaches the UI.
 * @param {Record<string, unknown>} s
 * @returns {{ tallyStockGroup: string | null; classificationHaystack: string; parentGroup: string | null }}
 */
function extractStockGroupContext(s) {
  /** @type {string[]} */
  const parts = [];
  const add = (v) => {
    const t = normalizeTallyControlText(strVal(v));
    if (!t) return;
    if (!parts.some((p) => p.toLowerCase() === t.toLowerCase())) parts.push(t);
  };

  add(getByLocalTag(s, "PARENT"));
  add(getByLocalTag(s, "CATEGORY"));
  add(getByLocalTag(s, "STOCKCATEGORY"));
  add(getByLocalTag(s, "STOCKTYPE"));
  add(getByLocalTag(s, "STOCKGROUP.NAME"));
  add(getByLocalTag(s, "CATEGORYNAME"));

  const sg = getByLocalTag(s, "STOCKGROUP");
  if (sg && typeof sg === "object" && !Array.isArray(sg)) {
    add(getByLocalTag(sg, "NAME"));
    add(getByLocalTag(sg, "ORIGINALNAME"));
  }

  for (const b of getListBlocks(s, "STOCKGROUP")) {
    add(getByLocalTag(b, "NAME"));
    add(getByLocalTag(b, "ORIGINALNAME"));
  }

  const parentGroup =
    normalizeTallyControlText(firstDirectText(s, ["PARENT", "PARENTNAME"])) || null;

  const tallyStockGroup = parts.length ? parts.join(" · ") : null;
  const classificationHaystack = normalizeMatchText(parts.join(" "));
  return { tallyStockGroup, classificationHaystack, parentGroup };
}

/**
 * @param {unknown} stockRaw
 * @param {{ rmKeywords?: string[]; fgKeywords?: string[] }} [keywordOpts]
 */
function mapStockItemToItem(stockRaw, keywordOpts = {}) {
  if (!stockRaw || typeof stockRaw !== "object") return null;
  const s = /** @type {Record<string, unknown>} */ (stockRaw);

  const deletedRaw = String(firstDirectText(s, ["ISDELETED"]) || strVal(s.ISDELETED) || "")
    .trim()
    .toLowerCase();
  const isDeleted = deletedRaw === "yes" || deletedRaw === "y" || deletedRaw === "true" || deletedRaw === "1";
  if (isDeleted) return null;

  const name = masterDisplayName(s);
  if (!name) return null;

  const baseUnit =
    firstDirectText(s, ["BASEUNITS", "ADDITIONALUNITS", "UNIT", "UOM", "SIMPLEUNIT"]) || "";

  const hsnCodeRaw =
    firstDirectText(s, ["HSNCODE", "HSNSAC", "HSN", "SACCODE"]) || extractHsnDeep(s) || null;
  const igst = extractLatestApplicableIgst(s);
  // Do not deep-scan arbitrary GSTRATE — blank/inherited stays unresolved for operator review.
  const gstRate = igst.rate;

  const { tallyStockGroup, classificationHaystack, parentGroup } = extractStockGroupContext(s);
  const autoDetectedItemType = classificationHaystack
    ? classifyItemTypeFromStockGroupHaystack(classificationHaystack, keywordOpts)
    : null;

  return {
    tallyName: name,
    tallyGuid: masterGuid(s),
    itemName: name,
    baseUnit: baseUnit || "",
    hsnCode: hsnCodeRaw,
    gstRate: gstRate != null && Number.isFinite(gstRate) ? gstRate : null,
    gstUnresolved: gstRate == null,
    gstStatus: gstRate == null ? "Unresolved/Inherited" : "Resolved",
    hsnSource: hsnCodeRaw ? "STOCKITEM" : null,
    gstSource: igst.source,
    gstApplicableFrom: igst.applicableFrom,
    parentGroup,
    tallyStockGroup,
    autoDetectedItemType,
    isDeleted: false,
  };
}

/**
 * @param {unknown} unitRaw
 * @returns {null | { tallyName: string; tallyGuid: string | null; unitName: string; unitCode: string | null }}
 */
function mapTallyUnitMaster(unitRaw) {
  if (!unitRaw || typeof unitRaw !== "object") return null;
  const u = /** @type {Record<string, unknown>} */ (unitRaw);
  const unitName = masterDisplayName(u);
  if (!unitName) return null;
  const unitCode = firstDirectText(u, ["SYMBOL", "GSTREPUOM", "UQC"]) || null;
  return {
    tallyName: unitName,
    tallyGuid: masterGuid(u),
    unitName,
    unitCode: unitCode || null,
  };
}

/**
 * Map Tally STOCKGROUP master (parsed; apply-to-ERP may be deferred).
 * HSN/GST often live on STOCKGROUP and are inherited by child STOCKITEMs.
 * @param {unknown} raw
 */
function mapTallyStockGroupMaster(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const name = masterDisplayName(o);
  if (!name) return null;
  const parent = firstDirectText(o, ["PARENT", "PARENTNAME"]) || null;
  const isAddable = String(firstDirectText(o, ["ISADDABLE"]) || "").toLowerCase() !== "no";
  const hsnCode =
    firstDirectText(o, ["HSNCODE", "HSNSAC", "HSN", "SACCODE"]) || extractHsnDeep(o) || null;
  const gstRate = extractGstPercentFromGstBlocks(o) ?? extractGstPercentDeep(o);
  return {
    tallyName: name,
    stockGroupName: name,
    parentGroup: parent ? normalizeTallyControlText(parent) || null : null,
    isAddable,
    hsnCode,
    gstRate: gstRate != null && Number.isFinite(gstRate) ? gstRate : null,
  };
}

/**
 * @param {unknown} name
 * @returns {string}
 */
function stockGroupLookupKey(name) {
  return normalizeTallyControlText(name).toLowerCase().replace(/\s+/g, " ");
}

/**
 * Build name → { parent, hsn, gst } lookup from parsed STOCKGROUP masters.
 * @param {Iterable<unknown>} stockGroupRaws
 * @returns {Map<string, { name: string; parent: string | null; hsnCode: string | null; gstRate: number | null }>}
 */
function buildStockGroupTaxLookup(stockGroupRaws) {
  /** @type {Map<string, { name: string; parent: string | null; hsnCode: string | null; gstRate: number | null }>} */
  const map = new Map();
  for (const raw of stockGroupRaws || []) {
    const mg = mapTallyStockGroupMaster(raw);
    if (!mg) continue;
    const key = stockGroupLookupKey(mg.stockGroupName);
    if (!key) continue;
    map.set(key, {
      name: mg.stockGroupName,
      parent: mg.parentGroup,
      hsnCode: mg.hsnCode || null,
      gstRate: mg.gstRate,
    });
  }
  return map;
}

/**
 * Resolve HSN/GST for a stock item: direct item values win; else walk PARENT stock group
 * then recursive parents (nearest group first). ERROR only if still unresolved after walk.
 *
 * @param {{ hsnCode?: string | null; gstRate?: number | null; parentGroup?: string | null }} itemMapped
 * @param {Map<string, { name: string; parent: string | null; hsnCode: string | null; gstRate: number | null }>} groupLookup
 * @returns {{
 *   hsnCode: string | null;
 *   gstRate: number | null;
 *   hsnSource: string | null;
 *   gstSource: string | null;
 *   hsnInheritedFrom: string | null;
 *   gstInheritedFrom: string | null;
 * }}
 */
function resolveStockItemTaxFromStockGroups(itemMapped, groupLookup) {
  let hsnCode = itemMapped?.hsnCode ? String(itemMapped.hsnCode).trim() || null : null;
  let gstRate =
    itemMapped?.gstRate != null && Number.isFinite(Number(itemMapped.gstRate))
      ? Number(itemMapped.gstRate)
      : null;
  /** @type {string | null} */
  let hsnSource = hsnCode ? "STOCKITEM" : null;
  /** @type {string | null} */
  let gstSource = gstRate != null ? "STOCKITEM" : null;
  /** @type {string | null} */
  let hsnInheritedFrom = null;
  /** @type {string | null} */
  let gstInheritedFrom = null;

  if (hsnCode && gstRate != null) {
    return { hsnCode, gstRate, hsnSource, gstSource, hsnInheritedFrom, gstInheritedFrom };
  }

  const visited = new Set();
  let current = itemMapped?.parentGroup ? normalizeTallyControlText(itemMapped.parentGroup) : "";
  while (current) {
    const key = stockGroupLookupKey(current);
    if (!key || visited.has(key)) break;
    visited.add(key);
    const g = groupLookup?.get(key);
    if (!g) break;

    if (!hsnCode && g.hsnCode) {
      hsnCode = String(g.hsnCode).trim() || null;
      if (hsnCode) {
        hsnSource = `STOCKGROUP:${g.name}`;
        hsnInheritedFrom = g.name;
      }
    }
    if (gstRate == null && g.gstRate != null && Number.isFinite(Number(g.gstRate))) {
      gstRate = Number(g.gstRate);
      gstSource = `STOCKGROUP:${g.name}`;
      gstInheritedFrom = g.name;
    }
    if (hsnCode && gstRate != null) break;
    current = g.parent ? normalizeTallyControlText(g.parent) : "";
  }

  return { hsnCode, gstRate, hsnSource, gstSource, hsnInheritedFrom, gstInheritedFrom };
}

/**
 * Map Tally GODOWN master (parsed; Location mapping apply may be deferred).
 * @param {unknown} raw
 */
function mapTallyGodownMaster(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const name = masterDisplayName(o);
  if (!name) return null;
  const parent = firstDirectText(o, ["PARENT", "PARENTNAME"]) || null;
  const address = firstDirectText(o, ["ADDRESS", "PINCODE"]) || null;
  return {
    tallyName: name,
    godownName: name,
    parentGodown: parent,
    addressHint: address,
  };
}

/**
 * Map Tally VOUCHERTYPE master (parsed for completeness; voucher import remains out of Release-1 apply).
 * @param {unknown} raw
 */
function mapTallyVoucherTypeMaster(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const name = masterDisplayName(o);
  if (!name) return null;
  const parent = firstDirectText(o, ["PARENT"]) || null;
  const numberingMethod = firstDirectText(o, ["NUMBERINGMETHOD"]) || null;
  return {
    tallyName: name,
    voucherTypeName: name,
    parent,
    numberingMethod,
  };
}

module.exports = {
  mapStockItemToItem,
  mapTallyUnitMaster,
  mapTallyStockGroupMaster,
  mapTallyGodownMaster,
  mapTallyVoucherTypeMaster,
  extractGstPercentDeep,
  extractHsnDeep,
  extractGstPercentFromGstBlocks,
  extractLatestApplicableIgst,
  extractIgstRateFromGstDetailsBlock,
  classifyItemTypeFromStockGroupHaystack,
  extractStockGroupContext,
  buildStockGroupTaxLookup,
  resolveStockItemTaxFromStockGroups,
  stockGroupLookupKey,
  DEFAULT_ITEM_TYPE_FG_KEYWORDS,
  DEFAULT_ITEM_TYPE_RM_KEYWORDS,
  asArray,
};
