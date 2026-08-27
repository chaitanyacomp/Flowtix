/**
 * Enquiry list scopes for GET /api/enquiries.
 * - active: pre-SO funnel (actionable)
 * - history / all: every status including CLOSED / NOT_FEASIBLE / PO_RECEIVED
 */

const ACTIVE_ENQUIRY_STATUSES = Object.freeze(["OPEN", "DRAFT", "PENDING", "FEASIBLE", "QUOTED"]);

/**
 * @param {unknown} raw
 * @returns {"active" | "history"}
 */
function parseEnquiryListScope(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === "active") return "active";
  // history | all | omitted → full history
  return "history";
}

/**
 * @param {"active" | "history"} scope
 * @returns {{ status?: { in: string[] } }}
 */
function enquiryListWhereForScope(scope) {
  if (scope === "active") {
    return { status: { in: [...ACTIVE_ENQUIRY_STATUSES] } };
  }
  return {};
}

module.exports = {
  ACTIVE_ENQUIRY_STATUSES,
  parseEnquiryListScope,
  enquiryListWhereForScope,
};
