const { prisma } = require("../utils/prisma");
const { isMaterialRequirementFullyReceived } = require("./procurementLifecycleService");

const RM_REQUISITION_DRAFT_STATUSES = Object.freeze(["DRAFT", "PENDING_APPROVAL"]);
const RM_REQUISITION_PURCHASE_VISIBLE_STATUSES = Object.freeze([
  "APPROVED",
  "SENT_TO_PURCHASE",
  "PROCUREMENT_IN_PROGRESS",
  "PARTIALLY_PROCURED",
]);
const RM_REQUISITION_PURCHASE_REQUEST_ALLOWED_STATUSES = Object.freeze(["APPROVED", "SENT_TO_PURCHASE"]);
const RM_REQUISITION_ACTIVE_STATUSES = Object.freeze([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT_TO_PURCHASE",
  "PROCUREMENT_IN_PROGRESS",
  "PARTIALLY_PROCURED",
  "FULLY_PROCURED",
]);
const RM_REQUISITION_TERMINAL_STATUSES = Object.freeze(["CLOSED", "CANCELLED"]);

function isPurchaseVisibleRmRequisitionStatus(status) {
  return RM_REQUISITION_PURCHASE_VISIBLE_STATUSES.includes(String(status || ""));
}

function assertRmRequisitionPurchaseVisible(mr) {
  if (isPurchaseVisibleRmRequisitionStatus(mr?.status)) return;
  const err = new Error(
    `RM Requisition ${mr?.docNo || mr?.id || ""} is not approved for Purchase.`,
  );
  err.statusCode = 400;
  err.code = "RM_REQUISITION_NOT_APPROVED";
  throw err;
}

function assertRmRequisitionCanCreatePurchaseRequest(mr) {
  if (RM_REQUISITION_PURCHASE_REQUEST_ALLOWED_STATUSES.includes(String(mr?.status || ""))) return;
  const err = new Error(
    `RM Requisition ${mr?.docNo || mr?.id || ""} must be Store-approved and sent before Purchase Request creation.`,
  );
  err.statusCode = 400;
  err.code = "RM_REQUISITION_NOT_SENT_TO_PURCHASE";
  throw err;
}

function rmRequisitionStatusLabel(status) {
  switch (status) {
    case "DRAFT":
      return "Draft RM Requisition";
    case "PENDING_APPROVAL":
      return "Pending Store Approval";
    case "APPROVED":
      return "Approved by Store";
    case "SENT_TO_PURCHASE":
      return "Sent to Purchase";
    case "PROCUREMENT_IN_PROGRESS":
      return "Procurement in Progress";
    case "PARTIALLY_PROCURED":
      return "Partially Procured";
    case "FULLY_PROCURED":
      return "Fully Procured";
    case "CLOSED":
      return "Closed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return String(status || "Draft");
  }
}

function mapRmRequisition(row) {
  if (!row) return null;
  return {
    id: row.id,
    docNo: row.docNo,
    status: row.status,
    statusLabel: rmRequisitionStatusLabel(row.status),
    sourceType: row.sourceType,
    salesOrderId: row.salesOrderId,
    workOrderId: row.workOrderId,
    requiredDate: row.requiredDate,
    raisedByUserId: row.raisedByUserId,
    approvedByUserId: row.approvedByUserId,
    approvedAt: row.approvedAt,
    sentToPurchaseAt: row.sentToPurchaseAt,
    closedAt: row.closedAt,
    requisitionRemarks: row.requisitionRemarks,
    approvalRemarks: row.approvalRemarks,
  };
}

function isWorkOrderTerminalForRmClosure(status) {
  return ["REJECTED", "CLOSED_WITH_SHORTFALL", "COMPLETED"].includes(String(status || ""));
}

function isSalesOrderClosedForRmClosure(status) {
  return ["COMPLETED", "CLOSED", "MANUALLY_CLOSED"].includes(String(status || ""));
}

function buildRmCloseBlockedMessage(mr) {
  const mrRef = mr?.docNo ? `MR ${mr.docNo}` : mr?.id ? `MR #${mr.id}` : "RM Requisition";
  const soRef = mr?.salesOrder?.docNo
    ? `SO ${mr.salesOrder.docNo}`
    : mr?.salesOrderId
      ? `SO #${mr.salesOrderId}`
      : null;
  const woRef = mr?.workOrder?.docNo
    ? `WO ${mr.workOrder.docNo}`
    : mr?.workOrderId
      ? `WO #${mr.workOrderId}`
      : null;
  const suffix = [soRef, woRef].filter(Boolean).join(", ");
  return `Cannot close ${mrRef} while the shortage is unresolved${suffix ? ` (${suffix})` : ""}. Complete procurement/GRN, close the SO/WO, or use admin override.`;
}

