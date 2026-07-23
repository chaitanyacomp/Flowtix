const { XMLParser } = require("fast-xml-parser");
const {
  strVal,
  xmlLocalTagNameUpper,
  walkCollectTaggedMasters,
  getByLocalTag,
} = require("./tallyXmlListHelpers");
const {
  decodeXmlFromBuffer,
  sanitizeInvalidXml10CharRefs,
  assertCompleteTallyXmlEnvelope,
  prepareTallyMasterXmlFromBuffer,
  TRUNCATED_XML_MESSAGE,
} = require("./tallyXmlDecode");
const {
  extractAndParseMasters,
  shouldUseStreamingMasterExtract,
} = require("./tallyStreamingMasterExtract");

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

/** Marker on synthetic ledger objects built from custom CA* flat report exports. */
const CUSTOM_FLAT_CA_SOURCE = "CUSTOM_FLAT_CA_LEDGER";

/**
 * @param {unknown} v
 * @returns {string[]}
 */
function asParallelTagValues(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => strVal(x));
  return [strVal(v)];
}

/**
 * Empty CALEDGEROPBAL → "0" (do not reject the party).
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeCustomFlatOpeningBalance(raw) {
  const t = strVal(raw).replace(/,/g, "").trim();
  if (!t) return "0";
  const n = Number(t);
  if (!Number.isFinite(n)) return "0";
  return String(n);
}

/**
 * Locate the object that holds parallel CAACCTYPENAME / CALEDGERPARENT arrays
 * (typically ENVELOPE itself for custom Tally report exports).
 *
 * @param {unknown} node
 * @param {number} [depth]
 * @returns {Record<string, unknown> | null}
 */
