const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const auditLog = require("../services/auditLog");
const {
  listSalesBills,
  getEligibleDispatches,
  createDraftFromDispatch,
  updateDraft,
  finalizeBill,
  cancelBill,
  deleteDraft,
  getSalesBillById,
} = require("../services/salesBillService");
const { mapSalesBillToTallyExportPayload } = require("../services/salesBillTallyExportPayload");
const { buildSalesBillTallyXml } = require("../services/salesBillTallyXml");
const { logActivity } = require("../services/activityLogService");
const {
  ACTIVITY_MODULES,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
} = require("../constants/activityLogConstants");
const { displaySalesBillNo } = require("../utils/docNoLabels");
const { assertAdminPassword } = require("../services/adminPasswordAuth");

const salesBillsRouter = express.Router();

function friendly400(message) {
  return { error: { message } };
}

function toNum(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function isNonEmptyStr(v) {
  return typeof v === "string" && v.trim() !== "";
}

function validateTallyExportEligibility({ bill, payload }) {
  if (!bill) return "Sales bill not found.";
  if (bill.status !== "FINALIZED") return "Only finalized Sales Bills can be exported.";
  if (!bill.customer) return "Cannot export sales bill because customer is missing.";
  const stateCode = bill.customer?.stateRef?.stateCode ?? bill.customerStateCodeSnapshot ?? null;
  if (!isNonEmptyStr(stateCode)) return "Cannot export sales bill because customer state is missing.";
  const lines = Array.isArray(bill.lines) ? bill.lines : [];
  if (!lines.length) return "Cannot export sales bill because it has no line items.";
  for (const ln of lines) {
    const q = toNum(ln.qty);
    if (!Number.isFinite(q) || q <= 0) {
      return "Sales Bill has no valid quantity to export.";
    }
  }
  for (const ln of lines) {
    if (!isNonEmptyStr(ln.itemNameSnapshot) || !isNonEmptyStr(ln.hsnCodeSnapshot)) {
      return "Cannot export sales bill because tax data is incomplete.";
    }
    const g = toNum(ln.gstRate);
    if (!Number.isFinite(g) || g < 0 || g > 100) {
      return "Cannot export sales bill because tax data is incomplete.";
    }
  }
  const net = toNum(payload?.tax?.totalAmount);
  if (!Number.isFinite(net) || net <= 0) return "Cannot export sales bill because totals are invalid.";

  // NO_QTY: must be dispatch-derived (phase 1 bills are dispatch-wise).
  if (payload?.meta?.orderType === "NO_QTY") {
    if (!bill.dispatchId || !Number.isFinite(Number(bill.dispatchId))) {
      return "Billing quantity must be based on dispatch.";
    }
  }
  return null;
}

salesBillsRouter.get("/", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const rows = await listSalesBills(prisma, req.query);
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.get("/eligible-dispatches", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const rows = await getEligibleDispatches(prisma);
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.get("/:id", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bill = await getSalesBillById(prisma, id);
    return res.json(bill);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.post("/from-dispatch/:dispatchId", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const dispatchId = Number(req.params.dispatchId);
    const { bill, created } = await createDraftFromDispatch(prisma, dispatchId);
    if (created) {
      const sbDoc = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
      await logActivity({
        user: req.user,
        module: ACTIVITY_MODULES.SALES_BILL,
        entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
        entityId: bill.id,
        docNo: sbDoc,
        action: ACTIVITY_ACTIONS.CREATED,
        message: `Sales Bill ${sbDoc} created`,
        metadata: {
          customerId: bill.customerId,
          customerName: bill.customerNameSnapshot || bill.customer?.name,
          dispatchIds: bill.dispatchId != null ? [bill.dispatchId] : undefined,
          totalAmount: bill.netAmount != null ? String(bill.netAmount) : undefined,
        },
      });
    }
    if (created && req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `SALES_BILL:${bill.id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Sales bill ${bill.billNo || `SB-${bill.id}`} created from dispatch #${dispatchId}`,
        payload: {
          module: "SALES",
          actionLabel: "CREATE",
          ref: { type: "SALES_BILL", id: String(bill.id), no: bill.billNo || `SB-${bill.id}` },
          snapshot: { dispatchId, status: bill.status },
          status: { from: null, to: bill.status },
        },
      });
    }
    return res.status(created ? 201 : 200).json({ id: bill.id });
  } catch (e) {
    return next(e);
  }
});

