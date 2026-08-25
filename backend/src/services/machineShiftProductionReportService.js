/**
 * Step 2B — Shift Production Report draft / versioning / submit / return / verify.
 * Qty Sent to QC / Gross are calculated from linked APPROVED ProductionEntry rows.
 * Client provides productionScrapQty (+ remarks) per run-segment/item line.
 */

const { prisma } = require("../utils/prisma");
const {
  domainError,
  mapShiftSessionPersistenceError,
} = require("./machineShiftSessionErrors");
const {
  withShiftSessionTx,
  normalizePositiveInt,
  normalizeOptionalUserId,
  normalizeChangeReason,
  SESSION_STATUS,
} = require("./machineShiftSessionService");
const {
  aggregateShiftSessionProductionQuantities,
  buildCalculatedReportLines,
  roundQty,
} = require("./machineShiftReportAggregationService");

const REPORT_VERSION_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  RETURNED: "RETURNED",
  VERIFIED: "VERIFIED",
});

const ZERO_PRODUCTION_REASONS = Object.freeze({
  NO_WORK_ORDER: "NO_WORK_ORDER",
  MACHINE_BREAKDOWN: "MACHINE_BREAKDOWN",
  MATERIAL_UNAVAILABLE: "MATERIAL_UNAVAILABLE",
  POWER_FAILURE: "POWER_FAILURE",
  PLANNED_MAINTENANCE: "PLANNED_MAINTENANCE",
  OTHER: "OTHER",
});

const ZERO_PRODUCTION_REASON_SET = Object.freeze(new Set(Object.values(ZERO_PRODUCTION_REASONS)));

const IMMUTABLE_VERSION_STATUSES = Object.freeze(
  new Set([
    REPORT_VERSION_STATUS.SUBMITTED,
    REPORT_VERSION_STATUS.RETURNED,
    REPORT_VERSION_STATUS.VERIFIED,
  ]),
);

const QTY_EPS = 0.0005;

