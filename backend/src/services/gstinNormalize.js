/** Standard Indian GSTIN: 2-digit state + 10-char PAN + entity + Z + checksum */
const GSTIN_FORMAT_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function normalizeGstinOnSave(raw) {
  if (raw == null) return null;
  const t = String(raw).trim().toUpperCase();
  if (!t) return null;
  return t.slice(0, 15);
}

function isValidGstinFormat(gstin) {
  const g = normalizeGstinOnSave(gstin);
  if (!g) return false;
  return g.length === 15 && GSTIN_FORMAT_REGEX.test(g);
}

function gstStateCodeFromGstin(gstin) {
  const g = normalizeGstinOnSave(gstin);
  if (!g || g.length < 2) return null;
  const code = g.slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

function validateGstinFormatMessage(gstin) {
  const g = normalizeGstinOnSave(gstin);
  if (!g) return null;
  if (g.length !== 15) return "GSTIN must be exactly 15 characters.";
  if (!GSTIN_FORMAT_REGEX.test(g)) return "Enter a valid GSTIN format (15 characters).";
  return null;
}

/**
 * @param {string | null | undefined} gstin
 * @param {string | null | undefined} stateCode - 2-digit GST state code from State master
 */
function gstinMatchesStateCode(gstin, stateCode) {
  const g = normalizeGstinOnSave(gstin);
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
  const g = normalizeGstinOnSave(gstin);
  if (!g) return null;
  if (state?.stateCode && !gstinMatchesStateCode(g, state.stateCode)) {
    return "Selected state does not match the GSTIN state code.";
  }
  return null;
}

module.exports = {
  GSTIN_FORMAT_REGEX,
  normalizeGstinOnSave,
  isValidGstinFormat,
  gstStateCodeFromGstin,
  validateGstinFormatMessage,
  gstinMatchesStateCode,
  validateGstinAgainstState,
};
