const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { prisma } = require("../utils/prisma");
const auditLog = require("../services/auditLog");
const {
  createDraftForGrn,
  createDraftFromSelection,
  updateDraft,
  finalizeBill,
  cancelBill,
  listPurchaseBills,
  getUnbilledGrns,
  getEligibleGrnLinesBySupplier,
  getPurchaseBillById,
  updatePurchaseBillPaymentTracking,
  addPurchaseBillPayment,
  deletePurchaseBillPayment,
} = require("../services/purchaseBillService");
/**
 * Phase 1 ownership:
 *  - Draft create/edit: STORE (physical invoice entry) + ACCOUNTS + ADMIN.
 *  - Finalize / payment / Tally export: ACCOUNTS + ADMIN only.
 *  - Cancel / delete: ADMIN only.
 *  - Read: STORE + ACCOUNTS + ADMIN (Store keeps visibility for reconciliation).
 */
const {
  PURCHASE_BILL_WRITE_ROLES,
  PURCHASE_BILL_DRAFT_ROLES,
  PURCHASE_BILL_READ_ROLES,
} = require("../constants/erpRoles");
// Legacy aliases kept for minimal diff; map onto the new groups.
const PURCHASE_BILL_FULL_OPS_ROLES = PURCHASE_BILL_DRAFT_ROLES;
const PURCHASE_BILL_ACCOUNTS_READ_ROLES = PURCHASE_BILL_READ_ROLES;
const { mapPurchaseBillToTallyExportPayload } = require("../services/purchaseBillTallyExportPayload");
const { buildPurchaseBillTallyXml } = require("../services/purchaseBillTallyXml");
const {
  validateTallyExportEligibility,
  exportSinglePurchaseBillToTally,
  exportPurchaseBillsToTallyBulk,
  preparePurchaseBillTallyExport,
} = require("../services/purchaseBillTallyExportActions");
const { logActivity } = require("../services/activityLogService");
const {
  ACTIVITY_MODULES,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
} = require("../constants/activityLogConstants");
const { displayPurchaseBillNo } = require("../utils/docNoLabels");
const { assertAdminPassword } = require("../services/adminPasswordAuth");

const purchaseBillsRouter = express.Router();

function friendly400(message) {
  return { error: { message } };
}

function isNonEmptyStr(v) {
  return typeof v === "string" && v.trim() !== "";
}

