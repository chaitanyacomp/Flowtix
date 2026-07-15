/** Standard Indian GSTIN: 2-digit state + 10-char PAN + entity + Z + checksum */
const GSTIN_FORMAT_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Strip whitespace/newlines/separators so Tally XML quirks do not change length checks.
 * Keeps only A–Z and 0–9 (uppercase).
 * @param {unknown} raw
 * @returns {string}
 */
function cleanGstinChars(raw) {
  if (raw == null) return "";
  return String(raw)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

/**
 * Normalize for persistence / comparison. Returns null when empty after cleaning.
 * Only returns a value when cleaned length is exactly 15 (VarChar(15) / GSTIN width).
 * Invalid lengths return null — callers must use validateGstinFormatMessage for user-facing errors.
 * @param {unknown} raw
 * @returns {string | null}
 */
function normalizeGstinOnSave(raw) {
  const t = cleanGstinChars(raw);
  if (!t) return null;
  if (t.length !== 15) return null;
  return t;
}

/**
 * @param {unknown} gstin
 * @returns {boolean}
 */
function isValidGstinFormat(gstin) {
  return validateGstinFormatMessage(gstin) == null && cleanGstinChars(gstin).length === 15;
}

/**
 * @param {unknown} gstin
 * @returns {string | null}
 */
function gstStateCodeFromGstin(gstin) {
  const g = cleanGstinChars(gstin);
  if (g.length < 2) return null;
  const code = g.slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

/**
 * Validate GSTIN format. Empty / missing → null (allowed).
 * Always validates the cleaned character sequence (whitespace/newlines stripped) — never a truncated prefix.
 * @param {unknown} gstin
 * @returns {string | null}
 */
function validateGstinFormatMessage(gstin) {
  if (gstin == null) return null;
  const raw = String(gstin).trim();
  if (!raw) return null;
  const g = cleanGstinChars(raw);
  if (!g) return null;
  if (g.length !== 15) return "GSTIN must be exactly 15 characters.";
  if (!GSTIN_FORMAT_REGEX.test(g)) return "Enter a valid GSTIN format (15 characters).";
  return null;
}

/**
 * Resolve extracted Tally GSTIN for import preview/apply (same path for both).
 * @param {unknown} rawGst
 * @returns {{ gstRaw: string | null; gstNorm: string | null; gstMsg: string | null }}
 */
function resolveImportGstin(rawGst) {
  if (rawGst == null) return { gstRaw: null, gstNorm: null, gstMsg: null };
  const gstRaw = String(rawGst).replace(/\s+/g, " ").trim();
  if (!gstRaw) return { gstRaw: null, gstNorm: null, gstMsg: null };
  const gstMsg = validateGstinFormatMessage(gstRaw);
  const gstNorm = gstMsg ? null : normalizeGstinOnSave(gstRaw);
  return { gstRaw, gstNorm, gstMsg };
}

/**
 * @param {string | null | undefined} gstin
 * @param {string | null | undefined} stateCode - 2-digit GST state code from State master
 */
function gstinMatchesStateCode(gstin, stateCode) {
  const g = cleanGstinChars(gstin);
  const prefix = gstStateCodeFromGstin(g);
  const code = stateCode != null ? String(stateCode).trim().padStart(2, "0") : null;
  if (!g || !prefix || !code) return true;
  return prefix === code;
}

/**
 * @param {string | null | undefined} gstin
 * @param {{ stateCode?: string | null }} state
 */
function validateGstinAgainstState(gstin, state) {
  const formatMsg = validateGstinFormatMessage(gstin);
  if (formatMsg) return formatMsg;
  const g = cleanGstinChars(gstin);
  if (!g) return null;
  if (state?.stateCode && !gstinMatchesStateCode(g, state.stateCode)) {
    return "Selected state does not match the GSTIN state code.";
  }
  return null;
}

module.exports = {
  GSTIN_FORMAT_REGEX,
  cleanGstinChars,
  normalizeGstinOnSave,
  isValidGstinFormat,
  gstStateCodeFromGstin,
  validateGstinFormatMessage,
  resolveImportGstin,
  gstinMatchesStateCode,
  validateGstinAgainstState,
};
