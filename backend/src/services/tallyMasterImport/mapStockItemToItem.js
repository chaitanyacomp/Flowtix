const { strVal } = require("./parseTallyMastersXml");

/** @param {unknown} v */
function normalizeList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Local tag name upper (handles `n0:HSNCODE` if ever present; parser usually strips NS).
 * @param {string} key
 */
function localKeyUpper(key) {
  if (typeof key !== "string" || key.startsWith("@_")) return "";
  const base = key.includes(":") ? key.slice(key.lastIndexOf(":") + 1) : key;
  return base.toUpperCase();
}

/**
 * HSN / SAC may appear only under GSTDETAILS.LIST in Tally Prime exports (not only at STOCKITEM root).
 * @param {unknown} node
 * @param {number} depth
 * @param {number} maxDepth
 * @returns {string | null}
 */
function extractHsnDeep(node, depth = 0, maxDepth = 28) {
  if (depth > maxDepth || node == null) return null;
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = extractHsnDeep(x, depth + 1, maxDepth);
      if (r) return r;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (node);
  for (const [k, val] of Object.entries(o)) {
    const ku = localKeyUpper(k);
    if (ku === "HSNCODE" || ku === "HSNSAC" || ku === "HSN" || ku === "SACCODE" || ku === "SERVICECODE") {
      const t = strVal(val);
      if (t) return t;
    }
  }
  for (const val of Object.values(o)) {
    const r = extractHsnDeep(val, depth + 1, maxDepth);
    if (r) return r;
  }
  return null;
}

/**
 * Parse Tally-style GST blocks: GSTDETAILS.LIST → STATEWISEDETAILS.LIST → RATEDETAILS.LIST (see salesBillTallyXml).
 * Prefer Integrated / IGST; else CGST+SGST when equal; else largest rate among duty-labelled rows.
 * @param {unknown} stockRoot
 * @returns {number | null}
 */
