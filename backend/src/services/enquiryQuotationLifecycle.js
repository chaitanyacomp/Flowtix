/**
 * Enquiry funnel status transitions driven by quotation.workflowStatus only.
 * Quotation.status (legacy SimpleStatus) is not used for workflow decisions.
 */

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} enquiryId
 */
async function markEnquiryQuotedOnQuotationApproval(tx, enquiryId) {
  const id = Number(enquiryId);
  if (!Number.isFinite(id) || id <= 0) return;

  const enquiry = await tx.enquiry.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!enquiry) {
    const err = new Error("Enquiry not found");
    err.statusCode = 404;
    throw err;
  }
  if (enquiry.status === "QUOTED") return;

  await tx.enquiry.update({
    where: { id },
    data: { status: "QUOTED" },
  });
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} enquiryId
 */
async function reopenEnquiryToFeasibleAfterQuotationRollback(tx, enquiryId) {
  const id = Number(enquiryId);
  if (!Number.isFinite(id) || id <= 0) return;

  const enquiry = await tx.enquiry.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!enquiry) {
    const err = new Error("Enquiry not found");
    err.statusCode = 404;
    throw err;
  }
  if (enquiry.status === "FEASIBLE") return;

  await tx.enquiry.update({
    where: { id },
    data: { status: "FEASIBLE" },
  });
}

/**
 * Apply enquiry funnel status when quotation.workflowStatus changes.
 * Enquiry → QUOTED only on first transition to APPROVED.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number | null | undefined} enquiryId
 * @param {{ previousWorkflowStatus: string; nextWorkflowStatus: string }} transition
 */
async function applyEnquiryStatusForQuotationWorkflowTransition(
  tx,
  enquiryId,
  { previousWorkflowStatus, nextWorkflowStatus },
) {
  if (enquiryId == null) return;

  if (nextWorkflowStatus === "APPROVED" && previousWorkflowStatus !== "APPROVED") {
    await markEnquiryQuotedOnQuotationApproval(tx, enquiryId);
    return;
  }
  if (nextWorkflowStatus === "REJECTED" && previousWorkflowStatus !== "REJECTED") {
    await reopenEnquiryToFeasibleAfterQuotationRollback(tx, enquiryId);
  }
}

/**
 * After hard-deleting the only SO linked to an approved quotation, restore enquiry to QUOTED
 * so the quotation remains Ready-for-SO without an orphan CLOSED enquiry.
 * Quotation workflowStatus is left APPROVED (Undo Approval is unchanged).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ quotationId: number | null | undefined; enquiryId?: number | null }} args
 * @returns {Promise<{ restored: boolean; enquiryId: number | null; fromStatus: string | null; toStatus: string | null }>}
 */
async function restoreEnquiryQuotedAfterLinkedSoDeleted(tx, { quotationId, enquiryId }) {
  const qid = Number(quotationId);
  if (!Number.isFinite(qid) || qid <= 0) {
    return { restored: false, enquiryId: null, fromStatus: null, toStatus: null };
  }

  const quotation = await tx.quotation.findUnique({
    where: { id: qid },
    select: {
      id: true,
      workflowStatus: true,
      enquiryId: true,
      salesOrder: { select: { id: true } },
    },
  });
  if (!quotation || quotation.workflowStatus !== "APPROVED") {
    return { restored: false, enquiryId: null, fromStatus: null, toStatus: null };
  }
  if (quotation.salesOrder) {
    return { restored: false, enquiryId: quotation.enquiryId ?? null, fromStatus: null, toStatus: null };
  }

  const eid = Number(enquiryId ?? quotation.enquiryId);
  if (!Number.isFinite(eid) || eid <= 0) {
    return { restored: false, enquiryId: null, fromStatus: null, toStatus: null };
  }

  const enquiry = await tx.enquiry.findUnique({
    where: { id: eid },
    select: { id: true, status: true },
  });
  if (!enquiry) {
    return { restored: false, enquiryId: eid, fromStatus: null, toStatus: null };
  }
  if (enquiry.status === "QUOTED") {
    return { restored: false, enquiryId: eid, fromStatus: "QUOTED", toStatus: "QUOTED" };
  }

  await tx.enquiry.update({
    where: { id: eid },
    data: { status: "QUOTED" },
  });
  return { restored: true, enquiryId: eid, fromStatus: enquiry.status, toStatus: "QUOTED" };
}

/**
 * Cleanup compensation: when SOs are wiped but quotations/enquiries are retained,
 * restore CLOSED (etc.) enquiries to QUOTED for approved quotations that no longer have an SO.
 * No-op when the cleanup also deletes the quotation/enquiry chain.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ quotationIds?: number[] }} [opts] When set, only those quotations; otherwise all APPROVED with no SO.
 * @returns {Promise<{ restoredEnquiryIds: number[] }>}
 */
async function restoreOrphanClosedEnquiriesForRetainedApprovedQuotations(tx, opts = {}) {
  const rawIds = Array.isArray(opts.quotationIds) ? opts.quotationIds : null;
  const quotationIds =
    rawIds == null
      ? null
      : [...new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];

  const quotations = await tx.quotation.findMany({
    where: {
      workflowStatus: "APPROVED",
      ...(quotationIds && quotationIds.length ? { id: { in: quotationIds } } : {}),
      salesOrder: null,
    },
    select: { id: true, enquiryId: true, enquiry: { select: { id: true, status: true } } },
  });

  /** @type {number[]} */
  const restoredEnquiryIds = [];
  for (const q of quotations) {
    const enquiry = q.enquiry;
    if (!enquiry || enquiry.status === "QUOTED") continue;
    // Only compensate conversion orphans (CLOSED). Do not reopen FEASIBLE / NOT_FEASIBLE / etc.
    if (enquiry.status !== "CLOSED") continue;
    await tx.enquiry.update({
      where: { id: enquiry.id },
      data: { status: "QUOTED" },
    });
    restoredEnquiryIds.push(enquiry.id);
  }
  return { restoredEnquiryIds };
}

module.exports = {
  markEnquiryQuotedOnQuotationApproval,
  reopenEnquiryToFeasibleAfterQuotationRollback,
  applyEnquiryStatusForQuotationWorkflowTransition,
  restoreEnquiryQuotedAfterLinkedSoDeleted,
  restoreOrphanClosedEnquiriesForRetainedApprovedQuotations,
};
