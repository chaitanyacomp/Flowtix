const {
  strVal,
  normalizeTallyControlText,
  getByLocalTag,
  getListBlocks,
  firstDirectText,
  findFirstTextByTags,
  masterDisplayName,
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
 * Parse Tally-style GST blocks via shared LIST helpers:
 * GSTDETAILS.LIST → STATEWISEDETAILS.LIST → RATEDETAILS.LIST
 * Prefer Integrated / IGST; else CGST+SGST when equal; else largest rate among duty-labelled rows.
 * @param {unknown} stockRoot
 * @returns {number | null}
 */
function extractGstPercentFromGstBlocks(stockRoot) {
  if (!stockRoot || typeof stockRoot !== "object") return null;

  /** @type {{ duty: string; rate: number }[]} */
  const rows = [];

  for (const gd of getListBlocks(stockRoot, "GSTDETAILS")) {
    const direct = firstDirectText(gd, ["GSTRATE", "RATE", "GSTPERCENT"]);
    const dn = Number(direct);
    if (Number.isFinite(dn) && dn >= 0 && dn <= 100) rows.push({ duty: "", rate: dn });

    for (const sw of getListBlocks(gd, "STATEWISEDETAILS")) {
      for (const r of getListBlocks(sw, "RATEDETAILS")) {
        const duty = String(firstDirectText(r, ["GSTRATEDUTYHEAD"]) || "").toLowerCase();
        const rateStr = firstDirectText(r, ["GSTRATE", "RATE", "GSTPERCENT", "TAXRATE"]);
        const n = Number(rateStr);
        if (Number.isFinite(n) && n >= 0 && n <= 100) rows.push({ duty, rate: n });
      }
    }

    for (const r of getListBlocks(gd, "RATEDETAILS")) {
      const duty = String(firstDirectText(r, ["GSTRATEDUTYHEAD"]) || "").toLowerCase();
      const rateStr = firstDirectText(r, ["GSTRATE", "RATE", "GSTPERCENT", "TAXRATE"]);
      const n = Number(rateStr);
      if (Number.isFinite(n) && n >= 0 && n <= 100) rows.push({ duty, rate: n });
    }
  }

  if (!rows.length) return null;

  const integrated = rows.find((r) => r.duty.includes("integrated") || r.duty.includes("igst"));
  if (integrated) return integrated.rate;

  const cgstRates = rows.filter((r) => r.duty.includes("central") || r.duty.includes("cgst")).map((r) => r.rate);
  const sgstRates = rows
    .filter((r) => r.duty.includes("state") || r.duty.includes("sgst") || r.duty.includes("utgst"))
    .map((r) => r.rate);
  if (cgstRates.length && sgstRates.length) {
    const c = Math.max(...cgstRates);
    const sgt = Math.max(...sgstRates);
    if (Math.abs(c - sgt) < 0.02) return Math.round((c + sgt) * 100) / 100;
  }

  return Math.max(...rows.map((r) => r.rate));
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
  const name = masterDisplayName(s);
  if (!name) return null;

  const baseUnit =
    firstDirectText(s, ["BASEUNITS", "ADDITIONALUNITS", "UNIT", "UOM", "SIMPLEUNIT"]) || "";

  const hsnCodeRaw =
    firstDirectText(s, ["HSNCODE", "HSNSAC", "HSN", "SACCODE"]) || extractHsnDeep(s) || null;
  const gstRate = extractGstPercentFromGstBlocks(s) ?? extractGstPercentDeep(s);

  const { tallyStockGroup, classificationHaystack, parentGroup } = extractStockGroupContext(s);
  const autoDetectedItemType = classificationHaystack
    ? classifyItemTypeFromStockGroupHaystack(classificationHaystack, keywordOpts)
    : null;

  return {
    tallyName: name,
    itemName: name,
    baseUnit: baseUnit || "",
    hsnCode: hsnCodeRaw,
    gstRate: gstRate != null && Number.isFinite(gstRate) ? gstRate : null,
    hsnSource: hsnCodeRaw ? "STOCKITEM" : null,
    gstSource: gstRate != null && Number.isFinite(gstRate) ? "STOCKITEM" : null,
    parentGroup,
    tallyStockGroup,
    autoDetectedItemType,
  };
}

/**
 * @param {unknown} unitRaw
 * @returns {null | { tallyName: string; unitName: string; unitCode: string | null }}
 */
function mapTallyUnitMaster(unitRaw) {
  if (!unitRaw || typeof unitRaw !== "object") return null;
  const u = /** @type {Record<string, unknown>} */ (unitRaw);
  const unitName = masterDisplayName(u);
  if (!unitName) return null;
  const unitCode = firstDirectText(u, ["SYMBOL", "GSTREPUOM", "UQC"]) || null;
  return {
    tallyName: unitName,
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
  classifyItemTypeFromStockGroupHaystack,
  extractStockGroupContext,
  buildStockGroupTaxLookup,
  resolveStockItemTaxFromStockGroups,
  stockGroupLookupKey,
  DEFAULT_ITEM_TYPE_FG_KEYWORDS,
  DEFAULT_ITEM_TYPE_RM_KEYWORDS,
  asArray,
};
