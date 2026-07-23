/**
 * Streaming / fragment-based Tally master extraction.
 * Avoids building a full DOM for large STOCKITEM exports (~64 MB UTF-16).
 */

const { XMLParser } = require("fast-xml-parser");

/**
 * Case-insensitive match: xml[pos] is '<' and following chars equal tagUpper (ASCII).
 * @param {string} xml
 * @param {number} pos
 * @param {string} tagUpper
 */
function matchOpenTagName(xml, pos, tagUpper) {
  if (xml.charCodeAt(pos) !== 60 /* < */) return false;
  const n = tagUpper.length;
  if (pos + 1 + n > xml.length) return false;
  for (let c = 0; c < n; c += 1) {
    const ch = xml.charCodeAt(pos + 1 + c);
    const want = tagUpper.charCodeAt(c);
    // ASCII case fold
    if (ch !== want && ch !== want + 32) return false;
  }
  const after = xml.charCodeAt(pos + 1 + n);
  // whitespace, >, or /
  return after === 32 || after === 9 || after === 10 || after === 13 || after === 62 || after === 47;
}

/**
 * @param {string} xml
 * @param {number} pos  index of '<'
 * @param {string} tagUpper
 */
function matchCloseTagName(xml, pos, tagUpper) {
  if (xml.charCodeAt(pos) !== 60 || xml.charCodeAt(pos + 1) !== 47 /* / */) return false;
  const n = tagUpper.length;
  if (pos + 2 + n > xml.length) return false;
  for (let c = 0; c < n; c += 1) {
    const ch = xml.charCodeAt(pos + 2 + c);
    const want = tagUpper.charCodeAt(c);
    if (ch !== want && ch !== want + 32) return false;
  }
  const after = xml.charCodeAt(pos + 2 + n);
  return after === 62 || after === 32 || after === 9 || after === 10 || after === 13;
}

/**
 * Extract contiguous outer XML fragments for a master tag (depth-aware).
 * @param {string} xml
 * @param {string} tagUpper e.g. "STOCKITEM"
 * @param {{ onFragment?: (count: number) => void; progressEvery?: number }} [opts]
 * @returns {string[]}
 */
function extractMasterFragments(xml, tagUpper, opts = {}) {
  const out = [];
  const n = xml.length;
  const progressEvery = opts.progressEvery || 0;
  const onFragment = typeof opts.onFragment === "function" ? opts.onFragment : null;
  let i = 0;

  while (i < n) {
    let start = -1;
    for (let p = i; p < n; p += 1) {
      if (matchOpenTagName(xml, p, tagUpper)) {
        start = p;
        break;
      }
    }
    if (start < 0) break;

    const gt = xml.indexOf(">", start);
    if (gt < 0) break;
    // self-closing
    if (xml.charCodeAt(gt - 1) === 47) {
      i = gt + 1;
      continue;
    }

    let depth = 1;
    let pos = gt + 1;
    let closed = false;
    while (pos < n && depth > 0) {
      const lt = xml.indexOf("<", pos);
      if (lt < 0) break;
      const next = xml.charCodeAt(lt + 1);
      if (next === 47) {
        if (matchCloseTagName(xml, lt, tagUpper)) {
          depth -= 1;
          if (depth === 0) {
            const closeEnd = xml.indexOf(">", lt);
            if (closeEnd < 0) break;
            out.push(xml.slice(start, closeEnd + 1));
            i = closeEnd + 1;
            closed = true;
            if (onFragment && progressEvery > 0 && out.length % progressEvery === 0) {
              onFragment(out.length);
            }
            break;
          }
          const closeEnd = xml.indexOf(">", lt);
          pos = closeEnd < 0 ? n : closeEnd + 1;
          continue;
        }
      } else if (next !== 33 /* ! */ && next !== 63 /* ? */) {
        if (matchOpenTagName(xml, lt, tagUpper)) {
          const endOpen = xml.indexOf(">", lt);
          if (endOpen < 0) break;
          if (xml.charCodeAt(endOpen - 1) !== 47) depth += 1;
          pos = endOpen + 1;
          continue;
        }
      }
      pos = lt + 1;
    }
    if (!closed) break;
  }
  return out;
}

function createFragmentParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    removeNSPrefix: true,
  });
}

/**
 * Parse a single master fragment into the element object (attributes + children).
 * @param {import("fast-xml-parser").XMLParser} parser
 * @param {string} fragment
 * @param {string} tagUpper
 */
function parseMasterFragment(parser, fragment, tagUpper) {
  try {
    const tree = parser.parse(fragment);
    if (!tree || typeof tree !== "object") return null;
    for (const [k, v] of Object.entries(tree)) {
      if (String(k).toUpperCase() === tagUpper) {
        if (Array.isArray(v)) return v[0] && typeof v[0] === "object" ? v[0] : null;
        return v && typeof v === "object" ? v : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * @param {string} xml
 * @param {string} tagUpper
 * @param {{
 *   onProgress?: (p: { tag: string; processed: number; total: number }) => void;
 *   progressEvery?: number;
 *   expectedTotal?: number;
 * }} [opts]
 * @returns {Record<string, unknown>[]}
 */
function extractAndParseMasters(xml, tagUpper, opts = {}) {
  const progressEvery = opts.progressEvery ?? 50;
  const expectedTotal = opts.expectedTotal ?? 0;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const frags = extractMasterFragments(xml, tagUpper);
  const total = expectedTotal > 0 ? expectedTotal : frags.length;
  const parser = createFragmentParser();
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (let i = 0; i < frags.length; i += 1) {
    const node = parseMasterFragment(parser, frags[i], tagUpper);
    if (node) out.push(/** @type {Record<string, unknown>} */ (node));
    if (onProgress && progressEvery > 0 && ((i + 1) % progressEvery === 0 || i + 1 === frags.length)) {
      onProgress({ tag: tagUpper, processed: i + 1, total: total || frags.length });
    }
  }
  return out;
}

/**
 * Prefer streaming extraction when tagged masters exist.
 * Custom flat CA* reports (no LEDGER/STOCKITEM) still need full DOM.
 *
 * @param {{ stockItemOpen?: number; ledgerOpen?: number; unitOpen?: number; stockGroupOpen?: number; caAcctTypeNameOpen?: number; byteLength?: number }} counts
 */
function shouldUseStreamingMasterExtract(counts) {
  const stock = counts.stockItemOpen || 0;
  const ledger = counts.ledgerOpen || 0;
  const unit = counts.unitOpen || 0;
  const group = counts.stockGroupOpen || 0;
  const ca = counts.caAcctTypeNameOpen || 0;
  if (stock + ledger + unit + group === 0 && ca > 0) return false;
  if (stock + ledger + unit + group > 0) return true;
  return false;
}

module.exports = {
  extractMasterFragments,
  extractAndParseMasters,
  parseMasterFragment,
  createFragmentParser,
  shouldUseStreamingMasterExtract,
  matchOpenTagName,
  matchCloseTagName,
};