const dateInput = z.union([z.string().min(1), z.number(), z.coerce.date()]);

salesBillsRouter.put("/:id", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    // Dispatch-wise billing: line qty/rate are source-based and cannot be edited in phase 1.
    if (req.body && typeof req.body === "object" && "lines" in req.body) {
      return res.status(400).json(friendly400("Sales Bill line rate/qty cannot be edited. Edit the source (Sales Order) instead."));
    }
    const schema = z.object({
      billNo: z.string().max(128).optional().nullable(),
      billDate: dateInput,
      remarks: z.string().max(4000).optional().nullable(),
    });
    const body = schema.parse(req.body);
    const updated = await updateDraft(prisma, id, body);
    if (req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `SALES_BILL:${id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Sales bill ${updated.billNo || `SB-${id}`} updated`,
        payload: {
          module: "SALES",
          actionLabel: "UPDATE",
          ref: { type: "SALES_BILL", id: String(id), no: updated.billNo || `SB-${id}` },
        },
      });
    }
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.post("/:id/finalize", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const finalized = await finalizeBill(prisma, id, req.user?.userId);
    const sbDoc = displaySalesBillNo(id, finalized.billNo, finalized.docNo);
    await logActivity({
      user: req.user,
      module: ACTIVITY_MODULES.SALES_BILL,
      entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
      entityId: id,
      docNo: sbDoc,
      action: ACTIVITY_ACTIONS.FINALIZED,
      message: `Sales Bill ${sbDoc} finalized`,
      metadata: {
        customerId: finalized.customerId,
        customerName: finalized.customerNameSnapshot || finalized.customer?.name,
        dispatchIds: finalized.dispatchId != null ? [finalized.dispatchId] : undefined,
        totalAmount: finalized.netAmount != null ? String(finalized.netAmount) : undefined,
      },
    });
    if (req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.APPROVE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `SALES_BILL:${id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Sales bill ${finalized.billNo || `SB-${id}`} finalized`,
        payload: {
          module: "SALES",
          actionLabel: "FINALIZE",
          ref: { type: "SALES_BILL", id: String(id), no: finalized.billNo || `SB-${id}` },
          status: { from: "DRAFT", to: "FINALIZED" },
        },
      });
    }
    return res.json(finalized);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.post("/:id/cancel", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = z.object({ reason: z.string().min(1), adminPassword: z.string().min(1).optional() }).parse(req.body);
    const bill = await prisma.salesBill.findUnique({ where: { id }, select: { id: true, isExported: true } });
    if (!bill) return res.status(404).json(friendly400("Sales bill not found."));
    if (bill.isExported) {
      if (req.user?.role !== "ADMIN") return res.status(409).json(friendly400("Cannot cancel: this sales bill has already been exported."));
      await assertAdminPassword(prisma, { userId: req.user?.userId, password: body.adminPassword });
    }
    const updated = await cancelBill(prisma, id, { reason: body.reason, userId: req.user?.userId });
    const reason = String(body.reason || "").trim();
    const sbDoc = displaySalesBillNo(id, updated.billNo, updated.docNo);
    await logActivity({
      user: req.user,
      module: ACTIVITY_MODULES.SALES_BILL,
      entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
      entityId: id,
      docNo: sbDoc,
      action: ACTIVITY_ACTIONS.CANCELLED,
      message: `Sales Bill ${sbDoc} cancelled`,
      reason,
      metadata: {
        customerId: updated.customerId,
        customerName: updated.customerNameSnapshot || updated.customer?.name,
      },
    });
    if (req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.CANCEL,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `SALES_BILL:${id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Sales bill ${updated.billNo || `SB-${id}`} cancelled`,
        reason: reason || null,
        payload: {
          module: "SALES",
          actionLabel: "CANCEL",
          ref: { type: "SALES_BILL", id: String(id), no: updated.billNo || `SB-${id}` },
          status: { from: "FINALIZED", to: "CANCELLED" },
        },
      });
    }
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.delete("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await deleteDraft(prisma, id);
    if (req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.DELETE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `SALES_BILL:${id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Sales bill SB-${id} deleted (draft)`,
        payload: { module: "SALES", actionLabel: "DELETE", ref: { type: "SALES_BILL", id: String(id), no: `SB-${id}` } },
      });
    }
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.get("/:id/export/tally.xml", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid sales bill id"));

    const bill = await prisma.salesBill.findUnique({
      where: { id },
      include: {
        customer: { include: { stateRef: true } },
        dispatch: { include: { salesOrder: true } },
        lines: { include: { item: true }, orderBy: { id: "asc" } },
      },
    });
    if (!bill) return res.status(404).json(friendly400("Sales bill not found"));
    if (bill.isExported) {
      return res.status(400).json(
        friendly400("This sales bill has already been exported. Reset export to export again."),
      );
    }

    const companyState = await prisma.appSetting.findUnique({
      where: { id: 1 },
      select: {
        companyGstin: true,
        companyState: true,
        companyStateRef: { select: { id: true, stateName: true, stateCode: true } },
      },
    });

    const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
    const errMsg = validateTallyExportEligibility({ bill, payload });
    if (errMsg) {
      const sbDoc = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
      await logActivity({
        user: req.user,
        module: ACTIVITY_MODULES.SALES_BILL,
        entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
        entityId: bill.id,
        docNo: sbDoc,
        action: ACTIVITY_ACTIONS.EXPORT_FAILED,
        message: `Sales Bill ${sbDoc} Tally export failed`,
        metadata: { error: String(errMsg).slice(0, 240) },
      });
      return res.status(400).json(friendly400(errMsg));
    }

    const xml = buildSalesBillTallyXml(payload);
    const safeNo = String(bill.billNo || `SB-${bill.id}`).replace(/[^\w\-\.]+/g, "-");
    const filename = `sales-bill-${safeNo}.xml`;

    // Atomic flip: only the first successful exporter logs EXPORTED (avoids duplicate rows on double-submit or racing paths).
    const flipResult = await prisma.salesBill.updateMany({
      where: { id: bill.id, isExported: false },
      data: { isExported: true, exportedAt: new Date(), exportedFileName: filename, exportedById: req.user?.userId ?? null },
    });
    const sbDocOk = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
    if (flipResult.count === 1) {
      await logActivity({
        user: req.user,
        module: ACTIVITY_MODULES.SALES_BILL,
        entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
        entityId: bill.id,
        docNo: sbDocOk,
        action: ACTIVITY_ACTIONS.EXPORTED,
        message: `Sales Bill ${sbDocOk} exported to Tally`,
        metadata: { fileName: filename, dispatchIds: bill.dispatchId != null ? [bill.dispatchId] : undefined },
      });
      if (req.user?.userId) {
        await auditLog.write(prisma, {
          action: auditLog.AuditAction.UPDATE,
          entityType: auditLog.AuditEntityType.SETTINGS,
          entityId: `SALES_BILL:${bill.id}`,
          actorUserId: req.user.userId,
          actorRole: req.user.role,
          summary: `Sales bill ${bill.billNo || `SB-${bill.id}`} exported to Tally XML`,
          payload: {
            module: "REPORTS",
            actionLabel: "EXPORT",
            ref: { type: "TALLY_EXPORT", id: String(bill.id), no: filename },
            snapshot: { salesBillId: bill.id, dispatchId: bill.dispatchId ?? null, fileName: filename },
          },
        });
      }
    }

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    return res.status(200).send(xml);
  } catch (e) {
    return next(e);
  }
});

