const { XMLParser } = require("fast-xml-parser");

const VOUCHER_TAG = "VOUCHER";

/**
 * Path segments (normalized local tag UPPERCASE) under which we skip the entire subtree
 * (vouchers / voucher lines / voucher-style allocations). Do NOT use substring "VOUCHER"
 * — tags like VOUCHERCONFIG would false-positive and skip legitimate sibling trees on some exports.
 */
const IGNORE_SUBTREE_SEGMENTS = new Set([
  VOUCHER_TAG,
  "VOUCHERS",
  "BANKALLOCATIONS",
  "BILLALLOCATIONS",
  "INVENTORYALLOCATIONS",
  "ALLINVENTORYENTRIES",
  "ALLLEDGERENTRIES",
  "LEDGERENTRIES",
  "CATEGORYENTRY",
  "PAYMENT",
  "RECEIPT",
  "CONTRA",
  "JOURNAL",
  "DEBITNOTE",
  "CREDITNOTE",
]);

/**
 * Decode Tally-exported file: UTF-8 (with optional BOM) or UTF-16 LE/BE (with BOM).
 * Wrong decoding yields a parsed tree with no LEDGER/STOCKITEM keys — preview shows all zeros.
 *
 * @param {Buffer} buf
 * @returns {string}
 */
function decodeXmlFromBuffer(buf) {
  if (!buf || buf.length === 0) return "";
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString("utf16le");
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const pairs = Math.floor((buf.length - 2) / 2);
    const out = Buffer.allocUnsafe(pairs * 2);
    for (let i = 0; i < pairs; i += 1) {
      out[i * 2] = buf[2 + i * 2 + 1];
      out[i * 2 + 1] = buf[2 + i * 2];
    }
    return out.toString("utf16le");
  }
  let s = buf.toString("utf8");
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

/**
 * Strip XML namespace prefix from parser keys (e.g. `n0:LEDGER` → `LEDGER`).
 * @param {string} key
 * @returns {string | null} UPPERCASE local name, or null for attributes
 */
function xmlLocalTagNameUpper(key) {
  if (typeof key !== "string" || key.startsWith("@_")) return null;
  const base = key.includes(":") ? key.slice(key.lastIndexOf(":") + 1) : key;
  return base.toUpperCase();
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function strVal(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v).trim();
  if (typeof v === "object") {
    if (Object.prototype.hasOwnProperty.call(v, "#text")) return String(v["#text"]).trim();
    if (Object.prototype.hasOwnProperty.call(v, "text")) return String(v.text).trim();
  }
  return "";
}

/**
 * @param {string} xmlStr
 * @returns {boolean}
 */
function xmlLooksLikeContainsVoucher(xmlStr) {
  const s = String(xmlStr || "");
  return (
    /<VOUCHER\b/i.test(s) ||
    /<VOUCHERNUMBER\b/i.test(s) ||
    /<VOUCHERTYPE\b/i.test(s) ||
    /<ALLLEDGERENTRIES/i.test(s) ||
    /<ALLINVENTORYENTRIES/i.test(s)
  );
}

/**
 * Best-effort counts from raw text (encoding-independent tag names).
 * @param {string} xmlStr
 */
function countRawMasterTags(xmlStr) {
  const s = String(xmlStr || "");
  const count = (re) => (s.match(re) || []).length;
  return {
    tallyMessageOpen: count(/<TALLYMESSAGE\b/gi),
    ledgerOpen: count(/<LEDGER\b/gi),
    stockItemOpen: count(/<STOCKITEM\b/gi),
    unitOpen: count(/<UNIT\b/gi),
  };
}

/**
 * @param {unknown} node
 * @param {string[]} pathSegUpper path of **local** tag names (uppercase)
 * @param {{ ledgers: unknown[]; stockItems: unknown[]; units: unknown[]; tallyMessageSeen: number }} acc
 */