function toNum(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

purchaseBillsRouter.get("/", requireAuth, requireRole(PURCHASE_BILL_ACCOUNTS_READ_ROLES), async (req, res, next) => {
  try {
    const rows = await listPurchaseBills(prisma, req.query);
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

purchaseBillsRouter.get("/unbilled-grns", requireAuth, requireRole(PURCHASE_BILL_FULL_OPS_ROLES), async (req, res, next) => {
  try {
    const rows = await getUnbilledGrns(prisma);
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

/** Eligible GRN lines (remaining qty) for supplier-driven bill creation. */
purchaseBillsRouter.get(
  "/eligible-grn-lines",
  requireAuth,
  requireRole(PURCHASE_BILL_FULL_OPS_ROLES),
  async (req, res, next) => {
    try {
      const supplierId = Number(req.query.supplierId);
      const rows = await getEligibleGrnLinesBySupplier(prisma, supplierId);
      return res.json(rows);
    } catch (e) {
      return next(e);
    }
  },
);

purchaseBillsRouter.patch("/:id/payment-tracking", requireAuth, requireRole(PURCHASE_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const updated = await updatePurchaseBillPaymentTracking(prisma, id, req.body ?? {});
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

purchaseBillsRouter.post("/:id/payments", requireAuth, requireRole(PURCHASE_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const updated = await addPurchaseBillPayment(prisma, id, req.body ?? {}, {
      userId: req.user?.userId,
      role: req.user?.role,
    });
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

purchaseBillsRouter.delete("/:id/payments/:paymentId", requireAuth, requireRole(PURCHASE_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const paymentId = Number(req.params.paymentId);
    const updated = await deletePurchaseBillPayment(prisma, id, paymentId, {
      role: req.user?.role,
      adminPassword: req.body?.adminPassword,
    });
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

purchaseBillsRouter.get("/:id", requireAuth, requireRole(PURCHASE_BILL_ACCOUNTS_READ_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bill = await getPurchaseBillById(prisma, id);
    return res.json(bill);
  } catch (e) {
    return next(e);
  }
});

/**
 * Create a new draft bill from selected GRN line quantities (supplier-driven flow).
 * Body: { supplierId, billNo?, billDate?, remarks?, selections: [{ grnLineId, qty }] }
 */
purchaseBillsRouter.post(
  "/draft-from-selection",
  requireAuth,
  requireRole(PURCHASE_BILL_FULL_OPS_ROLES),
  async (req, res, next) => {
    try {
      const out = await createDraftFromSelection(prisma, req.body ?? {});
      if (out && out.bill && out.bill.id) {
        const b = out.bill;
        const pbDoc = displayPurchaseBillNo(b.id, b.billNo);
        await logActivity({
          user: req.user,
          module: ACTIVITY_MODULES.PURCHASE_BILL,
          entityType: ACTIVITY_ENTITY_TYPES.PURCHASE_BILL,
          entityId: b.id,
          docNo: pbDoc,
          action: ACTIVITY_ACTIONS.CREATED,
          message: `Purchase Bill ${pbDoc} created`,
          metadata: {
            supplierId: b.supplierId,
            supplierName: b.supplier?.name,
            lineCount: Array.isArray(b.lines) ? b.lines.length : undefined,
            totalAmount: b.netAmount != null ? String(b.netAmount) : undefined,
          },
        });
      }
      return res.status(201).json(out);
    } catch (e) {
      return next(e);
    }
  },
);

purchaseBillsRouter.get("/:id/export-payload", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: { message: "Invalid purchase bill id" } });
    }

    const bill = await prisma.purchaseBill.findUnique({
      where: { id },
      include: {
        supplier: { include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } } },
        grn: { select: { id: true, date: true } },
        lines: {
          orderBy: { id: "asc" },
          include: { item: { include: { unitRef: { select: { id: true, unitName: true } } } } },
        },
      },
    });
    if (!bill) {
      return res.status(404).json({ error: { message: "Purchase bill not found" } });
    }

    const companyState = await prisma.appSetting.findUnique({
      where: { id: 1 },
      select: {
        companyGstin: true,
        companyState: true,
        companyStateRef: { select: { id: true, stateName: true, stateCode: true } },
      },
    });

    const payload = mapPurchaseBillToTallyExportPayload({ bill, companyState });
    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

purchaseBillsRouter.get("/:id/export-xml", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: { message: "Invalid purchase bill id" } });
    }

    const bill = await prisma.purchaseBill.findUnique({
      where: { id },
      include: {
        supplier: { include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } } },
        grn: { select: { id: true, date: true } },
        lines: {
          orderBy: { id: "asc" },
          include: { item: { include: { unitRef: { select: { id: true, unitName: true } } } } },
        },
      },
    });
    if (!bill) {
      return res.status(404).json({ error: { message: "Purchase bill not found" } });
    }

    const companyState = await prisma.appSetting.findUnique({
      where: { id: 1 },
      select: {
        companyGstin: true,
        companyState: true,
        companyStateRef: { select: { id: true, stateName: true, stateCode: true } },
      },
    });

    const payload = mapPurchaseBillToTallyExportPayload({ bill, companyState });
    const xml = buildPurchaseBillTallyXml(payload);
    return res.json({ xml });
  } catch (e) {
    return next(e);
  }
});

purchaseBillsRouter.post(
  "/export/tally-bulk",
  requireAuth,
  requireRole(PURCHASE_BILL_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          ids: z.array(z.number().int().positive()).min(1, "Select at least one purchase bill"),
        })
        .parse(req.body ?? {});

      const out = await exportPurchaseBillsToTallyBulk(prisma, body.ids, {
        userId: req.user?.userId,
        role: req.user?.role,
        user: req.user,
      });

      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"${out.filename}\"`);
      return res.status(200).send(out.xml);
    } catch (e) {
      return next(e);
    }
  },
);

purchaseBillsRouter.get("/:id/export/tally.xml", requireAuth, requireRole(PURCHASE_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json(friendly400("Invalid purchase bill id"));
    }

    const out = await exportSinglePurchaseBillToTally(prisma, id, {
      userId: req.user?.userId,
      role: req.user?.role,
      user: req.user,
    });

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${out.filename}\"`);
    return res.status(200).send(out.xml);
  } catch (e) {
    return next(e);
  }
});

/**
 * Download Tally XML for an already-exported purchase bill (does not flip export flags).
 * GET /api/purchase-bills/:id/download/tally.xml
 *
 * Audit-safe default: cancelled bills are NOT downloadable (prevents accidental use of voided vouchers).
 */