function extractGstPercentFromGstBlocks(stockRoot) {
  if (!stockRoot || typeof stockRoot !== "object") return null;
  const s = /** @type {Record<string, unknown>} */ (stockRoot);
  const gstRoots = /** @type {Record<string, unknown>[]} */ ([]);
  const seenGd = new WeakSet();
  for (const chunk of [s["GSTDETAILS.LIST"], s.GSTDETAILS, s.GSTDETAILS_LIST]) {
    for (const gd of normalizeList(chunk)) {
      if (gd && typeof gd === "object" && !seenGd.has(gd)) {
        seenGd.add(gd);
        gstRoots.push(/** @type {Record<string, unknown>} */ (gd));
      }
    }
  }

  /** @type {{ duty: string; rate: number }[]} */
  const rows = [];

  for (const gd of gstRoots) {
    const g = /** @type {Record<string, unknown>} */ (gd);
    const direct = strVal(g.GSTRATE) || strVal(g.RATE) || strVal(g.GSTPERCENT);
    const dn = Number(direct);
    if (Number.isFinite(dn) && dn >= 0 && dn <= 100) rows.push({ duty: "", rate: dn });

    const stateWiseBlocks = [
      ...normalizeList(g["STATEWISEDETAILS.LIST"]),
      ...normalizeList(g.STATEWISEDETAILS),
      ...normalizeList(g["STATEWISEDETAILS_LIST"]),
    ];

    for (const sw of stateWiseBlocks) {
      if (!sw || typeof sw !== "object") continue;
      const swObj = /** @type {Record<string, unknown>} */ (sw);
      const rateBlocks = [...normalizeList(swObj["RATEDETAILS.LIST"]), ...normalizeList(swObj.RATEDETAILS)];
      for (const r of rateBlocks) {
        if (!r || typeof r !== "object") continue;
        const ro = /** @type {Record<string, unknown>} */ (r);
        const duty = String(strVal(ro.GSTRATEDUTYHEAD) || "").toLowerCase();
        const rateStr = strVal(ro.GSTRATE) || strVal(ro.RATE) || strVal(ro.GSTPERCENT) || strVal(ro.TAXRATE);
        const n = Number(rateStr);
        if (Number.isFinite(n) && n >= 0 && n <= 100) rows.push({ duty, rate: n });
      }
    }

    const rateBlocksOnGst = [...normalizeList(g["RATEDETAILS.LIST"]), ...normalizeList(g.RATEDETAILS)];
    for (const r of rateBlocksOnGst) {
      if (!r || typeof r !== "object") continue;
      const ro = /** @type {Record<string, unknown>} */ (r);
      const duty = String(strVal(ro.GSTRATEDUTYHEAD) || "").toLowerCase();
      const rateStr = strVal(ro.GSTRATE) || strVal(ro.RATE) || strVal(ro.GSTPERCENT) || strVal(ro.TAXRATE);
      const n = Number(rateStr);
      if (Number.isFinite(n) && n >= 0 && n <= 100) rows.push({ duty, rate: n });
    }
  }

  if (!rows.length) return null;

  const integrated = rows.find((r) => r.duty.includes("integrated") || r.duty.includes("igst"));
  if (integrated) return integrated.rate;

  const cgstRates = rows.filter((r) => r.duty.includes("central") || r.duty.includes("cgst")).map((r) => r.rate);
  const sgstRates = rows.filter(
    (r) => r.duty.includes("state") || r.duty.includes("sgst") || r.duty.includes("utgst"),
  ).map((r) => r.rate);
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
  const duty = String(strVal(o.GSTRATEDUTYHEAD) || "").toLowerCase();
  const rateStr = strVal(o.GSTRATE) || strVal(o.RATE) || strVal(o.GSTPERCENT);
  if (rateStr && (duty.includes("integrated") || duty.includes("igst"))) {
    const n = Number(rateStr);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  }

  let fallback = null;
  for (const v of Object.values(o)) {
    const r = extractGstPercentDeep(v, depth + 1);
    if (r != null) {
      if (fallback == null) fallback = r;
    }
  }
  if (fallback != null) return fallback;

  const direct = strVal(o.GSTRATE) || strVal(o.RATE) || strVal(o.GSTPERCENT);
  if (direct) {
    const n = Number(direct);
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
 * Collapse whitespace; lowercase for matching.
 * @param {string} raw
 */
function normalizeMatchText(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Phrases (with space): substring on normalized haystack.
 * Single token: word-boundary match to avoid false positives (e.g. `rm` in `farm`).
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
 * RM vs FG from stock group / category strings. Longer keyword wins; tie → RM.
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
 * Typical export: `<STOCKITEM><PARENT>Raw Material</PARENT>...</STOCKITEM>`.
 * @param {Record<string, unknown>} s
 * @returns {{ tallyStockGroup: string | null; classificationHaystack: string }}
 */
function extractStockGroupContext(s) {
  /** @type {string[]} */
  const parts = [];
  const add = (v) => {
    const t = strVal(v).trim();
    if (!t) return;
    if (!parts.some((p) => p.toLowerCase() === t.toLowerCase())) parts.push(t);
  };

  add(s.PARENT);
  add(s.CATEGORY);
  add(s.STOCKCATEGORY);
  add(s.STOCKTYPE);
  add(s["STOCKGROUP.NAME"]);
  add(s["CATEGORYNAME"]);

  const sg = s.STOCKGROUP;
  if (sg && typeof sg === "object") {
    const o = /** @type {Record<string, unknown>} */ (sg);
    add(o.NAME);
    add(o.ORIGINALNAME);
  }

  for (const b of normalizeList(s["STOCKGROUP.LIST"])) {
    if (!b || typeof b !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (b);
    add(o.NAME);
    add(o.ORIGINALNAME);
  }

  const tallyStockGroup = parts.length ? parts.join(" · ") : null;
  const classificationHaystack = normalizeMatchText(parts.join(" "));
  return { tallyStockGroup, classificationHaystack };
}

/**
 * @param {unknown} stockRaw
 * @param {{ rmKeywords?: string[]; fgKeywords?: string[] }} [keywordOpts]
 * @returns {null | {
 *   tallyName: string;
 *   itemName: string;
 *   baseUnit: string;
 *   hsnCode: string | null;
 *   gstRate: number | null;
 *   tallyStockGroup: string | null;
 *   autoDetectedItemType: "RM" | "FG" | null;
 * }}
 */
function mapStockItemToItem(stockRaw, keywordOpts = {}) {
  if (!stockRaw || typeof stockRaw !== "object") return null;
  const s = /** @type {Record<string, unknown>} */ (stockRaw);
  const fromAttr = s["@_NAME"] != null ? String(s["@_NAME"]).trim() : "";
  const name = strVal(s.NAME) || fromAttr;
  if (!name) return null;

  const baseUnit =
    strVal(s.BASEUNITS) ||
    strVal(s.ADDITIONALUNITS) ||
    strVal(s.UNIT) ||
    strVal(s.UOM) ||
    strVal(s.SIMPLEUNIT) ||
    "";

  const hsnCodeRaw =
    strVal(s.HSNCODE) || strVal(s.HSNSAC) || strVal(s.HSN) || strVal(s.SACCODE) || extractHsnDeep(s) || null;
  const gstRate = extractGstPercentFromGstBlocks(s) ?? extractGstPercentDeep(s);

  const { tallyStockGroup, classificationHaystack } = extractStockGroupContext(s);
  const autoDetectedItemType = classificationHaystack
    ? classifyItemTypeFromStockGroupHaystack(classificationHaystack, keywordOpts)
    : null;

  return {
    tallyName: name,
    itemName: name,
    baseUnit: baseUnit || "",
    hsnCode: hsnCodeRaw,
    gstRate: gstRate != null && Number.isFinite(gstRate) ? gstRate : null,
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
  const fromAttr = u["@_NAME"] != null ? String(u["@_NAME"]).trim() : "";
  const unitName = strVal(u.NAME) || strVal(u.ORIGINALNAME) || fromAttr;
  if (!unitName) return null;
  const unitCode = strVal(u.SYMBOL) || null;
  return {
    tallyName: unitName,
    unitName,
    unitCode: unitCode || null,
  };
}

module.exports = {
  mapStockItemToItem,
  mapTallyUnitMaster,
  extractGstPercentDeep,
  extractHsnDeep,
  extractGstPercentFromGstBlocks,
  classifyItemTypeFromStockGroupHaystack,
  extractStockGroupContext,
  DEFAULT_ITEM_TYPE_FG_KEYWORDS,
  DEFAULT_ITEM_TYPE_RM_KEYWORDS,
};