/**
 * Download Tally XML for an already-exported bill (does not flip export flags).
 * GET /api/sales-bills/:id/download/tally.xml
 */
salesBillsRouter.get("/:id/download/tally.xml", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid sales bill id"));

    const bill = await prisma.salesBill.findUnique({
      where: { id },
      include: {
        customer: { include: { stateRef: true } },
        dispatch: { include: { salesOrder: true } },
        lines: { include: { item: true }, orderBy: { id: "asc" } },
      },
    });
    if (!bill) return res.status(404).json(friendly400("Sales bill not found"));
    if (!bill.isExported) return res.status(400).json(friendly400("This sales bill is not exported yet."));

    const companyState = await prisma.appSetting.findUnique({
      where: { id: 1 },
      select: {
        companyGstin: true,
        companyState: true,
        companyStateRef: { select: { id: true, stateName: true, stateCode: true } },
      },
    });

    const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
    const errMsg = validateTallyExportEligibility({ bill, payload });
    if (errMsg) return res.status(400).json(friendly400(errMsg));

    const xml = buildSalesBillTallyXml(payload);
    const filename =
      (typeof bill.exportedFileName === "string" && bill.exportedFileName.trim() ? bill.exportedFileName.trim() : null) ??
      `sales-bill-${String(bill.billNo || `SB-${bill.id}`).replace(/[^\w\-\.]+/g, "-")}.xml`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    return res.status(200).send(xml);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.post("/:id/reset-export", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = z.object({ reason: z.string().min(1) }).parse(req.body);
    const reason = body.reason.trim();
    if (!reason) return res.status(400).json(friendly400("Reason is required."));
    const bill = await prisma.salesBill.findUnique({ where: { id } });
    if (!bill) return res.status(404).json(friendly400("Sales bill not found"));
    if (!bill.isExported) return res.status(400).json(friendly400("This sales bill is not exported."));
    await prisma.salesBill.update({
      where: { id },
      data: { isExported: false, exportResetAt: new Date(), exportResetReason: reason, exportResetById: req.user?.userId ?? null },
    });
    if (req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `SALES_BILL:${id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Sales bill SB-${id} export status reset`,
        reason,
        payload: { module: "ADMIN", actionLabel: "OVERRIDE", ref: { type: "SALES_BILL", id: String(id), no: `SB-${id}` } },
      });
    }
    return res.json({ message: "Export status reset. You can export this bill again." });
  } catch (e) {
    return next(e);
  }
});