purchaseBillsRouter.get("/:id/download/tally.xml", requireAuth, requireRole(PURCHASE_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json(friendly400("Invalid purchase bill id"));
    }

    const { bill, payload } = await preparePurchaseBillTallyExport(prisma, id);
    if (bill.status === "CANCELLED") return res.status(400).json(friendly400("Cancelled purchase bills cannot be downloaded."));
    if (!bill.isExported) return res.status(400).json(friendly400("This purchase bill is not exported yet."));

    const errMsg = validateTallyExportEligibility({ bill, payload });
    if (errMsg) return res.status(400).json(friendly400(errMsg));

    const xml = buildPurchaseBillTallyXml(payload);
    const filename =
      (typeof bill.exportedFileName === "string" && bill.exportedFileName.trim() ? bill.exportedFileName.trim() : null) ??
      `purchase-bill-${String(bill.billNo || `PB-${bill.id}`).replace(/[^\w\-\.]+/g, "-")}.xml`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    return res.status(200).send(xml);
  } catch (e) {
    return next(e);
  }
});

purchaseBillsRouter.post(
  "/:id/reset-export",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json(friendly400("Invalid purchase bill id"));
      }
      const body = z.object({ reason: z.string().min(1) }).parse(req.body);
      const reason = body.reason.trim();
      if (!reason) return res.status(400).json(friendly400("Reason is required."));

      const updated = await prisma.$transaction(async (tx) => {
        const bill = await tx.purchaseBill.findUnique({ where: { id } });
        if (!bill) {
          const err = new Error("Purchase bill not found");
          err.statusCode = 404;
          throw err;
        }
        if (!bill.isExported) {
          const err = new Error("This purchase bill is not exported.");
          err.statusCode = 400;
          throw err;
        }
        const out = await tx.purchaseBill.update({
          where: { id },
          data: {
            isExported: false,
            exportResetAt: new Date(),
            exportResetReason: reason,
            exportResetById: req.user?.userId ?? null,
          },
        });
        if (req.user?.userId) {
          await auditLog.write(tx, {
            action: auditLog.AuditAction.UPDATE,
            entityType: auditLog.AuditEntityType.SETTINGS,
            entityId: `PURCHASE_BILL:${id}`,
            actorUserId: req.user.userId,
            actorRole: req.user.role,
            summary: `Purchase bill ${out.billNo || `PB-${id}`} export status reset`,
            reason,
            payload: {
              module: "ADMIN",
              actionLabel: "OVERRIDE",
              ref: { type: "PURCHASE_BILL", id: String(id), no: out.billNo || `PB-${id}` },
            },
          });
        }
        return out;
      });

      return res.json({ message: "Export status reset. You can export this bill again.", bill: updated });
    } catch (e) {
      return next(e);
    }
  },
);

// TEMPORARY TESTING API
// Remove or protect further before production
purchaseBillsRouter.post(
  "/reset-export-bulk",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      if (process.env.TESTING_MODE_RELAXED_TAX_FIELDS !== "true" && process.env.TESTING_MODE_RELAXED_TAX_FIELDS !== "1") {
        return res.status(404).json(friendly400("Not found"));
      }
      const body = z
        .object({
          ids: z.array(z.number().int().positive()).min(1, "ids must be a non-empty array"),
        })
        .parse(req.body);

      const now = new Date();
      const result = await prisma.purchaseBill.updateMany({
        where: { id: { in: body.ids } },
        data: {
          isExported: false,
          exportedAt: null,
          exportedFileName: null,
          exportResetAt: now,
          exportResetReason: "Testing reset (bulk)",
          exportResetById: req.user?.userId ?? null,
        },
      });

      return res.json({
        message: "Export status reset for selected purchase bills.",
        count: result.count,
      });
    } catch (e) {
      return next(e);
    }
  },
);

purchaseBillsRouter.delete("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    return res
      .status(400)
      .json(friendly400("Deletion is disabled for purchase bills. Use Finalize → Cancel lifecycle to keep audit trail."));
  } catch (e) {
    return next(e);
  }
});

purchaseBillsRouter.post("/", requireAuth, requireRole(PURCHASE_BILL_FULL_OPS_ROLES), async (req, res, next) => {
  try {
    const body = z.object({ grnId: z.number().int() }).parse(req.body);
    const { bill, created } = await createDraftForGrn(prisma, body.grnId);
    if (created) {
      const pbDoc = displayPurchaseBillNo(bill.id, bill.billNo);
      await logActivity({
        user: req.user,
        module: ACTIVITY_MODULES.PURCHASE_BILL,
        entityType: ACTIVITY_ENTITY_TYPES.PURCHASE_BILL,
        entityId: bill.id,
        docNo: pbDoc,
        action: ACTIVITY_ACTIONS.CREATED,
        message: `Purchase Bill ${pbDoc} created`,
        metadata: {
          supplierId: bill.supplierId,
          grnIds: bill.grnId != null ? [bill.grnId] : undefined,
          lineCount: Array.isArray(bill.lines) ? bill.lines.length : undefined,
        },
      });
    }
    if (created && req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `PURCHASE_BILL:${bill.id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Purchase bill PB-${bill.id} created from GRN-${bill.grnId}`,
        payload: {
          module: "PURCHASE",
          actionLabel: "CREATE",
          ref: { type: "PURCHASE_BILL", id: String(bill.id), no: bill.billNo || `PB-${bill.id}` },
          snapshot: { grnId: bill.grnId, status: bill.status },
          status: { from: null, to: bill.status },
        },
      });
    }
    return res.status(created ? 201 : 200).json(bill);
  } catch (e) {
    return next(e);
  }
});

