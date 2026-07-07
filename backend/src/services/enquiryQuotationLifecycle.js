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

module.exports = {
  markEnquiryQuotedOnQuotationApproval,
  reopenEnquiryToFeasibleAfterQuotationRollback,
  applyEnquiryStatusForQuotationWorkflowTransition,
};