async function transitionRmRequisition(id, transition, actor = {}, db = prisma) {
  const mrId = Number(id);
  if (!Number.isFinite(mrId) || mrId <= 0) {
    const err = new Error("RM Requisition id is required.");
    err.statusCode = 400;
    throw err;
  }

  return db.$transaction(async (tx) => {
    const mr = await tx.materialRequirement.findUnique({
      where: { id: mrId },
      include: {
        salesOrder: { select: { id: true, docNo: true, internalStatus: true } },
        workOrder: { select: { id: true, docNo: true, status: true } },
        lines: {
          include: {
            procurementLinks: {
              include: {
                rmPoLine: {
                  include: {
                    rmPo: { select: { id: true, status: true } },
                    grnLines: { include: { grn: { select: { id: true, reversedAt: true } } } },
                  },
                },
              },
            },
            purchaseRequestSourceLinks: {
              include: {
                purchaseRequestLine: {
                  include: {
                    sourceLinks: true,
                    poLinks: {
                      include: {
                        rmPoLine: {
                          include: {
                            rmPo: { select: { id: true, status: true } },
                            grnLines: { include: { grn: { select: { id: true, reversedAt: true } } } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!mr) {
      const err = new Error("RM Requisition not found.");
      err.statusCode = 404;
      throw err;
    }
    if (transition !== "reopen" && mr.status === "CANCELLED") {
      const err = new Error("Cancelled RM Requisition cannot be changed.");
      err.statusCode = 400;
      throw err;
    }

    const now = new Date();
    const remarks = actor.remarks?.trim() || null;
    let data;

    if (transition === "approve") {
      if (!["DRAFT", "PENDING_APPROVAL"].includes(mr.status)) {
        const err = new Error("Only draft or pending approval RM Requisitions can be approved.");
        err.statusCode = 400;
        throw err;
      }
      data = {
        status: "APPROVED",
        approvedByUserId: actor.userId ?? null,
        approvedAt: now,
        approvalRemarks: remarks ?? mr.approvalRemarks ?? null,
      };
    } else if (transition === "send") {
      if (mr.status !== "APPROVED") {
        const err = new Error("Only Store-approved RM Requisitions can be sent to Purchase.");
        err.statusCode = 400;
        throw err;
      }
      data = {
        status: "SENT_TO_PURCHASE",
        sentToPurchaseAt: now,
      };
    } else if (transition === "reopen") {
      if (!["APPROVED", "SENT_TO_PURCHASE"].includes(mr.status)) {
        const err = new Error("Only approved or sent RM Requisitions can be reopened before procurement starts.");
        err.statusCode = 400;
        throw err;
      }
      data = {
        status: "PENDING_APPROVAL",
        approvedByUserId: null,
        approvedAt: null,
        sentToPurchaseAt: null,
        approvalRemarks: remarks ?? mr.approvalRemarks ?? null,
      };
    } else if (transition === "close") {
      if (RM_REQUISITION_TERMINAL_STATUSES.includes(mr.status)) {
        const err = new Error("RM Requisition is already closed or cancelled.");
        err.statusCode = 400;
        throw err;
      }
      const adminOverride = String(actor.role || "").toUpperCase() === "ADMIN";
      const shortageResolved = isMaterialRequirementFullyReceived(mr);
      const workOrderClosed = isWorkOrderTerminalForRmClosure(mr.workOrder?.status);
      const salesOrderClosed = isSalesOrderClosedForRmClosure(mr.salesOrder?.internalStatus);
      if (!adminOverride && !shortageResolved && !workOrderClosed && !salesOrderClosed) {
        const err = new Error(buildRmCloseBlockedMessage(mr));
        err.statusCode = 400;
        err.code = "RM_REQUISITION_CLOSE_BLOCKED";
        throw err;
      }
      data = {
        status: "CLOSED",
        closedAt: now,
        remarks: [mr.remarks, remarks].filter(Boolean).join("\n") || mr.remarks,
      };
    } else {
      const err = new Error("Unsupported RM Requisition transition.");
      err.statusCode = 400;
      throw err;
    }

    const updated = await tx.materialRequirement.update({
      where: { id: mrId },
      data,
      include: { lines: true },
    });
    return { rmRequisition: mapRmRequisition(updated), materialRequirement: updated };
  });
}

module.exports = {
  RM_REQUISITION_DRAFT_STATUSES,
  RM_REQUISITION_PURCHASE_VISIBLE_STATUSES,
  RM_REQUISITION_PURCHASE_REQUEST_ALLOWED_STATUSES,
  RM_REQUISITION_ACTIVE_STATUSES,
  RM_REQUISITION_TERMINAL_STATUSES,
  isPurchaseVisibleRmRequisitionStatus,
  assertRmRequisitionPurchaseVisible,
  assertRmRequisitionCanCreatePurchaseRequest,
  rmRequisitionStatusLabel,
  mapRmRequisition,
  transitionRmRequisition,
};