const dateInput = z.union([
  z.string().min(1),
  z.number(),
  z.coerce.date(),
]);

purchaseBillsRouter.put("/:id", requireAuth, requireRole(PURCHASE_BILL_FULL_OPS_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      billNo: z.string().max(128).optional().nullable(),
      billDate: dateInput,
      dueDate: z.union([dateInput, z.null(), z.literal("")]).optional(),
      remarks: z.string().max(4000).optional().nullable(),
      lines: z
        .array(
          z.object({
            id: z.number().int(),
            qty: z.number().positive(),
            rate: z.number().positive(),
          }),
        )
        .min(1),
    });
    const body = schema.parse(req.body);
    const updated = await updateDraft(prisma, id, body);
    if (req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `PURCHASE_BILL:${id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Purchase bill PB-${id} updated`,
        payload: {
          module: "PURCHASE",
          actionLabel: "UPDATE",
          ref: { type: "PURCHASE_BILL", id: String(id), no: updated.billNo || `PB-${id}` },
        },
      });
    }
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

purchaseBillsRouter.post("/:id/finalize", requireAuth, requireRole(PURCHASE_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const finalized = await finalizeBill(prisma, id);
    const pbDoc = displayPurchaseBillNo(id, finalized.billNo);
    await logActivity({
      user: req.user,
      module: ACTIVITY_MODULES.PURCHASE_BILL,
      entityType: ACTIVITY_ENTITY_TYPES.PURCHASE_BILL,
      entityId: id,
      docNo: pbDoc,
      action: ACTIVITY_ACTIONS.FINALIZED,
      message: `Purchase Bill ${pbDoc} finalized`,
      metadata: {
        supplierId: finalized.supplierId,
        supplierName: finalized.supplier?.name,
        lineCount: Array.isArray(finalized.lines) ? finalized.lines.length : undefined,
        totalAmount: finalized.netAmount != null ? String(finalized.netAmount) : undefined,
      },
    });
    if (req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.APPROVE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `PURCHASE_BILL:${id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Purchase bill PB-${id} finalized`,
        payload: {
          module: "PURCHASE",
          actionLabel: "FINALIZE",
          ref: { type: "PURCHASE_BILL", id: String(id), no: finalized.billNo || `PB-${id}` },
          status: { from: "DRAFT", to: "FINALIZED" },
        },
      });
    }
    return res.json(finalized);
  } catch (e) {
    return next(e);
  }
});

purchaseBillsRouter.post("/:id/cancel", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = z.object({ reason: z.string().min(1).max(2000), adminPassword: z.string().min(1).optional() }).parse(req.body ?? {});
    const bill = await prisma.purchaseBill.findUnique({ where: { id }, select: { id: true, isExported: true } });
    if (!bill) return res.status(404).json(friendly400("Purchase bill not found."));
    const allowExported = bill.isExported === true;
    if (allowExported) {
      await assertAdminPassword(prisma, { userId: req.user?.userId, password: body.adminPassword });
    }
    const cancelled = await cancelBill(prisma, id, { reason: body.reason, actorUserId: req.user?.userId, allowExported });
    const pbDoc = displayPurchaseBillNo(id, cancelled.billNo);
    await logActivity({
      user: req.user,
      module: ACTIVITY_MODULES.PURCHASE_BILL,
      entityType: ACTIVITY_ENTITY_TYPES.PURCHASE_BILL,
      entityId: id,
      docNo: pbDoc,
      action: ACTIVITY_ACTIONS.CANCELLED,
      message: `Purchase Bill ${pbDoc} cancelled`,
      reason: body.reason.trim(),
      metadata: {
        supplierId: cancelled.supplierId,
        supplierName: cancelled.supplier?.name,
      },
    });
    if (req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.CANCEL,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `PURCHASE_BILL:${id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Purchase bill PB-${id} cancelled`,
        reason: body.reason.trim(),
        payload: {
          module: "PURCHASE",
          actionLabel: "CANCEL",
          ref: { type: "PURCHASE_BILL", id: String(id), no: `PB-${id}` },
          status: { from: "FINALIZED", to: "CANCELLED" },
        },
      });
    }
    return res.json(cancelled);
  } catch (e) {
    return next(e);
  }
});

module.exports = { purchaseBillsRouter };
