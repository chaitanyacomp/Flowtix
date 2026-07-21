/**
 * Canonical Tally Prime XML list / tag helpers for **all** Flowtix Tally importers.
 * Works with fast-xml-parser output (removeNSPrefix: true, attributeNamePrefix: "@_").
 * Do not hardcode deep paths — resolve tags by local name (case-insensitive).
 *
 * SSOT: docs/product/05_Data_Architecture/Tally_Compatibility_Contract.md § Parser architecture
 */

/**
 * Strip Tally control characters / XML entity junk from display text.
 * Tally often embeds `\u0004` (shown as `&#4;`) before sentinel labels like "Not Applicable".
 *
 * @param {unknown} str
 * @returns {string}
 */
function normalizeTallyControlText(str) {
  if (str == null) return "";
  return String(str)
    .replace(/\u0004/g, "")
    .replace(/&#0*4;/gi, "")
    .replace(/&#x0*4;/gi, "")
    .replace(/&#x?[0-9a-f]+;/gi, (entity) => {
      const hex = /^&#x([0-9a-f]+);$/i.exec(entity);
      const n = hex ? parseInt(hex[1], 16) : Number(entity.slice(2, -1));
      if (!Number.isFinite(n)) return entity;
      // Drop C0 controls except TAB / LF / CR
      if (n >= 0 && n < 32 && n !== 9 && n !== 10 && n !== 13) return "";
      if (n === 127) return "";
      return entity;
    })
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function strVal(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return normalizeTallyControlText(String(v));
  }
  if (typeof v === "object") {
    if (Object.prototype.hasOwnProperty.call(v, "#text")) return normalizeTallyControlText(String(v["#text"]));
    if (Object.prototype.hasOwnProperty.call(v, "text")) return normalizeTallyControlText(String(v.text));
  }
  return "";
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
 * @returns {unknown[]}
 */
function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Find a property on an object by local tag name (ignores namespace prefixes / case).
 * Also accepts `TAG.LIST` when looking for `TAG` if only the LIST key exists (and vice versa).
 *
 * @param {unknown} obj
 * @param {string} tagName e.g. "STATE", "ADDRESS.LIST", "LEDMAILINGDETAILS"
 * @returns {unknown}
 */
function getByLocalTag(obj, tagName) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
  const want = String(tagName || "").toUpperCase();
  if (!want) return undefined;
  const o = /** @type {Record<string, unknown>} */ (obj);

  for (const [k, v] of Object.entries(o)) {
    const local = xmlLocalTagNameUpper(k);
    if (local === want) return v;
  }

  if (want.endsWith(".LIST")) {
    const base = want.slice(0, -".LIST".length);
    for (const [k, v] of Object.entries(o)) {
      const local = xmlLocalTagNameUpper(k);
      if (local === base) return v;
    }
  } else {
    const listWant = `${want}.LIST`;
    for (const [k, v] of Object.entries(o)) {
      const local = xmlLocalTagNameUpper(k);
      if (local === listWant) return v;
    }
  }
  return undefined;
}

/**
 * First non-empty string among candidate direct tags on a node.
 * @param {unknown} obj
 * @param {string[]} tagNames
 * @returns {string}
 */
function firstDirectText(obj, tagNames) {
  for (const tag of tagNames) {
    const t = strVal(getByLocalTag(obj, tag));
    if (t) return t;
  }
  return "";
}

/**
 * Normalize a Tally `*.LIST` node into content blocks.
 * Supports wrapped items, flat LIST bodies, and repeated LIST siblings (arrays).
 *
 * @param {unknown} parent
 * @param {string} listBaseName e.g. "LEDMAILINGDETAILS" or "GSTDETAILS"
 * @returns {Record<string, unknown>[]}
 */
function getListBlocks(parent, listBaseName) {
  const base = String(listBaseName || "")
    .toUpperCase()
    .replace(/\.LIST$/i, "");
  if (!base) return [];

  const listNode = getByLocalTag(parent, `${base}.LIST`) ?? getByLocalTag(parent, base);
  if (listNode == null) return [];

  const out = [];
  for (const entry of asArray(listNode)) {
    if (entry == null) continue;
    if (typeof entry !== "object") continue;
    const nested = getByLocalTag(entry, base);
    if (nested != null) {
      for (const item of asArray(nested)) {
        if (item && typeof item === "object") out.push(/** @type {Record<string, unknown>} */ (item));
      }
      continue;
    }
    out.push(/** @type {Record<string, unknown>} */ (entry));
  }
  return out;
}

/**
 * @param {unknown} node
 * @param {string} tagName
 * @returns {string[]}
 */
function collectDirectTexts(node, tagName) {
  const raw = getByLocalTag(node, tagName);
  if (raw == null) return [];
  return asArray(raw)
    .map((x) => strVal(x))
    .filter(Boolean);
}

/**
 * @param {unknown} block
 * @returns {string}
 */
function joinAddressList(block) {
  if (block == null) return "";
  const lines = [];

  const addrList = getByLocalTag(block, "ADDRESS.LIST");
  if (addrList != null) {
    for (const entry of asArray(addrList)) {
      if (entry == null) continue;
      if (typeof entry !== "object") {
        const t = strVal(entry);
        if (t) lines.push(t);
        continue;
      }
      const nested = getByLocalTag(entry, "ADDRESS");
      if (nested != null) {
        for (const a of asArray(nested)) {
          const t = strVal(a);
          if (t) lines.push(t);
        }
      } else {
        const t = strVal(entry);
        if (t) lines.push(t);
      }
    }
  } else {
    for (const t of collectDirectTexts(block, "ADDRESS")) lines.push(t);
  }

  return lines.join("\n").trim();
}

/**
 * @param {unknown} root
 * @param {string[]} tagNames
 * @param {number} [maxDepth]
 * @returns {string}
 */
function findFirstTextByTags(root, tagNames, maxDepth = 16) {
  const wants = new Set(tagNames.map((t) => String(t || "").toUpperCase()).filter(Boolean));
  if (!wants.size) return "";

  /** @param {unknown} node @param {number} depth */
  function walk(node, depth) {
    if (depth > maxDepth || node == null) return "";
    if (Array.isArray(node)) {
      for (const el of node) {
        const t = walk(el, depth + 1);
        if (t) return t;
      }
      return "";
    }
    if (typeof node !== "object") return "";
    const o = /** @type {Record<string, unknown>} */ (node);
    for (const [k, v] of Object.entries(o)) {
      const local = xmlLocalTagNameUpper(k);
      if (local == null) continue;
      if (wants.has(local)) {
        const t = strVal(v);
        if (t) return t;
      }
    }
    for (const [k, v] of Object.entries(o)) {
      if (xmlLocalTagNameUpper(k) == null) continue;
      if (v && typeof v === "object") {
        const t = walk(v, depth + 1);
        if (t) return t;
      }
    }
    return "";
  }

  return walk(root, 0);
}

/**
 * @param {unknown} root
 * @param {string[]} tagNames
 * @param {{ min?: number; max?: number; maxDepth?: number }} [opts]
 * @returns {number | null}
 */
function findFirstNumberByTags(root, tagNames, opts = {}) {
  const min = opts.min != null ? opts.min : Number.NEGATIVE_INFINITY;
  const max = opts.max != null ? opts.max : Number.POSITIVE_INFINITY;
  const maxDepth = opts.maxDepth != null ? opts.maxDepth : 20;
  const text = findFirstTextByTags(root, tagNames, maxDepth);
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/**
 * @param {unknown} node
 * @returns {string}
 */
function masterDisplayName(node) {
  if (!node || typeof node !== "object") return "";
  const o = /** @type {Record<string, unknown>} */ (node);
  const fromAttr = o["@_NAME"] != null ? normalizeTallyControlText(String(o["@_NAME"])) : "";
  return firstDirectText(o, ["NAME", "ORIGINALNAME"]) || fromAttr;
}

/**
 * Extract Tally GUID / Master ID when present on a master node.
 * Prefers XML attributes, then GUID / MASTERID text children.
 *
 * @param {unknown} node
 * @returns {string | null}
 */
function masterGuid(node) {
  if (!node || typeof node !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (node);
  const attrCandidates = [o["@_GUID"], o["@_GUID"], o["@_MasterId"], o["@_MASTERID"], o["@_REMOTEID"]];
  for (const c of attrCandidates) {
    const t = normalizeTallyControlText(c == null ? "" : String(c));
    if (t) return t.slice(0, 64);
  }
  const text = firstDirectText(o, ["GUID", "MASTERID", "REMOTEID", "ALTERID"]);
  return text ? text.slice(0, 64) : null;
}

/**
 * Case-normalized exact-name key for Tally master compare (collapse whitespace).
 * @param {unknown} s
 * @returns {string}
 */
function normalizeTallyMasterCompareKey(s) {
  return normalizeTallyControlText(s == null ? "" : String(s))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Walk a parsed XML tree and collect master nodes by local tag.
 *
 * @param {unknown} node
 * @param {Set<string>} collectTags
 * @param {(tag: string, obj: Record<string, unknown>) => void} onMaster
 * @param {{ isPathBlocked: (pathUpper: string[]) => boolean; onTag?: (tag: string, pathUpper: string[]) => void }} opts
 * @param {string[]} [pathSegUpper]
 */
function walkCollectTaggedMasters(node, collectTags, onMaster, opts, pathSegUpper = []) {
  if (node == null) return;
  if (opts.isPathBlocked(pathSegUpper)) return;

  if (Array.isArray(node)) {
    for (const child of node) walkCollectTaggedMasters(child, collectTags, onMaster, opts, pathSegUpper);
    return;
  }
  if (typeof node !== "object") return;

  for (const [key, val] of Object.entries(/** @type {Record<string, unknown>} */ (node))) {
    const localUpper = xmlLocalTagNameUpper(key);
    if (localUpper == null) continue;
    const nextPath = [...pathSegUpper, localUpper];
    if (opts.onTag) opts.onTag(localUpper, nextPath);

    if (!opts.isPathBlocked(nextPath) && collectTags.has(localUpper)) {
      for (const L of asArray(val)) {
        if (L && typeof L === "object") onMaster(localUpper, /** @type {Record<string, unknown>} */ (L));
      }
    }
    walkCollectTaggedMasters(val, collectTags, onMaster, opts, nextPath);
  }
}

module.exports = {
  strVal,
  normalizeTallyControlText,
  normalizeTallyMasterCompareKey,
  xmlLocalTagNameUpper,
  asArray,
  getByLocalTag,
  firstDirectText,
  getListBlocks,
  collectDirectTexts,
  joinAddressList,
  findFirstTextByTags,
  masterGuid,
  findFirstNumberByTags,
  masterDisplayName,
  walkCollectTaggedMasters,
};
