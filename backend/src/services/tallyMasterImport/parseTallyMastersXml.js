const { XMLParser } = require("fast-xml-parser");
const { strVal, xmlLocalTagNameUpper, walkCollectTaggedMasters } = require("./tallyXmlListHelpers");

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

/** Master entity tags collected by the canonical walker (import apply may use a subset). */
const MASTER_COLLECT_TAGS = new Set([
  "LEDGER",
  "STOCKITEM",
  "UNIT",
  "STOCKGROUP",
  "GODOWN",
  "VOUCHERTYPE",
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
    stockGroupOpen: count(/<STOCKGROUP\b/gi),
    godownOpen: count(/<GODOWN\b/gi),
    voucherTypeOpen: count(/<VOUCHERTYPE\b/gi),
  };
}

/**
 * @param {string[]} pathSegUpper
 */
function isPathBlocked(pathSegUpper) {
  return pathSegUpper.some((p) => IGNORE_SUBTREE_SEGMENTS.has(p));
}

/**
 * @param {string} xmlString
 * @returns {{
 *   ok: true;
 *   ledgers: unknown[];
 *   stockItems: unknown[];
 *   units: unknown[];
 *   stockGroups: unknown[];
 *   godowns: unknown[];
 *   voucherTypes: unknown[];
 *   warnings: string[];
 *   parseStats: Record<string, number>;
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

  /** @type {{ ledgers: unknown[]; stockItems: unknown[]; units: unknown[]; stockGroups: unknown[]; godowns: unknown[]; voucherTypes: unknown[]; tallyMessageSeen: number }} */
  const acc = {
    ledgers: [],
    stockItems: [],
    units: [],
    stockGroups: [],
    godowns: [],
    voucherTypes: [],
    tallyMessageSeen: 0,
  };

  walkCollectTaggedMasters(
    parsed,
    MASTER_COLLECT_TAGS,
    (tag, obj) => {
      if (tag === "LEDGER") acc.ledgers.push(obj);
      else if (tag === "STOCKITEM") acc.stockItems.push(obj);
      else if (tag === "UNIT") acc.units.push(obj);
      else if (tag === "STOCKGROUP") acc.stockGroups.push(obj);
      else if (tag === "GODOWN") acc.godowns.push(obj);
      else if (tag === "VOUCHERTYPE") acc.voucherTypes.push(obj);
    },
    {
      isPathBlocked,
      onTag: (tag) => {
        if (tag === "TALLYMESSAGE") acc.tallyMessageSeen += 1;
      },
    },
  );

  const parseStats = {
    tallyMessageOpenInRaw: rawCounts.tallyMessageOpen,
    ledgerOpenInRaw: rawCounts.ledgerOpen,
    stockItemOpenInRaw: rawCounts.stockItemOpen,
    unitOpenInRaw: rawCounts.unitOpen,
    stockGroupOpenInRaw: rawCounts.stockGroupOpen,
    godownOpenInRaw: rawCounts.godownOpen,
    voucherTypeOpenInRaw: rawCounts.voucherTypeOpen,
    ledgersParsed: acc.ledgers.length,
    stockItemsParsed: acc.stockItems.length,
    unitsParsed: acc.units.length,
    stockGroupsParsed: acc.stockGroups.length,
    godownsParsed: acc.godowns.length,
    voucherTypesParsed: acc.voucherTypes.length,
    tallyMessageSeen: acc.tallyMessageSeen,
  };

  if (process.env.TALLY_IMPORT_DEBUG === "1") {
    // eslint-disable-next-line no-console
    console.info("[tally-import][parse]", parseStats);
  }

  if (
    acc.ledgers.length +
      acc.stockItems.length +
      acc.units.length +
      acc.stockGroups.length +
      acc.godowns.length +
      acc.voucherTypes.length ===
      0 &&
    (rawCounts.ledgerOpen > 0 ||
      rawCounts.stockItemOpen > 0 ||
      rawCounts.unitOpen > 0 ||
      rawCounts.stockGroupOpen > 0 ||
      rawCounts.godownOpen > 0 ||
      rawCounts.voucherTypeOpen > 0)
  ) {
    warnings.push(
      "The XML file contains master tags in the raw text, but none were extracted into the import model. Try re-exporting UTF-8 XML from Tally, or contact support with a sample file.",
    );
  }

  return {
    ok: true,
    ledgers: acc.ledgers,
    stockItems: acc.stockItems,
    units: acc.units,
    stockGroups: acc.stockGroups,
    godowns: acc.godowns,
    voucherTypes: acc.voucherTypes,
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
  MASTER_COLLECT_TAGS,
  IGNORE_SUBTREE_SEGMENTS,
};
