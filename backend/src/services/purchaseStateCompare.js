const { normalizeStateKey } = require("./stateMaster");

function normalizeLegacyStateText(s) {
  const key = normalizeStateKey(s);
  return key.length ? key : null;
}

/**
 * Purchase GST split uses "intra-state" vs "inter-state":
 * - Prefer structured GST state codes when available on both sides
 * - Fallback to legacy normalized free-text only when structured is missing
 * - If cannot compare safely, return intraState=false (current safe behavior: IGST)
 */
function resolvePurchaseIntraState({ company, supplier }) {
  const cCode = company?.companyStateRef?.stateCode ?? null;
  const sCode = supplier?.stateRef?.stateCode ?? null;
  if (cCode && sCode) {
    return { intraState: String(cCode) === String(sCode), basis: "STRUCTURED" };
  }

  const cText = normalizeLegacyStateText(company?.companyState ?? null);
  const sText = normalizeLegacyStateText(supplier?.state ?? null);
  if (cText && sText) {
    return { intraState: cText === sText, basis: "LEGACY" };
  }

  return { intraState: false, basis: "UNKNOWN" };
}

module.exports = { resolvePurchaseIntraState };

