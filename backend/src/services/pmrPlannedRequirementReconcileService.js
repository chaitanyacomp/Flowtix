/**
 * Reconcile open PMR planned requirements against the authoritative WO plan
 * (production/shot RM incl. runner + planned purge once) and Kg issue rounding snapshots.
 *
 * Pre-migration / pre-purge-merge PMRs stored production-only requiredQty and lack
 * issueIncrementSnapshot / roundedIssueTargetQty. Reconcile before display/issue.
 *
 * CRITICAL: production + purge for the same RM item must merge onto one PMR line
 * (unique: PmrLine_pmrId_itemId_key). Never insert a second line for purge alone.
 *
 * Does not rewrite completed/closed PMRs or historical MIN documents.
 */

const { STOCK_EPS } = require("./stockService");
const {
  computeRoundedIssueTargetQty,
  kgIssueRoundingApplies,
  n,
  round3,
  round6,
} = require("./rmIssueRoundingService");

const OPEN_RECONCILE_STATUSES = new Set(["DRAFT", "REQUESTED", "PARTIALLY_ISSUED"]);
const CLOSED_SKIP_STATUSES = new Set(["FULLY_ISSUED", "SHORT_ISSUE_ACCEPTED", "CANCELLED"]);

const OPERATOR_RECONCILE_FAILED_MESSAGE =
  "Could not refresh planned RM quantities for this request. The request is still selectable — retry, or contact an administrator if it continues.";

function qtyClose(a, b) {
  return Math.abs(n(a) - n(b)) <= STOCK_EPS;
}

/**
 * Aggregate WO suggestion rows by canonical RM itemId before persistence.
 * plannedRequiredQty = production/shot + allocated purge (once per item).
 */
