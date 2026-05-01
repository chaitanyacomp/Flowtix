const { normalizeStateKey } = require("./stateMaster");

function normalizeLegacyStateText(s) {
  const key = normalizeStateKey(s);
  return key.length ? key : null;
}

/**
 * Sales GST foundation:
 * - Prefer structured GST state codes when available on both sides
 * - Fallback to legacy normalized free-text only when structured is missing
 * - If cannot compare safely, return intraState=false (safe non-blocking default)
 */
function resolveSalesIntraState({ company, customer }) {
  const cCode = company?.companyStateRef?.stateCode ?? null;
  const custCode = customer?.stateRef?.stateCode ?? null;
  if (cCode && custCode) {
    return { intraState: String(cCode) === String(custCode), basis: "STRUCTURED" };
  }

  const cText = normalizeLegacyStateText(company?.companyState ?? null);
  const custText = normalizeLegacyStateText(customer?.state ?? null);
  if (cText && custText) {
    return { intraState: cText === custText, basis: "LEGACY" };
  }

  return { intraState: false, basis: "UNKNOWN" };
}

module.exports = { resolveSalesIntraState };

