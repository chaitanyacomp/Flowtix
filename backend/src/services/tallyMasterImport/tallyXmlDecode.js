/**
 * Shared Tally master-import decode + XML 1.0 sanitization.
 * Operate on the uploaded Buffer; return encoding for preview diagnostics.
 */

const TRUNCATED_XML_MESSAGE = "The selected Tally XML file appears incomplete or truncated.";

/**
 * @typedef {"UTF-16LE" | "UTF-16BE" | "UTF-8" | "UTF-8-BOM"} TallyXmlEncoding
 */

/**
 * Decode Tally master XML from BOM on the uploaded Buffer.
 * - FF FE → UTF-16LE
 * - FE FF → UTF-16BE
 * - EF BB BF → UTF-8 BOM
 * - otherwise attempt UTF-8 safely
 *
 * @param {Buffer | null | undefined} buf
 * @returns {{ text: string; encoding: TallyXmlEncoding; byteLength: number }}
 */
function decodeTallyXmlBuffer(buf) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
    const err = new Error("The selected Tally XML file is empty or unreadable.");
    err.code = "TALLY_XML_UNREADABLE";
    err.statusCode = 400;
    throw err;
  }

  /** @type {TallyXmlEncoding} */
  let encoding = "UTF-8";
  let text = "";

  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    encoding = "UTF-16LE";
    text = buf.slice(2).toString("utf16le");
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    encoding = "UTF-16BE";
    const pairs = Math.floor((buf.length - 2) / 2);
    const out = Buffer.allocUnsafe(pairs * 2);
    for (let i = 0; i < pairs; i += 1) {
      out[i * 2] = buf[2 + i * 2 + 1];
      out[i * 2 + 1] = buf[2 + i * 2];
    }
    text = out.toString("utf16le");
  } else if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    encoding = "UTF-8-BOM";
    text = buf.slice(3).toString("utf8");
  } else {
    encoding = "UTF-8";
    text = buf.toString("utf8");
  }

  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // Reject obvious binary garbage (NUL-heavy after decode).
  const sample = text.slice(0, Math.min(text.length, 4000));
  let nul = 0;
  for (let i = 0; i < sample.length; i += 1) {
    if (sample.charCodeAt(i) === 0) nul += 1;
  }
  if (sample.length > 100 && nul / sample.length > 0.05) {
    const err = new Error(
      "The selected Tally XML file could not be decoded as text. Re-export from Tally as XML (UTF-16 or UTF-8) and try again.",
    );
    err.code = "TALLY_XML_UNREADABLE";
    err.statusCode = 400;
    throw err;
  }

  return { text, encoding, byteLength: buf.length };
}

/**
 * Remove only XML 1.0-invalid numeric character references (e.g. &#4; / &#x4;).
 * Preserves valid entities (&amp; &apos; &quot; &#39; and valid numeric refs).
 *
 * @param {string} xmlText
 * @returns {{ text: string; sanitizedInvalidRefCount: number }}
 */
function sanitizeInvalidXml10CharRefs(xmlText) {
  const s = String(xmlText || "");
  let sanitizedInvalidRefCount = 0;
  const text = s.replace(/&#(x?[0-9a-fA-F]+);/g, (full, body) => {
    const raw = String(body || "");
    const isHex = raw[0] === "x" || raw[0] === "X";
    const n = isHex ? parseInt(raw.slice(1), 16) : parseInt(raw, 10);
    if (!Number.isFinite(n)) return full;
    // XML 1.0 allowed: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
    const ok =
      n === 0x9 ||
      n === 0xa ||
      n === 0xd ||
      (n >= 0x20 && n <= 0xd7ff) ||
      (n >= 0xe000 && n <= 0xfffd) ||
      (n >= 0x10000 && n <= 0x10ffff);
    if (ok) return full;
    sanitizedInvalidRefCount += 1;
    return "";
  });
  return { text, sanitizedInvalidRefCount };
}

/**
 * Business-readable truncated / incomplete envelope check.
 * @param {string} xmlText
 * @returns {{ ok: true } | { ok: false; error: string }}
 */
function assertCompleteTallyXmlEnvelope(xmlText) {
  const t = String(xmlText || "").trim();
  if (!t) {
    return { ok: false, error: TRUNCATED_XML_MESSAGE };
  }
  const hasOpen = /<ENVELOPE[\s>]/i.test(t);
  const hasClose = /<\/ENVELOPE\s*>/i.test(t);
  if (!hasOpen || !hasClose) {
    return { ok: false, error: TRUNCATED_XML_MESSAGE };
  }
  return { ok: true };
}

/**
 * Decode + sanitize + completeness check for master import upload.
 * @param {Buffer} buf
 */
function prepareTallyMasterXmlFromBuffer(buf) {
  const decoded = decodeTallyXmlBuffer(buf);
  const complete = assertCompleteTallyXmlEnvelope(decoded.text);
  if (!complete.ok) {
    const err = new Error(complete.error);
    err.code = "TALLY_XML_TRUNCATED";
    err.statusCode = 400;
    throw err;
  }
  const sanitized = sanitizeInvalidXml10CharRefs(decoded.text);
  return {
    text: sanitized.text,
    encoding: decoded.encoding,
    byteLength: decoded.byteLength,
    sanitizedInvalidRefCount: sanitized.sanitizedInvalidRefCount,
  };
}

/**
 * Back-compat helper used by routes/tests: Buffer → decoded+sanitized string.
 * Prefer prepareTallyMasterXmlFromBuffer when diagnostics are needed.
 * @param {Buffer} buf
 * @returns {string}
 */
function decodeXmlFromBuffer(buf) {
  return prepareTallyMasterXmlFromBuffer(buf).text;
}

module.exports = {
  decodeTallyXmlBuffer,
  sanitizeInvalidXml10CharRefs,
  assertCompleteTallyXmlEnvelope,
  prepareTallyMasterXmlFromBuffer,
  decodeXmlFromBuffer,
  TRUNCATED_XML_MESSAGE,
};