/**
 * Export Sales Bill XML by dispatch id (dispatch-wise billing).
 * POST /api/sales-bills/:dispatchId/export-tally
 *
 * Creates the bill from dispatch if missing, finalizes if draft, then exports.
 */
salesBillsRouter.post("/:dispatchId/export-tally", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const dispatchId = Number(req.params.dispatchId);
    if (!Number.isFinite(dispatchId) || dispatchId <= 0) return res.status(400).json(friendly400("Invalid dispatch id"));

    // Must be a completed (locked) forward dispatch row.
    const dispatchRow = await prisma.dispatch.findUnique({
      where: { id: dispatchId },
      select: { id: true, workflowStatus: true, reversalOfId: true, dispatchedQty: true },
    });
    if (!dispatchRow) return res.status(404).json(friendly400("Dispatch not found"));
    if (dispatchRow.reversalOfId != null) return res.status(409).json(friendly400("Cannot export from a reversal dispatch row."));
    if (dispatchRow.workflowStatus !== "LOCKED") return res.status(409).json(friendly400("Only finalized (completed) dispatch can be exported."));
    if (!(Number(dispatchRow.dispatchedQty) > 0)) return res.status(409).json(friendly400("Dispatch quantity must be positive to export."));

    // Ensure bill exists (dispatch-wise) and is finalized.
    const { bill } = await createDraftFromDispatch(prisma, dispatchId);
    const ensured = bill.status === "DRAFT" ? await finalizeBill(prisma, bill.id, req.user?.userId) : bill;
    if (ensured.status !== "FINALIZED") return res.status(409).json(friendly400("Only finalized Sales Bills can be exported."));

    const fullBill = await prisma.salesBill.findUnique({
      where: { id: ensured.id },
      include: { customer: { include: { stateRef: true } }, lines: { include: { item: true }, orderBy: { id: "asc" } } },
    });
    if (!fullBill) return res.status(404).json(friendly400("Sales bill not found"));
    if (fullBill.isExported) {
      return res.status(400).json(friendly400("This sales bill has already been exported. Reset export to export again."));
    }

    const companyState = await prisma.appSetting.findUnique({
      where: { id: 1 },
      select: {
        companyGstin: true,
        companyState: true,
        companyStateRef: { select: { id: true, stateName: true, stateCode: true } },
      },
    });

    const payload = mapSalesBillToTallyExportPayload({ bill: fullBill, companyState });
    const errMsg = validateTallyExportEligibility({ bill: fullBill, payload });
    if (errMsg) {
      const sbDoc = displaySalesBillNo(fullBill.id, fullBill.billNo, fullBill.docNo);
      await logActivity({
        user: req.user,
        module: ACTIVITY_MODULES.SALES_BILL,
        entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
        entityId: fullBill.id,
        docNo: sbDoc,
        action: ACTIVITY_ACTIONS.EXPORT_FAILED,
        message: `Sales Bill ${sbDoc} Tally export failed`,
        metadata: { error: String(errMsg).slice(0, 240), dispatchId },
      });
      return res.status(400).json(friendly400(errMsg));
    }

    const xml = buildSalesBillTallyXml(payload);
    const safeNo = String(fullBill.billNo || `SB-${fullBill.id}`).replace(/[^\w\-\.]+/g, "-");
    const filename = `sales-bill-${safeNo}.xml`;

    const flipResult = await prisma.salesBill.updateMany({
      where: { id: fullBill.id, isExported: false },
      data: { isExported: true, exportedAt: new Date(), exportedFileName: filename, exportedById: req.user?.userId ?? null },
    });
    const sbDocOk2 = displaySalesBillNo(fullBill.id, fullBill.billNo, fullBill.docNo);
    if (flipResult.count === 1) {
      await logActivity({
        user: req.user,
        module: ACTIVITY_MODULES.SALES_BILL,
        entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
        entityId: fullBill.id,
        docNo: sbDocOk2,
        action: ACTIVITY_ACTIONS.EXPORTED,
        message: `Sales Bill ${sbDocOk2} exported to Tally`,
        metadata: { fileName: filename, dispatchIds: [dispatchId] },
      });
      if (req.user?.userId) {
        await auditLog.write(prisma, {
          action: auditLog.AuditAction.UPDATE,
          entityType: auditLog.AuditEntityType.SETTINGS,
          entityId: `SALES_BILL:${fullBill.id}`,
          actorUserId: req.user.userId,
          actorRole: req.user.role,
          summary: `Sales bill ${fullBill.billNo || `SB-${fullBill.id}`} exported to Tally XML (via dispatch)`,
          payload: {
            module: "REPORTS",
            actionLabel: "EXPORT",
            ref: { type: "TALLY_EXPORT", id: String(fullBill.id), no: filename },
            snapshot: { salesBillId: fullBill.id, dispatchId, fileName: filename },
          },
        });
      }
    }

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    return res.status(200).send(xml);
  } catch (e) {
    return next(e);
  }
});

module.exports = { salesBillsRouter };