function toQty(value, fieldLabel) {
  if (value == null || value === "") {
    throw domainError(400, "QTY_REQUIRED", `${fieldLabel} is required.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw domainError(400, "QTY_INVALID", `${fieldLabel} must be a valid quantity.`);
  }
  if (n < 0) {
    throw domainError(400, "QTY_NEGATIVE", `${fieldLabel} cannot be negative.`);
  }
  return Math.round(n * 1000) / 1000;
}

function qtyEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) <= QTY_EPS;
}

function normalizeRemarks(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 2000) : null;
}

function normalizeZeroProductionReason(value, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) {
      throw domainError(
        400,
        "ZERO_PRODUCTION_REASON_REQUIRED",
        "Select a reason when recording zero production for this shift.",
      );
    }
    return null;
  }
  const key = String(value).trim().toUpperCase();
  if (!ZERO_PRODUCTION_REASON_SET.has(key)) {
    throw domainError(
      400,
      "ZERO_PRODUCTION_REASON_INVALID",
      "Choose a valid zero-production reason.",
    );
  }
  return key;
}

function normalizeZeroProductionRemarks(reason, remarks) {
  const text = normalizeRemarks(remarks);
  if (reason === ZERO_PRODUCTION_REASONS.OTHER && !text) {
    throw domainError(
      400,
      "ZERO_PRODUCTION_REMARKS_REQUIRED",
      "Add remarks when the zero-production reason is Other.",
    );
  }
  return text;
}

function approvedQtyTotal(approvedByLine) {
  let total = 0;
  for (const row of approvedByLine?.values?.() || []) {
    total = roundQty(total + Number(row.qtySentToQc || 0));
  }
  return total;
}

/**
 * Zero-production report is allowed only on OPEN sessions with no approved PE,
 * no scrap, and no linked DRAFT ProductionEntries.
 */
async function assertZeroProductionEligible(tx, sessionId, { productionScrapQty = 0 } = {}) {
  const session = await loadSession(tx, sessionId);
  if (session.status === SESSION_STATUS.CANCELLED) {
    throw domainError(
      409,
      "SHIFT_SESSION_ALREADY_CANCELLED",
      "This shift session was cancelled. Open a new shift if work needs to continue.",
    );
  }
  if (session.status !== SESSION_STATUS.OPEN) {
    throw domainError(
      409,
      "ZERO_PRODUCTION_NOT_ELIGIBLE",
      "Zero production can only be recorded on an open shift session.",
      { status: session.status },
    );
  }

  const qtyCtx = await loadApprovedQtyContext(tx, sessionId);
  const blockers = [];
  const approvedTotal = approvedQtyTotal(qtyCtx.approvedByLine);
  if (approvedTotal > QTY_EPS) blockers.push("APPROVED_PRODUCTION");
  if (Number(productionScrapQty) > QTY_EPS) blockers.push("PRODUCTION_SCRAP");
  if (Number(qtyCtx.pendingDraftCount) > 0) blockers.push("DRAFT_PRODUCTION_ENTRIES");

  if (blockers.length) {
    throw domainError(
      409,
      "ZERO_PRODUCTION_NOT_ELIGIBLE",
      blockers.includes("DRAFT_PRODUCTION_ENTRIES")
        ? "Approve or remove pending production entries before recording zero production."
        : "Zero production cannot be recorded when this shift already has approved production or scrap.",
      {
        blockers,
        approvedQty: approvedTotal,
        productionScrapQty: Number(productionScrapQty) || 0,
        pendingDraftCount: qtyCtx.pendingDraftCount,
      },
    );
  }

  return { session, qtyCtx, approvedTotal };
}

async function loadSession(tx, sessionId) {
  const session = await tx.machineShiftSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw domainError(404, "SHIFT_SESSION_NOT_FOUND", "Shift session was not found.");
  }
  return session;
}

async function assertOperatorParticipated(tx, sessionId, operatorId) {
  const row = await tx.machineShiftSessionOperator.findFirst({
    where: { sessionId, operatorId },
    orderBy: { id: "desc" },
  });
  if (!row) {
    throw domainError(
      409,
      "DECLARED_OPERATOR_NOT_ON_SESSION",
      "The declared operator did not participate in this shift session.",
    );
  }
  return row;
}

/**
 * Normalize client scrap lines + server-calculated Qty Sent to QC / Gross.
 * Rejects client attempts to override calculated qtySentToQc / grossOutputQty.
 */
function normalizeAndValidateLines(linesInput, ctx) {
  const clientLines = Array.isArray(linesInput) ? linesInput : [];

  for (const raw of clientLines) {
    const runSegmentId = normalizePositiveInt(
      raw?.runSegmentId,
      "RUN_SEGMENT_ID_INVALID",
      "Each report line must reference a run segment from this shift.",
    );
    const itemId = normalizePositiveInt(raw?.itemId, "ITEM_ID_INVALID", "Each report line must include an item.");
    const seg = ctx.runSegmentsById.get(runSegmentId);
    if (!seg || seg.sessionId !== ctx.sessionId) {
      throw domainError(
        409,
        "RUN_SEGMENT_NOT_ON_SESSION",
        "A report line references a run segment that does not belong to this shift session.",
      );
    }
    void itemId;
    // Reject explicit overrides that disagree with calculated values (after we know scrap).
    if (raw?.qtySentToQc != null || raw?.grossOutputQty != null) {
      const scrap = toQty(raw.productionScrapQty ?? 0, "Production scrap quantity");
      const approved = roundQty(ctx.approvedByLine.get(`${runSegmentId}:${itemId}`)?.qtySentToQc ?? 0);
      const expectedGross = roundQty(scrap + approved);
      if (raw.qtySentToQc != null && !qtyEqual(toQty(raw.qtySentToQc, "Quantity sent to QC"), approved)) {
        throw domainError(
          400,
          "REPORT_QTY_SENT_TO_QC_READONLY",
          "Quantity sent to QC is calculated from approved production entries and cannot be overridden.",
        );
      }
      if (raw.grossOutputQty != null && !qtyEqual(toQty(raw.grossOutputQty, "Gross output quantity"), expectedGross)) {
        throw domainError(
          400,
          "REPORT_GROSS_OUTPUT_READONLY",
          "Gross output is calculated as scrap plus quantity sent to QC and cannot be overridden.",
        );
      }
    }
  }

  const scrapInputs = clientLines.map((raw) => ({
    runSegmentId: Number(raw.runSegmentId),
    itemId: Number(raw.itemId),
    productionScrapQty: toQty(raw.productionScrapQty ?? 0, "Production scrap quantity"),
    remarks: raw.remarks,
  }));

  // Require at least one line when there is scrap input OR approved PE qty.
  const { lines, totals } = buildCalculatedReportLines(scrapInputs, ctx.approvedByLine);
  if (lines.length === 0) {
    throw domainError(400, "REPORT_LINES_REQUIRED", "At least one report line is required.");
  }

  // Deduplicate check already handled by Map keys in buildCalculatedReportLines;
  // detect client duplicates explicitly.
  const seen = new Set();
  for (const raw of clientLines) {
    const key = `${Number(raw.runSegmentId)}:${Number(raw.itemId)}`;
    if (seen.has(key)) {
      throw domainError(400, "REPORT_LINE_DUPLICATE", "The same run segment and item appear more than once on this report.");
    }
    seen.add(key);
  }

  return { lines, totals };
}

function assertHeaderMatchesLines(header, totals) {
  if (
    !qtyEqual(header.grossOutputQty, totals.grossOutputQty) ||
    !qtyEqual(header.productionScrapQty, totals.productionScrapQty) ||
    !qtyEqual(header.qtySentToQc, totals.qtySentToQc)
  ) {
    throw domainError(
      400,
      "REPORT_HEADER_TOTAL_MISMATCH",
      "Report totals must equal the sum of all line quantities.",
    );
  }
}

/**
 * Normalize client-proposed lines for historical adjustment (unchanged workflow).
 * Proposed qtySentToQc / gross / scrap come from the request — not live PE aggregation.
 */
function normalizeProposedAdjustmentLines(linesInput, ctx) {
  if (!Array.isArray(linesInput) || linesInput.length === 0) {
    throw domainError(400, "REPORT_LINES_REQUIRED", "At least one report line is required.");
  }

  const seen = new Set();
  const lines = [];
  let sumGross = 0;
  let sumScrap = 0;
  let sumQc = 0;

  for (const raw of linesInput) {
    const runSegmentId = normalizePositiveInt(
      raw?.runSegmentId,
      "RUN_SEGMENT_ID_INVALID",
      "Each report line must reference a run segment from this shift.",
    );
    const itemId = normalizePositiveInt(raw?.itemId, "ITEM_ID_INVALID", "Each report line must include an item.");
    const seg = ctx.runSegmentsById.get(runSegmentId);
    if (!seg || seg.sessionId !== ctx.sessionId) {
      throw domainError(
        409,
        "RUN_SEGMENT_NOT_ON_SESSION",
        "A report line references a run segment that does not belong to this shift session.",
      );
    }
    const key = `${runSegmentId}:${itemId}`;
    if (seen.has(key)) {
      throw domainError(400, "REPORT_LINE_DUPLICATE", "The same run segment and item appear more than once on this report.");
    }
    seen.add(key);

    const productionScrapQty = toQty(raw.productionScrapQty ?? 0, "Production scrap quantity");
    const qtySentToQc = toQty(raw.qtySentToQc, "Quantity sent to QC");
    const grossOutputQty = toQty(raw.grossOutputQty, "Gross output quantity");
    if (!qtyEqual(grossOutputQty, productionScrapQty + qtySentToQc)) {
      throw domainError(
        400,
        "REPORT_LINE_QTY_IDENTITY",
        "Each line's gross output must equal production scrap plus quantity sent to QC.",
      );
    }

    lines.push({
      runSegmentId,
      itemId,
      grossOutputQty,
      productionScrapQty,
      qtySentToQc,
      remarks: normalizeRemarks(raw.remarks),
    });
    sumGross = roundQty(sumGross + grossOutputQty);
    sumScrap = roundQty(sumScrap + productionScrapQty);
    sumQc = roundQty(sumQc + qtySentToQc);
  }

  return {
    lines,
    totals: {
      grossOutputQty: sumGross,
      productionScrapQty: sumScrap,
      qtySentToQc: sumQc,
    },
  };
}

async function loadSessionRunSegmentsMap(tx, sessionId) {
  const rows = await tx.machineShiftSessionRunSegment.findMany({
    where: { sessionId },
    select: { id: true, sessionId: true, machineId: true, workOrderId: true, status: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

async function loadApprovedQtyContext(tx, sessionId) {
  const agg = await aggregateShiftSessionProductionQuantities(tx, sessionId);
  return {
    approvedByLine: agg.byLine,
    pendingDraftCount: agg.pendingDraftCount,
    pendingDraftQty: agg.pendingDraftQty,
    pendingByLine: agg.pendingByLine,
    aggregation: agg,
  };
}

function assertNoUnapprovedLinkedEntries(agg) {
  if (Number(agg.pendingDraftCount) > 0) {
    throw domainError(
      409,
      "SHIFT_REPORT_HAS_UNAPPROVED_ENTRIES",
      "Approve or remove the pending production entries before submitting the Shift Report.",
      { pendingDraftCount: agg.pendingDraftCount, pendingDraftQty: agg.pendingDraftQty },
    );
  }
}

async function ensureShiftProductionReport(tx, sessionId) {
  const existing = await tx.shiftProductionReport.findUnique({ where: { sessionId } });
  if (existing) return existing;
  try {
    return await tx.shiftProductionReport.create({
      data: { sessionId, latestVersionNo: 0 },
    });
  } catch (e) {
    if (e?.code === "P2002") {
      const again = await tx.shiftProductionReport.findUnique({ where: { sessionId } });
      if (again) return again;
    }
    throw mapShiftSessionPersistenceError(e, { action: "ensureReport" });
  }
}

async function findVersionByNo(tx, reportId, versionNo) {
  return tx.shiftProductionReportVersion.findFirst({
    where: { reportId, versionNo },
    include: { lines: { orderBy: { id: "asc" } } },
  });
}

async function findLatestVersion(tx, report) {
  if (!report || Number(report.latestVersionNo) <= 0) return null;
  return findVersionByNo(tx, report.id, report.latestVersionNo);
}

function lineCopyData(lines) {
  return (lines || []).map((l) => ({
    runSegmentId: l.runSegmentId,
    itemId: l.itemId,
    grossOutputQty: l.grossOutputQty,
    productionScrapQty: l.productionScrapQty,
    qtySentToQc: l.qtySentToQc,
    remarks: l.remarks ?? null,
  }));
}

/**
 * Create a new DRAFT version copied from a source version (RETURNED or VERIFIED).
 * Does not copy declaration or submit/verify/return audit — draft starts undeclared.
 */
async function createDraftVersionFrom(tx, report, sourceVersion) {
  const nextNo = Number(report.latestVersionNo) + 1;
  const version = await tx.shiftProductionReportVersion.create({
    data: {
      reportId: report.id,
      versionNo: nextNo,
      status: REPORT_VERSION_STATUS.DRAFT,
      previousVersionId: sourceVersion.id,
      declaredOperatorId: null,
      declaredByUserId: null,
      declaredAt: null,
      grossOutputQty: sourceVersion.grossOutputQty,
      productionScrapQty: sourceVersion.productionScrapQty,
      qtySentToQc: sourceVersion.qtySentToQc,
      remarks: sourceVersion.remarks ?? null,
      zeroProductionReason: sourceVersion.zeroProductionReason ?? null,
      zeroProductionRemarks: sourceVersion.zeroProductionRemarks ?? null,
      lines: {
        create: lineCopyData(sourceVersion.lines),
      },
    },
    include: { lines: { orderBy: { id: "asc" } } },
  });
  await tx.shiftProductionReport.update({
    where: { id: report.id },
    data: { latestVersionNo: nextNo },
  });
  return version;
}

/**
 * Ensure report + editable DRAFT exist. After RETURNED, creates a new DRAFT from the returned version.
 * Never mutates SUBMITTED / RETURNED / VERIFIED versions.
 */
async function ensureEditableDraftVersion(tx, sessionId) {
  const session = await loadSession(tx, sessionId);
  if (session.status === SESSION_STATUS.CANCELLED) {
    throw domainError(
      409,
      "SHIFT_SESSION_ALREADY_CANCELLED",
      "This shift session was cancelled. Open a new shift if work needs to continue.",
    );
  }
  if (session.status === SESSION_STATUS.SHIFT_OVER) {
    throw domainError(
      409,
      "SHIFT_SESSION_NOT_OPEN",
      "This shift session is already closed (Shift Over). Request a controlled reopen to edit the report.",
    );
  }
  if (session.status !== SESSION_STATUS.OPEN) {
    throw domainError(409, "SHIFT_SESSION_NOT_OPEN", "This shift session is not open.");
  }
  const report = await ensureShiftProductionReport(tx, sessionId);
  const latest = await findLatestVersion(tx, report);

  if (!latest) {
    const version = await tx.shiftProductionReportVersion.create({
      data: {
        reportId: report.id,
        versionNo: 1,
        status: REPORT_VERSION_STATUS.DRAFT,
        declaredOperatorId: null,
        declaredByUserId: null,
        declaredAt: null,
        grossOutputQty: 0,
        productionScrapQty: 0,
        qtySentToQc: 0,
      },
      include: { lines: true },
    });
    const updatedReport = await tx.shiftProductionReport.update({
      where: { id: report.id },
      data: { latestVersionNo: 1 },
    });
    return { session, report: updatedReport, version };
  }

  if (latest.status === REPORT_VERSION_STATUS.DRAFT) {
    return { session, report, version: latest };
  }

  if (latest.status === REPORT_VERSION_STATUS.RETURNED) {
    const draft = await createDraftVersionFrom(tx, report, latest);
    const updatedReport = await tx.shiftProductionReport.findUnique({ where: { id: report.id } });
    return { session, report: updatedReport, version: draft };
  }

  if (latest.status === REPORT_VERSION_STATUS.SUBMITTED) {
    throw domainError(
      409,
      "REPORT_AWAITING_MANAGER",
      "This shift report is submitted and waiting for manager return or verify. It cannot be edited.",
    );
  }

  if (latest.status === REPORT_VERSION_STATUS.VERIFIED) {
    throw domainError(
      409,
      "REPORT_ALREADY_VERIFIED",
      "This shift report is verified and cannot be edited. Complete Shift Over, or use controlled reopen after Shift Over.",
    );
  }

  throw domainError(409, "REPORT_STATUS_INVALID", "This shift report cannot be edited in its current status.");
}

/**
 * Save draft lines (no operator declaration). Idempotent overwrite of DRAFT lines only.
 * Zero-production drafts: empty lines + controlled reason (valid idle/worked shift with no output).
 */
async function saveShiftReportDraft(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const remarks = normalizeRemarks(input?.remarks);
  const clientLines = Array.isArray(input?.lines) ? input.lines : [];
  const hasZeroReason =
    input?.zeroProductionReason != null && String(input.zeroProductionReason).trim() !== "";
  const wantsZero = hasZeroReason || Boolean(input?.zeroProduction);

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const { session, report, version } = await ensureEditableDraftVersion(tx, sessionId);
      if (version.status !== REPORT_VERSION_STATUS.DRAFT) {
        throw domainError(409, "REPORT_NOT_DRAFT", "Only a draft shift report can be saved.");
      }
      if (IMMUTABLE_VERSION_STATUSES.has(version.status)) {
        throw domainError(409, "REPORT_VERSION_IMMUTABLE", "Submitted, returned, or verified report versions cannot be changed.");
      }

      const qtyCtx = await loadApprovedQtyContext(tx, sessionId);
      const approvedTotal = approvedQtyTotal(qtyCtx.approvedByLine);

      // Zero-production path: no fake lines.
      if (wantsZero) {
        const reason = normalizeZeroProductionReason(input?.zeroProductionReason, { required: true });
        const zeroRemarks = normalizeZeroProductionRemarks(reason, input?.zeroProductionRemarks);
        await assertZeroProductionEligible(tx, sessionId, { productionScrapQty: 0 });

        await tx.shiftProductionReportVersionLine.deleteMany({ where: { reportVersionId: version.id } });
        const updated = await tx.shiftProductionReportVersion.update({
          where: { id: version.id },
          data: {
            grossOutputQty: 0,
            productionScrapQty: 0,
            qtySentToQc: 0,
            remarks: remarks !== null ? remarks : version.remarks,
            zeroProductionReason: reason,
            zeroProductionRemarks: zeroRemarks,
            declaredOperatorId: null,
            declaredByUserId: null,
            declaredAt: null,
          },
          include: { lines: { orderBy: { id: "asc" } } },
        });

        return {
          session,
          report,
          version: updated,
          declared: false,
          zeroProduction: true,
          pendingDraftCount: qtyCtx.pendingDraftCount,
          pendingDraftQty: qtyCtx.pendingDraftQty,
        };
      }

      // Existing zero draft re-saved without reason while still line-less → keep requiring explicit reason.
      if (clientLines.length === 0 && version.zeroProductionReason) {
        const reason = normalizeZeroProductionReason(version.zeroProductionReason, { required: true });
        const zeroRemarks = normalizeZeroProductionRemarks(
          reason,
          input?.zeroProductionRemarks !== undefined
            ? input.zeroProductionRemarks
            : version.zeroProductionRemarks,
        );
        await assertZeroProductionEligible(tx, sessionId, { productionScrapQty: 0 });
        await tx.shiftProductionReportVersionLine.deleteMany({ where: { reportVersionId: version.id } });
        const updated = await tx.shiftProductionReportVersion.update({
          where: { id: version.id },
          data: {
            grossOutputQty: 0,
            productionScrapQty: 0,
            qtySentToQc: 0,
            remarks: remarks !== null ? remarks : version.remarks,
            zeroProductionReason: reason,
            zeroProductionRemarks: zeroRemarks,
            declaredOperatorId: null,
            declaredByUserId: null,
            declaredAt: null,
          },
          include: { lines: { orderBy: { id: "asc" } } },
        });
        return {
          session,
          report,
          version: updated,
          declared: false,
          zeroProduction: true,
          pendingDraftCount: qtyCtx.pendingDraftCount,
          pendingDraftQty: qtyCtx.pendingDraftQty,
        };
      }

      const runSegmentsById = await loadSessionRunSegmentsMap(tx, sessionId);
      const { lines, totals } = normalizeAndValidateLines(clientLines, {
        sessionId,
        runSegmentsById,
        approvedByLine: qtyCtx.approvedByLine,
      });

      if (input?.productionScrapQty != null) {
        assertHeaderMatchesLines(
          {
            grossOutputQty: totals.grossOutputQty,
            productionScrapQty: toQty(input.productionScrapQty, "Production scrap quantity"),
            qtySentToQc: totals.qtySentToQc,
          },
          totals,
        );
      }

      // Positive production/scrap clears any prior zero-production marking.
      const hasPositive =
        Number(totals.grossOutputQty) > QTY_EPS ||
        Number(totals.productionScrapQty) > QTY_EPS ||
        Number(totals.qtySentToQc) > QTY_EPS ||
        approvedTotal > QTY_EPS;
      const clearZero = hasPositive;

      await tx.shiftProductionReportVersionLine.deleteMany({ where: { reportVersionId: version.id } });
      await tx.shiftProductionReportVersionLine.createMany({
        data: lines.map((l) => ({
          reportVersionId: version.id,
          runSegmentId: l.runSegmentId,
          itemId: l.itemId,
          grossOutputQty: l.grossOutputQty,
          productionScrapQty: l.productionScrapQty,
          qtySentToQc: l.qtySentToQc,
          remarks: l.remarks,
        })),
      });

      const updated = await tx.shiftProductionReportVersion.update({
        where: { id: version.id },
        data: {
          grossOutputQty: totals.grossOutputQty,
          productionScrapQty: totals.productionScrapQty,
          qtySentToQc: totals.qtySentToQc,
          remarks: remarks !== null ? remarks : version.remarks,
          zeroProductionReason: clearZero ? null : version.zeroProductionReason,
          zeroProductionRemarks: clearZero ? null : version.zeroProductionRemarks,
          declaredOperatorId: null,
          declaredByUserId: null,
          declaredAt: null,
        },
        include: { lines: { orderBy: { id: "asc" } } },
      });

      return {
        session,
        report,
        version: updated,
        declared: false,
        zeroProduction: Boolean(updated.zeroProductionReason),
        pendingDraftCount: qtyCtx.pendingDraftCount,
        pendingDraftQty: qtyCtx.pendingDraftQty,
      };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "saveShiftReportDraft" });
  }
}

/**
 * Submit DRAFT → SUBMITTED with mandatory declaration (server declaredAt).
 */
async function submitShiftReport(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const declaredOperatorId = normalizePositiveInt(
    input?.declaredOperatorId,
    "DECLARED_OPERATOR_REQUIRED",
    "Declare the operator who is submitting this shift report.",
  );
  const declaredByUserId = normalizePositiveInt(
    input?.declaredByUserId ?? input?.actorUserId,
    "DECLARED_BY_USER_REQUIRED",
    "The submitting user is required.",
  );
  const versionId =
    input?.versionId == null || input.versionId === ""
      ? null
      : normalizePositiveInt(input.versionId, "VERSION_ID_INVALID", "Report version is not valid.");

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const session = await loadSession(tx, sessionId);
      if (session.status === SESSION_STATUS.CANCELLED) {
        throw domainError(
          409,
          "SHIFT_SESSION_ALREADY_CANCELLED",
          "This shift session was cancelled. Open a new shift if work needs to continue.",
        );
      }
      if (session.status !== SESSION_STATUS.OPEN) {
        throw domainError(409, "SHIFT_SESSION_NOT_OPEN", "Only an open shift session can submit a report.");
      }
      const report = await ensureShiftProductionReport(tx, sessionId);
      let version = versionId
        ? await tx.shiftProductionReportVersion.findUnique({
            where: { id: versionId },
            include: { lines: { orderBy: { id: "asc" } } },
          })
        : await findLatestVersion(tx, report);

      if (!version || version.reportId !== report.id) {
        throw domainError(404, "REPORT_VERSION_NOT_FOUND", "Shift report version was not found.");
      }

      if (version.status === REPORT_VERSION_STATUS.SUBMITTED) {
        return { session, report, version, submitted: false, alreadySubmitted: true };
      }
      if (version.status === REPORT_VERSION_STATUS.VERIFIED) {
        throw domainError(409, "REPORT_ALREADY_VERIFIED", "This shift report is already verified.");
      }
      if (version.status === REPORT_VERSION_STATUS.RETURNED) {
        throw domainError(
          409,
          "REPORT_RETURNED_EDIT_REQUIRED",
          "This report was returned. Save a new draft version before submitting again.",
        );
      }
      if (version.status !== REPORT_VERSION_STATUS.DRAFT) {
        throw domainError(409, "REPORT_NOT_DRAFT", "Only a draft shift report can be submitted.");
      }

      if (!version.lines || version.lines.length === 0) {
        if (!version.zeroProductionReason) {
          throw domainError(400, "REPORT_LINES_REQUIRED", "Add at least one report line before submitting.");
        }

        const qtyCtx = await loadApprovedQtyContext(tx, sessionId);
        assertNoUnapprovedLinkedEntries(qtyCtx);
        await assertZeroProductionEligible(tx, sessionId, {
          productionScrapQty: Number(version.productionScrapQty) || 0,
        });

        await assertOperatorParticipated(tx, sessionId, declaredOperatorId);

        const now = new Date();
        const submitted = await tx.shiftProductionReportVersion.update({
          where: { id: version.id },
          data: {
            status: REPORT_VERSION_STATUS.SUBMITTED,
            declaredOperatorId,
            declaredByUserId,
            declaredAt: now,
            submittedAt: now,
            submittedByUserId: declaredByUserId,
            grossOutputQty: 0,
            productionScrapQty: 0,
            qtySentToQc: 0,
            zeroProductionReason: version.zeroProductionReason,
            zeroProductionRemarks: version.zeroProductionRemarks ?? null,
          },
          include: { lines: { orderBy: { id: "asc" } } },
        });

        return { session, report, version: submitted, submitted: true, alreadySubmitted: false };
      }

      const runSegmentsById = await loadSessionRunSegmentsMap(tx, sessionId);
      const qtyCtx = await loadApprovedQtyContext(tx, sessionId);
      assertNoUnapprovedLinkedEntries(qtyCtx);

      // Recalculate transactionally at submission from current APPROVED PE totals + saved scrap.
      const { lines, totals } = normalizeAndValidateLines(
        version.lines.map((l) => ({
          runSegmentId: l.runSegmentId,
          itemId: l.itemId,
          productionScrapQty: l.productionScrapQty,
          remarks: l.remarks,
        })),
        { sessionId, runSegmentsById, approvedByLine: qtyCtx.approvedByLine },
      );

      const approvedTotal = approvedQtyTotal(qtyCtx.approvedByLine);
      const hasPositive =
        Number(totals.grossOutputQty) > QTY_EPS ||
        Number(totals.productionScrapQty) > QTY_EPS ||
        Number(totals.qtySentToQc) > QTY_EPS ||
        approvedTotal > QTY_EPS;
      if (version.zeroProductionReason && hasPositive) {
        // Positive live production cannot remain marked zero.
        // Fall through with cleared zero fields after recalc.
      }

      await tx.shiftProductionReportVersionLine.deleteMany({ where: { reportVersionId: version.id } });
      await tx.shiftProductionReportVersionLine.createMany({
        data: lines.map((l) => ({
          reportVersionId: version.id,
          runSegmentId: l.runSegmentId,
          itemId: l.itemId,
          grossOutputQty: l.grossOutputQty,
          productionScrapQty: l.productionScrapQty,
          qtySentToQc: l.qtySentToQc,
          remarks: l.remarks,
        })),
      });

      await assertOperatorParticipated(tx, sessionId, declaredOperatorId);

      const now = new Date();
      const submitted = await tx.shiftProductionReportVersion.update({
        where: { id: version.id },
        data: {
          status: REPORT_VERSION_STATUS.SUBMITTED,
          declaredOperatorId,
          declaredByUserId,
          declaredAt: now,
          submittedAt: now,
          submittedByUserId: declaredByUserId,
          grossOutputQty: totals.grossOutputQty,
          productionScrapQty: totals.productionScrapQty,
          qtySentToQc: totals.qtySentToQc,
          zeroProductionReason: hasPositive ? null : version.zeroProductionReason,
          zeroProductionRemarks: hasPositive ? null : version.zeroProductionRemarks,
        },
        include: { lines: { orderBy: { id: "asc" } } },
      });

      return { session, report, version: submitted, submitted: true, alreadySubmitted: false };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "submitShiftReport" });
  }
}

/**
 * Manager return: SUBMITTED → RETURNED (requires returnReason).
 */
async function returnShiftReport(input, db = prisma) {
  const versionId = normalizePositiveInt(input?.versionId, "VERSION_ID_INVALID", "Report version is required.");
  const actorUserId = normalizePositiveInt(
    input?.returnedByUserId ?? input?.actorUserId,
    "USER_ID_INVALID",
    "The returning manager user is required.",
  );
  const returnReason = normalizeChangeReason(input?.returnReason, {
    required: true,
    message: "A return reason is required when sending the shift report back.",
  });

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const version = await tx.shiftProductionReportVersion.findUnique({
        where: { id: versionId },
        include: { lines: { orderBy: { id: "asc" } }, report: true },
      });
      if (!version) {
        throw domainError(404, "REPORT_VERSION_NOT_FOUND", "Shift report version was not found.");
      }

      if (version.status === REPORT_VERSION_STATUS.RETURNED) {
        return { version, returned: false, alreadyReturned: true };
      }
      if (version.status === REPORT_VERSION_STATUS.VERIFIED) {
        throw domainError(409, "REPORT_ALREADY_VERIFIED", "A verified shift report cannot be returned.");
      }
      if (version.status !== REPORT_VERSION_STATUS.SUBMITTED) {
        throw domainError(409, "REPORT_NOT_SUBMITTED", "Only a submitted shift report can be returned.");
      }

      const now = new Date();
      const updated = await tx.shiftProductionReportVersion.update({
        where: { id: version.id },
        data: {
          status: REPORT_VERSION_STATUS.RETURNED,
          returnedAt: now,
          returnedByUserId: actorUserId,
          returnReason,
        },
        include: { lines: { orderBy: { id: "asc" } } },
      });
      return { version: updated, returned: true, alreadyReturned: false };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "returnShiftReport" });
  }
}

/**
 * Manager verify: SUBMITTED → VERIFIED. Returned cannot be verified.
 */
async function verifyShiftReport(input, db = prisma) {
  const versionId = normalizePositiveInt(input?.versionId, "VERSION_ID_INVALID", "Report version is required.");
  const actorUserId = normalizePositiveInt(
    input?.verifiedByUserId ?? input?.actorUserId,
    "USER_ID_INVALID",
    "The verifying manager user is required.",
  );

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const version = await tx.shiftProductionReportVersion.findUnique({
        where: { id: versionId },
        include: { lines: { orderBy: { id: "asc" } } },
      });
      if (!version) {
        throw domainError(404, "REPORT_VERSION_NOT_FOUND", "Shift report version was not found.");
      }

      if (version.status === REPORT_VERSION_STATUS.VERIFIED) {
        return { version, verified: false, alreadyVerified: true };
      }
      if (version.status === REPORT_VERSION_STATUS.RETURNED) {
        throw domainError(
          409,
          "REPORT_RETURNED_CANNOT_VERIFY",
          "A returned shift report cannot be verified. The operator must submit a new draft first.",
        );
      }
      if (version.status !== REPORT_VERSION_STATUS.SUBMITTED) {
        throw domainError(409, "REPORT_NOT_SUBMITTED", "Only a submitted shift report can be verified.");
      }

      const now = new Date();
      const updated = await tx.shiftProductionReportVersion.update({
        where: { id: version.id },
        data: {
          status: REPORT_VERSION_STATUS.VERIFIED,
          verifiedAt: now,
          verifiedByUserId: actorUserId,
        },
        include: { lines: { orderBy: { id: "asc" } } },
      });
      return { version: updated, verified: true, alreadyVerified: false };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "verifyShiftReport" });
  }
}

module.exports = {
  REPORT_VERSION_STATUS,
  ZERO_PRODUCTION_REASONS,
  IMMUTABLE_VERSION_STATUSES,
  QTY_EPS,
  toQty,
  qtyEqual,
  normalizeRemarks,
  normalizeZeroProductionReason,
  normalizeZeroProductionRemarks,
  normalizeAndValidateLines,
  normalizeProposedAdjustmentLines,
  assertHeaderMatchesLines,
  assertZeroProductionEligible,
  loadSessionRunSegmentsMap,
  ensureShiftProductionReport,
  ensureEditableDraftVersion,
  createDraftVersionFrom,
  findLatestVersion,
  saveShiftReportDraft,
  submitShiftReport,
  returnShiftReport,
  verifyShiftReport,
};