function findCustomFlatCaContainer(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 10) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findCustomFlatCaContainer(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const o = /** @type {Record<string, unknown>} */ (node);
  if (getByLocalTag(o, "CAACCTYPENAME") != null) return o;
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith("@_")) continue;
    const found = findCustomFlatCaContainer(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Custom Tally report export: consecutive ENVELOPE children
 * CALEDGERSLNO / CAACCTYPENAME / CALEDGERPARENT / CALEDGEROPBAL (not LEDGER masters).
 * Groups by index across parallel tag arrays (aligned with report row order).
 *
 * @param {unknown} parsedRoot
 * @returns {{
 *   ledgers: Record<string, unknown>[];
 *   stats: {
 *     customFlatRowsDetected: number;
 *     customFlatLedgersBuilt: number;
 *     customFlatInvalidRows: number;
 *   };
 * }}
 */
function extractCustomFlatCaLedgers(parsedRoot) {
  const empty = {
    ledgers: /** @type {Record<string, unknown>[]} */ ([]),
    stats: { customFlatRowsDetected: 0, customFlatLedgersBuilt: 0, customFlatInvalidRows: 0 },
  };
  const container = findCustomFlatCaContainer(parsedRoot);
  if (!container) return empty;

  const names = asParallelTagValues(getByLocalTag(container, "CAACCTYPENAME"));
  if (names.length === 0) return empty;

  const parents = asParallelTagValues(getByLocalTag(container, "CALEDGERPARENT"));
  const opbals = asParallelTagValues(getByLocalTag(container, "CALEDGEROPBAL"));
  const slnos = asParallelTagValues(getByLocalTag(container, "CALEDGERSLNO"));

  /** @type {Record<string, unknown>[]} */
  const ledgers = [];
  let invalidRows = 0;

  for (let i = 0; i < names.length; i += 1) {
    const name = String(names[i] || "").trim();
    const parent = String(parents[i] || "").trim();
    const slno = String(slnos[i] || "").trim() || String(i + 1);
    const openingBalance = normalizeCustomFlatOpeningBalance(opbals[i]);

    if (!name) {
      invalidRows += 1;
      continue;
    }

    ledgers.push({
      "@_NAME": name,
      NAME: name,
      PARENT: parent,
      OPENINGBALANCE: openingBalance,
      CALEDGERSLNO: slno,
      CAACCTYPENAME: name,
      CALEDGERPARENT: parent,
      CALEDGEROPBAL: openingBalance,
      _tallySourceFormat: CUSTOM_FLAT_CA_SOURCE,
      _sourceSerial: slno,
    });
  }

  return {
    ledgers,
    stats: {
      customFlatRowsDetected: names.length,
      customFlatLedgersBuilt: ledgers.length,
      customFlatInvalidRows: invalidRows,
    },
  };
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
    caAcctTypeNameOpen: count(/<CAACCTYPENAME\b/gi),
    caLedgerParentOpen: count(/<CALEDGERPARENT\b/gi),
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
 * @param {{ encoding?: string; sanitizedInvalidRefCount?: number; byteLength?: number } | null} [decodeMeta]
 * @param {{ onProgress?: (p: Record<string, unknown>) => void } | null} [progressOpts]
 * @returns {{
 *   ok: true;
 *   ledgers: unknown[];
 *   stockItems: unknown[];
 *   units: unknown[];
 *   stockGroups: unknown[];
 *   godowns: unknown[];
 *   voucherTypes: unknown[];
 *   warnings: string[];
 *   parseStats: Record<string, number | string | boolean | null>;
 * } | { ok: false; error: string }}
 */
function parseTallyMastersXml(xmlString, decodeMeta = null, progressOpts = null) {
  const onProgress = progressOpts && typeof progressOpts.onProgress === "function" ? progressOpts.onProgress : null;
  const warnings = [];
  const complete = assertCompleteTallyXmlEnvelope(xmlString);
  if (!complete.ok) {
    return { ok: false, error: complete.error || TRUNCATED_XML_MESSAGE };
  }

  const priorSanitize =
    decodeMeta && typeof decodeMeta.sanitizedInvalidRefCount === "number"
      ? decodeMeta.sanitizedInvalidRefCount
      : null;
  const sanitized =
    priorSanitize != null
      ? { text: String(xmlString || ""), sanitizedInvalidRefCount: priorSanitize }
      : sanitizeInvalidXml10CharRefs(xmlString);
  const xmlForParse = sanitized.text;

  if (xmlLooksLikeContainsVoucher(xmlForParse)) {
    warnings.push("Voucher data ignored. Only masters are imported.");
  }
  if (sanitized.sanitizedInvalidRefCount > 0) {
    warnings.push(
      `Removed ${sanitized.sanitizedInvalidRefCount.toLocaleString("en-IN")} invalid XML 1.0 character reference(s) (e.g. &#4;) before parsing.`,
    );
  }

  const rawCounts = countRawMasterTags(xmlForParse);
  onProgress?.({
    phase: "analysing",
    percent: 42,
    message: "Counted master tags in XML…",
    recordsDetected: rawCounts.stockItemOpen || null,
    sanitizedInvalidRefCount: sanitized.sanitizedInvalidRefCount,
  });

  const useStreaming = shouldUseStreamingMasterExtract({
    ...rawCounts,
    byteLength: decodeMeta?.byteLength ?? xmlForParse.length,
  });

  /** @type {{ ledgers: unknown[]; stockItems: unknown[]; units: unknown[]; stockGroups: unknown[]; godowns: unknown[]; voucherTypes: unknown[]; tallyMessageSeen: number }} */
  const acc = {
    ledgers: [],
    stockItems: [],
    units: [],
    stockGroups: [],
    godowns: [],
    voucherTypes: [],
    tallyMessageSeen: rawCounts.tallyMessageOpen || 0,
  };

  /** @type {"streaming" | "dom"} */
  let parseMode = "dom";

  if (useStreaming) {
    parseMode = "streaming";
    const stockExpected = rawCounts.stockItemOpen || 0;
    acc.stockGroups = extractAndParseMasters(xmlForParse, "STOCKGROUP", {
      expectedTotal: rawCounts.stockGroupOpen || 0,
      progressEvery: 10,
      onProgress: (p) =>
        onProgress?.({
          phase: "analysing",
          percent: 45,
          message: `Parsing stock groups… ${p.processed}/${p.total}`,
          recordsDetected: stockExpected || null,
        }),
    });
    acc.units = extractAndParseMasters(xmlForParse, "UNIT", {
      expectedTotal: rawCounts.unitOpen || 0,
      progressEvery: 10,
      onProgress: (p) =>
        onProgress?.({
          phase: "analysing",
          percent: 48,
          message: `Parsing units… ${p.processed}/${p.total}`,
          recordsDetected: stockExpected || null,
        }),
    });
    acc.godowns = extractAndParseMasters(xmlForParse, "GODOWN", {
      expectedTotal: rawCounts.godownOpen || 0,
      progressEvery: 25,
    });
    acc.voucherTypes = extractAndParseMasters(xmlForParse, "VOUCHERTYPE", {
      expectedTotal: rawCounts.voucherTypeOpen || 0,
      progressEvery: 25,
    });
    acc.ledgers = extractAndParseMasters(xmlForParse, "LEDGER", {
      expectedTotal: rawCounts.ledgerOpen || 0,
      progressEvery: 50,
      onProgress: (p) =>
        onProgress?.({
          phase: "analysing",
          percent: 50,
          message: `Parsing ledgers… ${p.processed}/${p.total}`,
          recordsDetected: stockExpected || null,
          recordsProcessed: p.processed,
        }),
    });
    acc.stockItems = extractAndParseMasters(xmlForParse, "STOCKITEM", {
      expectedTotal: stockExpected,
      progressEvery: 50,
      onProgress: (p) => {
        const pct =
          p.total > 0 ? Math.min(84, Math.round(52 + (p.processed / p.total) * 32)) : 55;
        onProgress?.({
          phase: "analysing",
          percent: pct,
          message: `Processed ${p.processed.toLocaleString("en-IN")} of ${p.total.toLocaleString("en-IN")} stock items`,
          recordsDetected: p.total,
          recordsProcessed: p.processed,
          stockItemsProcessed: p.processed,
          stockItemsTotal: p.total,
        });
      },
    });
  } else {
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
      onProgress?.({
        phase: "analysing",
        percent: 50,
        message: "Parsing Tally XML (DOM)…",
        recordsDetected: rawCounts.stockItemOpen || null,
      });
      parsed = parser.parse(xmlForParse);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid XML.";
      if (/unclosed|unexpected end|incomplete|premature/i.test(msg)) {
        return { ok: false, error: TRUNCATED_XML_MESSAGE };
      }
      return { ok: false, error: msg };
    }

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

    // Custom flat CA* report export (no LEDGER nodes) — synthesize LEDGER-shaped objects.
    const customFlat = extractCustomFlatCaLedgers(parsed);
    if (customFlat.ledgers.length > 0) {
      acc.ledgers.push(...customFlat.ledgers);
      warnings.push(
        `Detected custom Tally ledger report format (CAACCTYPENAME). Parsed ${customFlat.stats.customFlatLedgersBuilt} party row(s) from ${customFlat.stats.customFlatRowsDetected} report line(s).`,
      );
    }

    const parseStatsDom = {
      encoding: decodeMeta?.encoding || null,
      byteLength: decodeMeta?.byteLength ?? null,
      sanitizedInvalidRefCount: sanitized.sanitizedInvalidRefCount,
      parseMode,
      tallyMessageOpenInRaw: rawCounts.tallyMessageOpen,
      ledgerOpenInRaw: rawCounts.ledgerOpen,
      stockItemOpenInRaw: rawCounts.stockItemOpen,
      unitOpenInRaw: rawCounts.unitOpen,
      stockGroupOpenInRaw: rawCounts.stockGroupOpen,
      godownOpenInRaw: rawCounts.godownOpen,
      voucherTypeOpenInRaw: rawCounts.voucherTypeOpen,
      caAcctTypeNameOpenInRaw: rawCounts.caAcctTypeNameOpen,
      caLedgerParentOpenInRaw: rawCounts.caLedgerParentOpen,
      customFlatRowsDetected: customFlat.stats.customFlatRowsDetected,
      customFlatLedgersBuilt: customFlat.stats.customFlatLedgersBuilt,
      customFlatInvalidRows: customFlat.stats.customFlatInvalidRows,
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
      console.info("[tally-import][parse]", parseStatsDom);
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
        rawCounts.voucherTypeOpen > 0 ||
        rawCounts.caAcctTypeNameOpen > 0)
    ) {
      warnings.push(
        "The XML file contains master/report tags in the raw text, but none were extracted into the import model. Try re-exporting UTF-8 or UTF-16 XML from Tally, or contact support with a sample file.",
      );
    }

    onProgress?.({
      phase: "analysing",
      percent: 85,
      message: `Parsed ${acc.stockItems.length} stock item(s), ${acc.ledgers.length} ledger row(s)…`,
      recordsDetected: acc.stockItems.length || rawCounts.stockItemOpen || null,
      recordsProcessed: acc.stockItems.length,
    });

    return {
      ok: true,
      ledgers: acc.ledgers,
      stockItems: acc.stockItems,
      units: acc.units,
      stockGroups: acc.stockGroups,
      godowns: acc.godowns,
      voucherTypes: acc.voucherTypes,
      warnings,
      parseStats: parseStatsDom,
    };
  }

  // Streaming path: optional CA* fallback when no tagged ledgers but CA* present
  let customFlatStats = {
    customFlatRowsDetected: 0,
    customFlatLedgersBuilt: 0,
    customFlatInvalidRows: 0,
  };
  if (acc.ledgers.length === 0 && (rawCounts.caAcctTypeNameOpen || 0) > 0) {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: false,
      removeNSPrefix: true,
    });
    try {
      const parsed = parser.parse(xmlForParse);
      const customFlat = extractCustomFlatCaLedgers(parsed);
      if (customFlat.ledgers.length > 0) {
        acc.ledgers.push(...customFlat.ledgers);
        customFlatStats = customFlat.stats;
        warnings.push(
          `Detected custom Tally ledger report format (CAACCTYPENAME). Parsed ${customFlat.stats.customFlatLedgersBuilt} party row(s) from ${customFlat.stats.customFlatRowsDetected} report line(s).`,
        );
      }
    } catch {
      /* streaming already extracted tagged masters */
    }
  }

  const parseStats = {
    encoding: decodeMeta?.encoding || null,
    byteLength: decodeMeta?.byteLength ?? null,
    sanitizedInvalidRefCount: sanitized.sanitizedInvalidRefCount,
    parseMode,
    tallyMessageOpenInRaw: rawCounts.tallyMessageOpen,
    ledgerOpenInRaw: rawCounts.ledgerOpen,
    stockItemOpenInRaw: rawCounts.stockItemOpen,
    unitOpenInRaw: rawCounts.unitOpen,
    stockGroupOpenInRaw: rawCounts.stockGroupOpen,
    godownOpenInRaw: rawCounts.godownOpen,
    voucherTypeOpenInRaw: rawCounts.voucherTypeOpen,
    caAcctTypeNameOpenInRaw: rawCounts.caAcctTypeNameOpen,
    caLedgerParentOpenInRaw: rawCounts.caLedgerParentOpen,
    customFlatRowsDetected: customFlatStats.customFlatRowsDetected,
    customFlatLedgersBuilt: customFlatStats.customFlatLedgersBuilt,
    customFlatInvalidRows: customFlatStats.customFlatInvalidRows,
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
      rawCounts.voucherTypeOpen > 0 ||
      rawCounts.caAcctTypeNameOpen > 0)
  ) {
    warnings.push(
      "The XML file contains master/report tags in the raw text, but none were extracted into the import model. Try re-exporting UTF-8 or UTF-16 XML from Tally, or contact support with a sample file.",
    );
  }

  onProgress?.({
    phase: "analysing",
    percent: 85,
    message: `Parsed ${acc.stockItems.length} stock item(s), ${acc.ledgers.length} ledger row(s)…`,
    recordsDetected: acc.stockItems.length || rawCounts.stockItemOpen || null,
    recordsProcessed: acc.stockItems.length,
    stockItemsProcessed: acc.stockItems.length,
    stockItemsTotal: acc.stockItems.length,
  });

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
  prepareTallyMasterXmlFromBuffer,
  sanitizeInvalidXml10CharRefs,
  assertCompleteTallyXmlEnvelope,
  extractCustomFlatCaLedgers,
  normalizeCustomFlatOpeningBalance,
  strVal,
  xmlLooksLikeContainsVoucher,
  countRawMasterTags,
  xmlLocalTagNameUpper,
  MASTER_COLLECT_TAGS,
  IGNORE_SUBTREE_SEGMENTS,
  CUSTOM_FLAT_CA_SOURCE,
  TRUNCATED_XML_MESSAGE,
};