function aggregateSuggestionLinesByRmItem(suggestionLines) {
  const byItem = new Map();
  for (const raw of suggestionLines || []) {
    const itemId = Number(raw.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;

    let productionRmQty = round3(n(raw.productionRmQty));
    let purgingRmQty = round3(n(raw.purgingRmQty));
    let requiredQty = round3(n(raw.requiredQty));

    // Split rows may carry only one component.
    if (productionRmQty <= STOCK_EPS && purgingRmQty <= STOCK_EPS && requiredQty > STOCK_EPS) {
      productionRmQty = requiredQty;
    }
    const composed = round3(productionRmQty + purgingRmQty);
    if (composed > STOCK_EPS) {
      requiredQty = composed;
    }

    const prev = byItem.get(itemId);
    if (!prev) {
      byItem.set(itemId, {
        ...raw,
        itemId,
        productionRmQty,
        purgingRmQty,
        requiredQty,
      });
      continue;
    }

    const prevHasBoth =
      n(prev.productionRmQty) > STOCK_EPS && n(prev.purgingRmQty) > STOCK_EPS;
    const nextHasBoth = productionRmQty > STOCK_EPS && purgingRmQty > STOCK_EPS;

    if (prevHasBoth && nextHasBoth) {
      // Duplicate full suggestion rows (idempotent / concurrent) — keep max, do not double.
      if (requiredQty > n(prev.requiredQty) + STOCK_EPS) {
        prev.requiredQty = requiredQty;
        prev.productionRmQty = productionRmQty;
        prev.purgingRmQty = purgingRmQty;
      }
    } else if (prevHasBoth && !nextHasBoth) {
      // Full row already present; only fold in a missing component (e.g. purge-only addendum).
      if (purgingRmQty > STOCK_EPS) {
        prev.purgingRmQty = round3(n(prev.purgingRmQty) + purgingRmQty);
      }
      if (productionRmQty > STOCK_EPS && n(prev.productionRmQty) <= STOCK_EPS) {
        prev.productionRmQty = productionRmQty;
      }
      prev.requiredQty = round3(n(prev.productionRmQty) + n(prev.purgingRmQty));
    } else if (!prevHasBoth && nextHasBoth) {
      prev.requiredQty = requiredQty;
      prev.productionRmQty = productionRmQty;
      prev.purgingRmQty = purgingRmQty;
    } else {
      // Split production vs purge rows for the same RM → sum components once.
      prev.productionRmQty = round3(n(prev.productionRmQty) + productionRmQty);
      prev.purgingRmQty = round3(n(prev.purgingRmQty) + purgingRmQty);
      prev.requiredQty = round3(n(prev.productionRmQty) + n(prev.purgingRmQty));
    }
    if (raw.issueIncrement != null && prev.issueIncrement == null) {
      prev.issueIncrement = raw.issueIncrement;
    }
    if (raw.unit && !prev.unit) prev.unit = raw.unit;
  }
  return [...byItem.values()];
}

/**
 * Pure plan for one PMR line vs authoritative BOM suggestion (+ item for Kg increment).
 */
function planPmrLinePlannedRequirementReconcile({ line, suggestion, item }) {
  const issuedQty = Math.max(0, n(line?.issuedQty));
  const waivedQty = Math.max(0, n(line?.waivedQty));
  const committed = round6(issuedQty + waivedQty);

  if (!suggestion) {
    if (committed > STOCK_EPS) {
      return {
        itemId: Number(line.itemId),
        lineId: line.id ?? null,
        action: "KEEP",
        reviewRequired: true,
        reviewReason: "ITEM_MISSING_FROM_WO_PLAN_WITH_ISSUED_QTY",
        patch: null,
        plannedRequiredQty: n(line.requiredQty),
        roundedIssueTargetQty:
          line.roundedIssueTargetQty != null ? n(line.roundedIssueTargetQty) : n(line.requiredQty),
        roundingExcessQty: 0,
        productionRmQty: line.productionRmQty != null ? n(line.productionRmQty) : null,
        purgingRmQty: line.purgingRmQty != null ? n(line.purgingRmQty) : null,
      };
    }
    return {
      itemId: Number(line.itemId),
      lineId: line.id ?? null,
      action: "KEEP",
      reviewRequired: false,
      reviewReason: null,
      patch: null,
      plannedRequiredQty: n(line.requiredQty),
      roundedIssueTargetQty:
        line.roundedIssueTargetQty != null ? n(line.roundedIssueTargetQty) : n(line.requiredQty),
      roundingExcessQty: 0,
      productionRmQty: line.productionRmQty != null ? n(line.productionRmQty) : null,
      purgingRmQty: line.purgingRmQty != null ? n(line.purgingRmQty) : null,
    };
  }

  const productionRmQty = round3(n(suggestion.productionRmQty));
  const purgingRmQty = round3(n(suggestion.purgingRmQty));
  const plannedRequiredQty = round3(
    productionRmQty + purgingRmQty > STOCK_EPS
      ? productionRmQty + purgingRmQty
      : n(suggestion.requiredQty),
  );
  const increment =
    suggestion.issueIncrement != null && n(suggestion.issueIncrement) > STOCK_EPS
      ? n(suggestion.issueIncrement)
      : n(item?.issueIncrement);
  const applies = kgIssueRoundingApplies(item || suggestion, { issueIncrement: increment });
  const idealRounded = applies
    ? computeRoundedIssueTargetQty(plannedRequiredQty, increment)
    : plannedRequiredQty;

  let roundedIssueTargetQty = idealRounded;
  let reviewRequired = false;
  let reviewReason = null;
  if (applies && idealRounded + STOCK_EPS < committed) {
    roundedIssueTargetQty = round6(committed);
    reviewRequired = true;
    reviewReason = "ROUNDED_TARGET_FLOORED_TO_ISSUED";
  }

  const roundingExcessQty = applies
    ? round6(Math.max(0, roundedIssueTargetQty - plannedRequiredQty))
    : 0;

  const patch = {
    requiredQty: String(plannedRequiredQty),
    productionRmQty: String(productionRmQty),
    purgingRmQty: String(purgingRmQty),
    issueIncrementSnapshot: applies ? String(round6(increment)) : null,
    roundedIssueTargetQty: applies ? String(round6(roundedIssueTargetQty)) : null,
  };

  const unchanged =
    qtyClose(line.requiredQty, plannedRequiredQty) &&
    qtyClose(line.productionRmQty, productionRmQty) &&
    qtyClose(line.purgingRmQty, purgingRmQty) &&
    (applies
      ? qtyClose(line.issueIncrementSnapshot, increment) &&
        qtyClose(line.roundedIssueTargetQty, roundedIssueTargetQty)
      : line.issueIncrementSnapshot == null && line.roundedIssueTargetQty == null);

  return {
    itemId: Number(line.itemId),
    lineId: line.id ?? null,
    action: unchanged ? "UNCHANGED" : "UPDATE",
    reviewRequired,
    reviewReason,
    patch: unchanged ? null : patch,
    plannedRequiredQty,
    productionRmQty,
    purgingRmQty,
    issueIncrement: applies ? round6(increment) : null,
    roundedIssueTargetQty: applies ? round6(roundedIssueTargetQty) : null,
    roundingExcessQty,
    remainingIssueQty: round6(
      Math.max(0, (applies ? roundedIssueTargetQty : plannedRequiredQty) - committed),
    ),
  };
}

/**
 * Build full reconcile plan for an open PMR vs WO suggestions.
 */
function planOpenPmrPlannedRequirementReconcile({ pmr, suggestionLines, itemsById }) {
  const status = String(pmr?.status ?? "").toUpperCase();
  if (CLOSED_SKIP_STATUSES.has(status)) {
    return {
      eligible: false,
      skipped: true,
      skipReason: "PMR_CLOSED_OR_COMPLETE",
      reviewRequired: false,
      linePlans: [],
      addLinePlans: [],
      changed: false,
    };
  }
  if (!OPEN_RECONCILE_STATUSES.has(status)) {
    return {
      eligible: false,
      skipped: true,
      skipReason: "PMR_STATUS_NOT_OPEN",
      reviewRequired: false,
      linePlans: [],
      addLinePlans: [],
      changed: false,
    };
  }

  const suggestions = aggregateSuggestionLinesByRmItem(suggestionLines);
  if (!suggestions.length) {
    return {
      eligible: true,
      skipped: true,
      skipReason: "NO_WO_RM_SUGGESTIONS",
      reviewRequired: false,
      linePlans: [],
      addLinePlans: [],
      changed: false,
    };
  }

  const suggestionByItem = new Map(suggestions.map((s) => [Number(s.itemId), s]));
  // One canonical line per itemId on the PMR (dedupe defensive).
  const linesByItem = new Map();
  for (const line of pmr.lines || []) {
    const itemId = Number(line.itemId);
    if (!linesByItem.has(itemId)) linesByItem.set(itemId, line);
  }
  const existingItemIds = new Set(linesByItem.keys());
  const totalIssued = [...linesByItem.values()].reduce((s, l) => s + n(l.issuedQty), 0);
  const unissued = totalIssued <= STOCK_EPS;

  const linePlans = [...linesByItem.values()].map((line) =>
    planPmrLinePlannedRequirementReconcile({
      line,
      suggestion: suggestionByItem.get(Number(line.itemId)) ?? null,
      item: itemsById?.get?.(Number(line.itemId)) ?? null,
    }),
  );

  const addLinePlans = [];
  for (const suggestion of suggestions) {
    const itemId = Number(suggestion.itemId);
    if (existingItemIds.has(itemId)) continue;
    if (!unissued) {
      addLinePlans.push({
        itemId,
        action: "SKIP_ADD",
        reviewRequired: true,
        reviewReason: "NEW_WO_RM_WHILE_PARTIALLY_ISSUED",
        patch: null,
      });
      continue;
    }
    const item = itemsById?.get?.(itemId) ?? null;
    const planned = planPmrLinePlannedRequirementReconcile({
      line: { itemId, requiredQty: 0, issuedQty: 0, waivedQty: 0 },
      suggestion,
      item,
    });
    addLinePlans.push({
      ...planned,
      action: "UPSERT",
      patch: {
        itemId,
        requiredQty: String(planned.plannedRequiredQty),
        productionRmQty:
          planned.productionRmQty != null ? String(planned.productionRmQty) : null,
        purgingRmQty: planned.purgingRmQty != null ? String(planned.purgingRmQty) : null,
        issueIncrementSnapshot:
          planned.issueIncrement != null ? String(planned.issueIncrement) : null,
        roundedIssueTargetQty:
          planned.roundedIssueTargetQty != null ? String(planned.roundedIssueTargetQty) : null,
        unitSnapshot: suggestion.unit || item?.unit || "",
      },
    });
  }

  const reviewRequired =
    linePlans.some((p) => p.reviewRequired) || addLinePlans.some((p) => p.reviewRequired);
  const changed =
    linePlans.some((p) => p.action === "UPDATE") ||
    addLinePlans.some((p) => p.action === "UPSERT");

  return {
    eligible: true,
    skipped: false,
    skipReason: null,
    reviewRequired,
    linePlans,
    addLinePlans,
    changed,
    aggregatedSuggestionCount: suggestions.length,
  };
}

/**
 * Scenario helper: pre-migration open PMR with production-only requiredQty and planned purge.
 */
function expectedReconcileForPreMigrationOpenPmr({
  productionRmQty,
  purgingRmQty,
  issueIncrement = 1,
  issuedQty = 0,
}) {
  const plannedRequiredQty = round3(n(productionRmQty) + n(purgingRmQty));
  const roundedIssueTargetQty = computeRoundedIssueTargetQty(plannedRequiredQty, issueIncrement);
  const roundingExcessQty = round6(Math.max(0, roundedIssueTargetQty - plannedRequiredQty));
  const remainingIssueQty = round6(Math.max(0, roundedIssueTargetQty - n(issuedQty)));
  return {
    plannedRequiredQty,
    roundedIssueTargetQty,
    roundingExcessQty,
    remainingIssueQty,
  };
}

function describePrismaUniqueViolation(err) {
  const meta = err?.meta && typeof err.meta === "object" ? err.meta : {};
  const target = Array.isArray(meta.target)
    ? meta.target.join(",")
    : typeof meta.target === "string"
      ? meta.target
      : null;
  const model = typeof meta.modelName === "string" ? meta.modelName : null;
  return {
    code: err?.code || null,
    model,
    target,
    constraint:
      target ||
      (typeof meta.constraint === "string"
        ? meta.constraint
        : Array.isArray(meta.constraint)
          ? meta.constraint.join(",")
          : null),
    message: String(err?.message || ""),
  };
}

module.exports = {
  OPEN_RECONCILE_STATUSES,
  CLOSED_SKIP_STATUSES,
  OPERATOR_RECONCILE_FAILED_MESSAGE,
  aggregateSuggestionLinesByRmItem,
  planPmrLinePlannedRequirementReconcile,
  planOpenPmrPlannedRequirementReconcile,
  expectedReconcileForPreMigrationOpenPmr,
  describePrismaUniqueViolation,
};