function walkCollectMasters(node, pathSegUpper, acc) {
  if (node == null) return;
  const blocked = pathSegUpper.some((p) => IGNORE_SUBTREE_SEGMENTS.has(p));
  if (blocked) return;

  if (Array.isArray(node)) {
    for (const child of node) walkCollectMasters(child, pathSegUpper, acc);
    return;
  }
  if (typeof node !== "object") return;

  for (const [key, val] of Object.entries(node)) {
    const localUpper = xmlLocalTagNameUpper(key);
    if (localUpper == null) continue;
    const nextPath = [...pathSegUpper, localUpper];

    if (localUpper === "TALLYMESSAGE") acc.tallyMessageSeen += 1;

    const subBlocked = nextPath.some((p) => IGNORE_SUBTREE_SEGMENTS.has(p));
    if (!subBlocked && localUpper === "LEDGER") {
      const arr = Array.isArray(val) ? val : [val];
      for (const L of arr) if (L && typeof L === "object") acc.ledgers.push(L);
    } else if (!subBlocked && localUpper === "STOCKITEM") {
      const arr = Array.isArray(val) ? val : [val];
      for (const S of arr) if (S && typeof S === "object") acc.stockItems.push(S);
    } else if (!subBlocked && localUpper === "UNIT") {
      const arr = Array.isArray(val) ? val : [val];
      for (const U of arr) if (U && typeof U === "object") acc.units.push(U);
    }

    walkCollectMasters(val, nextPath, acc);
  }
}

/**
 * @param {string} xmlString
 * @returns {{
 *   ok: true;
 *   ledgers: unknown[];
 *   stockItems: unknown[];
 *   units: unknown[];
 *   warnings: string[];
 *   parseStats: {
 *     tallyMessageOpenInRaw: number;
 *     ledgerOpenInRaw: number;
 *     stockItemOpenInRaw: number;
 *     unitOpenInRaw: number;
 *     ledgersParsed: number;
 *     stockItemsParsed: number;
 *     unitsParsed: number;
 *     tallyMessageSeen: number;
 *   };
 * } | { ok: false; error: string }}
 */
function parseTallyMastersXml(xmlString) {
  const warnings = [];
  if (xmlLooksLikeContainsVoucher(xmlString)) {
    warnings.push("Voucher data ignored. Only masters are imported.");
  }

  const rawCounts = countRawMasterTags(xmlString);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    removeNSPrefix: true,
  });

  let parsed;
  try {
    parsed = parser.parse(xmlString);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid XML." };
  }

  const acc = { ledgers: [], stockItems: [], units: [], tallyMessageSeen: 0 };
  walkCollectMasters(parsed, [], acc);

  const parseStats = {
    tallyMessageOpenInRaw: rawCounts.tallyMessageOpen,
    ledgerOpenInRaw: rawCounts.ledgerOpen,
    stockItemOpenInRaw: rawCounts.stockItemOpen,
    unitOpenInRaw: rawCounts.unitOpen,
    ledgersParsed: acc.ledgers.length,
    stockItemsParsed: acc.stockItems.length,
    unitsParsed: acc.units.length,
    tallyMessageSeen: acc.tallyMessageSeen,
  };

  if (process.env.TALLY_IMPORT_DEBUG === "1") {
    // eslint-disable-next-line no-console
    console.info("[tally-import][parse]", parseStats);
  }

  if (
    acc.ledgers.length + acc.stockItems.length + acc.units.length === 0 &&
    (rawCounts.ledgerOpen > 0 || rawCounts.stockItemOpen > 0 || rawCounts.unitOpen > 0)
  ) {
    warnings.push(
      "The XML file contains LEDGER/STOCKITEM/UNIT tags in the raw text, but none were extracted into the import model. Try re-exporting UTF-8 XML from Tally, or contact support with a sample file.",
    );
  }

  return {
    ok: true,
    ledgers: acc.ledgers,
    stockItems: acc.stockItems,
    units: acc.units,
    warnings,
    parseStats,
  };
}

module.exports = {
  parseTallyMastersXml,
  decodeXmlFromBuffer,
  strVal,
  xmlLooksLikeContainsVoucher,
  countRawMasterTags,
  xmlLocalTagNameUpper,
};
