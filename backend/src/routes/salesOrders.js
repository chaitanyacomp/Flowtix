const express = require("express");
const { z } = require("zod");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createSalesOrderFromPo } = require("../services/salesOrderFromPo");
const { rmCheckForSalesOrder } = require("../services/rmCheckService");
const { getStrictInventoryControl } = require("../services/appSettings");
const { DocType } = require("@prisma/client");
const { allocateDocNo } = require("../services/docNoService");
const {
  lockSalesOrderAndAssertCanComplete,
  enrichSalesOrderWithDispatchStats,
} = require("../services/salesOrderDispatchHelpers");
const { diagnoseNoQtyCycleAutoClose, maybeAutoCloseNoQtyCycle } = require("../services/noQtyCycleAutoClose");
const { closeEmptyNoQtyActiveCycle } = require("../services/noQtyCloseEmptyCycle");
const { enrichSalesOrdersWithProcessStage, fetchInvoicedQtyBySoId } = require("../services/salesOrderProcessStage");
const {
  STOCK_EPS: INTEGRITY_EPS,
  totalWoPlannedQtyForSoItem,
  totalProducedQtyForSoItem,
} = require("../services/transactionalIntegrityGuards");
const {
  netDispatchedByItemId,
  getAttributedDispatchQtyForSalesOrderLine,
} = require("../services/salesOrderDispatchAllocation");
const {
  normalizeSalesOrderDraftLineQuantities,
  clampMaxRegularSoBufferPercent,
} = require("../services/regularSoBufferQty");
const {
  getDraftSoItemQtyFloorViolations,
  formatDraftSoFloorViolationMessage,
} = require("../services/draftSalesOrderQtyFloors");
const auditLog = require("../services/auditLog");
const { logActivity } = require("../services/activityLogService");
const {
  ACTIVITY_MODULES,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
} = require("../constants/activityLogConstants");
const { displaySalesOrderNo } = require("../utils/docNoLabels");

const salesOrderRouter = express.Router();

/** @param {Record<string, any> | null | undefined} head */
function salesOrderActivityMeta(head) {
  if (!head) return {};
  const md = {
    customerId: head.customerId ?? head.customer?.id ?? undefined,
    customerName: head.customer?.name ?? head.po?.customer?.name ?? undefined,
    orderType: head.orderType ?? undefined,
  };
  if (head.orderType === "NO_QTY") {
    const cyc = head.currentCycle;
    if (cyc?.id != null) md.cycleId = Number(cyc.id);
    if (cyc?.cycleNo != null) md.cycleNo = Number(cyc.cycleNo);
  }
  return md;
}

async function assertReplacementSoQtyWithinAvailable(tx, so) {
  if (!so || so.orderType !== "REPLACEMENT") return;
  if (!so.customerReturnId) {
    const err = new Error("Replacement order is missing return reference.");
    err.statusCode = 400;
    throw err;
  }

  const r = await tx.customerReturn.findUnique({ where: { id: so.customerReturnId } });
  if (!r || r.reversedAt != null) {
    const err = new Error("Linked customer return not found.");
    err.statusCode = 400;
    throw err;
  }
  if (r.status !== "APPROVED_TO_STOCK") {
    const err = new Error("Replacement order is allowed only for returns approved to stock.");
    err.statusCode = 409;
    throw err;
  }

  const otherSos = await tx.salesOrder.findMany({
    where: {
      orderType: "REPLACEMENT",
      customerReturnId: r.id,
      id: { not: so.id },
      internalStatus: { in: ["DRAFT", "APPROVED", "IN_PROCESS"] },
    },
    include: { lines: true },
  });
  const usedByOthers = otherSos.reduce(
    (s, x) => s + (x.lines || []).reduce((ss, l) => ss + Number(l.qty || 0), 0),
    0,
  );

  const approved = Number(r.returnedQty ?? 0);
  const currentQty = (so.lines || []).reduce((s, l) => s + Number(l.qty || 0), 0);
  const proposedUsed = usedByOthers + currentQty;

  if (proposedUsed > approved + INTEGRITY_EPS) {
    const err = new Error(
      `Replacement qty exceeds available from approved return (allowed ${approved}, used ${proposedUsed}).`,
    );
    err.statusCode = 400;
    throw err;
  }
}

/** Prefer quotation number, else customer PO ref; always include canonical SO doc no (or legacy SO-{id}). */
function formatSalesOrderApproveSummary(soId, head) {
  const base = head?.docNo?.trim() ? head.docNo.trim() : `SO-${soId}`;
  const qn = head.quotation?.quotationNo?.trim();
  const po = head.customerPoReference?.trim();
  let label = base;
  if (qn) {
    label = `${base} (${qn})`;
  } else if (po) {
    label = `${base} (PO ${po})`;
  }
  return `Sales order ${label} approved`;
}

/** Quotation line snapshot for commercial display on SO / invoice (not used for RM, WO, or dispatch math). */
const quotationLineSelectForSo = {
  select: { id: true, qty: true, rate: true, isFree: true, lineTotal: true, discountPct: true, gstPct: true },
};

const soInclude = {
  po: { include: { customer: true } },
  customer: true,
  quotation: { include: { enquiry: true } },
  lines: { include: { item: true, quotationLine: quotationLineSelectForSo } },
  dispatch: true,
  currentCycle: { select: { id: true, cycleNo: true, status: true } },
};

const statusEnum = z.enum(["DRAFT", "OPEN", "APPROVED", "IN_PROCESS", "COMPLETED", "CLOSED"]);

/** Create internal SO from approved quotation only. */
salesOrderRouter.post(
  "/from-quotation/:quotationId",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE"]),
  async (req, res, next) => {
    try {
      const quotationId = Number(req.params.quotationId);
      const body = z
        .object({
          customerPoReference: z.string().min(1, "Customer PO reference is required."),
          remarks: z.string().optional().nullable(),
          /** Optional: per-line customer commitment + buffer for NORMAL SO (server sets planned `qty`). */
          lines: z
            .array(
              z.object({
                itemId: z.number().int(),
                customerPoQty: z.number().positive(),
                bufferPercent: z.number().min(0),
              }),
            )
            .optional(),
        })
        .parse(req.body);

      const so = await prisma.$transaction(async (tx) => {
        const maxBufRow = await tx.appSetting.findUnique({
          where: { id: 1 },
          select: { maxRegularSoBufferPercent: true },
        });
        const maxBuf = clampMaxRegularSoBufferPercent(maxBufRow?.maxRegularSoBufferPercent);

        const q = await tx.quotation.findUnique({
          where: { id: quotationId },
          include: { lines: true, enquiry: true, salesOrder: true },
        });
        if (!q) {
          const err = new Error("Quotation not found");
          err.statusCode = 404;
          throw err;
        }
        if (q.salesOrder) {
          const err = new Error("Sales order already exists for this quotation");
          err.statusCode = 400;
          throw err;
        }
        if (q.workflowStatus !== "APPROVED") {
          const err = new Error("Sales Order can only be created from an approved quotation.");
          err.statusCode = 409;
          throw err;
        }
        if (!q.lines.length) {
          const err = new Error("Quotation has no lines");
          err.statusCode = 400;
          throw err;
        }

        const overrideLines = body.lines;
        if (overrideLines != null) {
          if (overrideLines.length !== q.lines.length) {
            const err = new Error("Line count must match the quotation.");
            err.statusCode = 400;
            throw err;
          }
          for (let i = 0; i < q.lines.length; i += 1) {
            if (Number(q.lines[i].itemId) !== Number(overrideLines[i].itemId)) {
              const err = new Error("Line itemId order must match the quotation.");
              err.statusCode = 400;
              throw err;
            }
          }
        }

        const lineCreates =
          overrideLines == null
            ? q.lines.map((l) => ({
                itemId: l.itemId,
                qty: l.qty,
                customerPoQty: l.qty,
                bufferPercent: 0,
                quotationLineId: l.id,
                isFree: Boolean(l.isFree),
              }))
            : q.lines.map((l, i) => {
                const n = normalizeSalesOrderDraftLineQuantities(overrideLines[i], "NORMAL", maxBuf);
                return {
                  itemId: l.itemId,
                  qty: String(n.plannedQty),
                  customerPoQty: String(n.customerPoQty),
                  bufferPercent: String(n.bufferPercent),
                  quotationLineId: l.id,
                  isFree: Boolean(l.isFree),
                };
              });

        const createdSo = await tx.salesOrder.create({
          data: {
            docNo: await allocateDocNo(tx, { docType: DocType.SALES_ORDER, date: new Date() }),
            customerId: q.enquiry.customerId,
            quotationId: q.id,
            customerPoReference: body.customerPoReference.trim(),
            remarks: body.remarks?.trim() || null,
            /** Regular SO from already-approved quotation: skip DRAFT so RM check / WO flow is immediate (no second approval). */
            internalStatus: "APPROVED",
            lines: {
              create: lineCreates,
            },
          },
          include: soInclude,
        });

        // Optional flow: when Sales Order is created from quotation, close enquiry to avoid duplicate funnel state.
        if (q.enquiry?.id != null) {
          await tx.enquiry.update({ where: { id: q.enquiry.id }, data: { status: "CLOSED" } });
        }

        const docLabel = displaySalesOrderNo(createdSo.id, createdSo.docNo);
        await auditLog.write(tx, {
          action: auditLog.AuditAction.CREATE,
          entityType: auditLog.AuditEntityType.SALES_ORDER,
          entityId: String(createdSo.id),
          actorUserId: req.user.userId,
          actorRole: req.user.role,
          summary: "Sales Order created from approved quotation and auto-approved",
          payload: {
            module: "SALES",
            actionLabel: "CREATE",
            ref: { type: "SO", id: String(createdSo.id), no: docLabel },
            snapshot: {
              quotationId: q.id,
              quotationNo: q.quotationNo ?? null,
              customerId: createdSo.customerId ?? null,
              customerPoReference: createdSo.customerPoReference ?? null,
            },
            status: { from: null, to: "APPROVED" },
          },
        });

        await logActivity({
          tx,
          user: req.user,
          module: ACTIVITY_MODULES.SALES_ORDER,
          entityType: ACTIVITY_ENTITY_TYPES.SALES_ORDER,
          entityId: createdSo.id,
          docNo: docLabel,
          action: ACTIVITY_ACTIONS.APPROVED,
          message: "Sales Order created from approved quotation and auto-approved",
          metadata: salesOrderActivityMeta(createdSo),
        });

        return createdSo;
      });

      return res.status(201).json(so);
    } catch (e) {
      return next(e);
    }
  },
);

/** Legacy: create SO from customer PO only. */
salesOrderRouter.post(
  "/",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE"]),
  async (req, res, next) => {
    try {
      const fromPo = z.object({ poId: z.number().int() }).safeParse(req.body);
      if (!fromPo.success) {
        const err = new Error("Use POST /sales-orders/from-quotation/:quotationId to create from a quotation.");
        err.statusCode = 400;
        throw err;
      }
      const { salesOrder, created } = await createSalesOrderFromPo(fromPo.data.poId);
      return res.status(created ? 201 : 200).json(salesOrder);
    } catch (e) {
      return next(e);
    }
  },
);

salesOrderRouter.get(
  "/",
  requireAuth,
  requireRole(["ADMIN", "STORE", "SALES", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const rows = await prisma.salesOrder.findMany({
        orderBy: { id: "desc" },
        include: soInclude,
      });
      const withDispatch = rows.map((r) => enrichSalesOrderWithDispatchStats(r));
      const invoicedBySoId = await fetchInvoicedQtyBySoId(
        prisma,
        withDispatch.map((s) => s.id),
      );
      let staged = await enrichSalesOrdersWithProcessStage(prisma, withDispatch, { invoicedQtyBySoId: invoicedBySoId });

      // Safety sync: if processStage is COMPLETED, internalStatus must be COMPLETED.
      // Prevents mismatches like Status=IN_PROCESS while Stage shows Closed/Completed.
      const shouldAutoCompleteIds = staged
        .filter((s) => s.orderType !== "NO_QTY" && s?.processStage?.key === "COMPLETED" && s.internalStatus !== "COMPLETED")
        .map((s) => s.id)
        .filter((id) => Number.isFinite(id) && id > 0);

      if (shouldAutoCompleteIds.length) {
        await prisma.$transaction(async (tx) => {
          for (const soId of shouldAutoCompleteIds) {
            await lockSalesOrderAndAssertCanComplete(tx, soId);
            await tx.salesOrder.update({ where: { id: soId }, data: { internalStatus: "COMPLETED" } });
          }
        });

        const done = new Set(shouldAutoCompleteIds);
        staged = staged.map((s) => (done.has(s.id) ? { ...s, internalStatus: "COMPLETED" } : s));
      }

      // Invoice summary (NORMAL + REPLACEMENT): reuses invoicedBySoId computed before processStage enrichment.

      // NO_QTY sales bill eligibility: dispatch-driven only.
      // unbilledDispatchedQty = sum(locked forward dispatch qty without an active bill).
      const noQtyIds = staged.filter((s) => s.orderType === "NO_QTY").map((s) => s.id);
      /** @type {Map<number, number>} */
      const noQtyActiveCycleCountBySoId = new Map();
      if (noQtyIds.length) {
        const activeRows = await prisma.salesOrderCycle.findMany({
          where: { salesOrderId: { in: noQtyIds }, status: "ACTIVE" },
          select: { salesOrderId: true },
        });
        for (const r of activeRows) {
          noQtyActiveCycleCountBySoId.set(r.salesOrderId, (noQtyActiveCycleCountBySoId.get(r.salesOrderId) ?? 0) + 1);
        }
      }
      /** @type {Map<number, number>} */
      const unbilledBySoId = new Map();
      if (noQtyIds.length) {
        /** @type {Map<number, number>} */
        const currentCycleIdBySoId = new Map();
        for (const s of staged) {
          if (s.orderType !== "NO_QTY") continue;
          const c = s.currentCycleId != null ? Number(s.currentCycleId) : 0;
          if (Number.isFinite(c) && c > 0) currentCycleIdBySoId.set(s.id, c);
        }

        const lockedForward = await prisma.dispatch.findMany({
          where: {
            soId: { in: noQtyIds },
            reversalOfId: null,
            workflowStatus: "LOCKED",
          },
          select: { id: true, soId: true, dispatchedQty: true, cycleId: true },
        });
        const dispatchIds = lockedForward.map((d) => d.id);
        const existingBills = dispatchIds.length
          ? await prisma.salesBill.findMany({
              where: { dispatchId: { in: dispatchIds }, status: { in: ["DRAFT", "FINALIZED"] } },
              select: { dispatchId: true },
            })
          : [];
        const billedDispatchIds = new Set(existingBills.map((b) => b.dispatchId));
        for (const d of lockedForward) {
          if (billedDispatchIds.has(d.id)) continue;
          const currentCycleId = currentCycleIdBySoId.get(d.soId) ?? 0;
          // NO_QTY list stage must reflect current active cycle only.
          if (!currentCycleId || Number(d.cycleId) !== Number(currentCycleId)) continue;
          const q = Number(d.dispatchedQty ?? 0);
          if (!Number.isFinite(q) || q <= 0) continue;
          unbilledBySoId.set(d.soId, (unbilledBySoId.get(d.soId) ?? 0) + q);
        }
      }

      // NO_QTY stage clarity: does the current cycle have at least one requirement sheet yet?
      // Used by the NO_QTY SO list to show "Requirement Pending" only when truly waiting for the first sheet.
      /** @type {Set<string>} */
      const noQtyHasReqSheetBySoCycleKey = new Set();
      const noQtyCycleIds = [
        ...new Set(
          staged
            .filter((s) => s.orderType === "NO_QTY" && s.currentCycleId != null)
            .map((s) => Number(s.currentCycleId))
            .filter((x) => Number.isFinite(x) && x > 0),
        ),
      ];
      if (noQtyIds.length && noQtyCycleIds.length) {
        const sheets = await prisma.requirementSheet.findMany({
          where: { salesOrderId: { in: noQtyIds }, cycleId: { in: noQtyCycleIds } },
          select: { salesOrderId: true, cycleId: true },
        });
        for (const sh of sheets) {
          const soId = Number(sh.salesOrderId);
          const cycleId = sh.cycleId != null ? Number(sh.cycleId) : 0;
          if (!Number.isFinite(soId) || soId <= 0) continue;
          if (!Number.isFinite(cycleId) || cycleId <= 0) continue;
          noQtyHasReqSheetBySoCycleKey.add(`${soId}:${cycleId}`);
        }
      }

      // NO_QTY current-cycle downstream evidence (used for stage priority mapping).
      const noQtyWorkOrderBySoCycleKey = new Set();
      const noQtyProductionBySoCycleKey = new Set();
      const noQtyQcBySoCycleKey = new Set();
      const noQtyDispatchBySoCycleKey = new Set();
      const noQtySalesBillBySoCycleKey = new Set();
      /** Any WO / any dispatch in cycle (empty-cycle close eligibility). */
      const noQtyAnyWorkOrderBySoCycleKey = new Set();
      const noQtyAnyDispatchBySoCycleKey = new Set();
      /** Any QC row (including reversed) on production in cycle — matches empty-close POST checks. */
      const noQtyAnyQcBySoCycleKey = new Set();

      if (noQtyIds.length && noQtyCycleIds.length) {
        const wos = await prisma.workOrder.findMany({
          where: {
            salesOrderId: { in: noQtyIds },
            cycleId: { in: noQtyCycleIds },
            status: { not: "REJECTED" },
          },
          select: { salesOrderId: true, cycleId: true },
        });
        for (const w of wos) noQtyWorkOrderBySoCycleKey.add(`${w.salesOrderId}:${Number(w.cycleId)}`);

        const prod = await prisma.productionEntry.findMany({
          where: {
            workOrderLine: {
              workOrder: { salesOrderId: { in: noQtyIds }, cycleId: { in: noQtyCycleIds } },
            },
          },
          select: {
            id: true,
            workOrderLine: { select: { workOrder: { select: { salesOrderId: true, cycleId: true } } } },
          },
        });
        for (const pe of prod) {
          const soId = pe.workOrderLine.workOrder.salesOrderId;
          const c = Number(pe.workOrderLine.workOrder.cycleId);
          noQtyProductionBySoCycleKey.add(`${soId}:${c}`);
        }

        const qcs = await prisma.qcEntry.findMany({
          where: {
            reversedAt: null,
            production: {
              workOrderLine: {
                workOrder: { salesOrderId: { in: noQtyIds }, cycleId: { in: noQtyCycleIds } },
              },
            },
          },
          select: {
            id: true,
            production: { select: { workOrderLine: { select: { workOrder: { select: { salesOrderId: true, cycleId: true } } } } } },
          },
        });
        for (const q of qcs) {
          const soId = q.production.workOrderLine.workOrder.salesOrderId;
          const c = Number(q.production.workOrderLine.workOrder.cycleId);
          noQtyQcBySoCycleKey.add(`${soId}:${c}`);
        }

        const dispatchRows = await prisma.dispatch.findMany({
          where: {
            soId: { in: noQtyIds },
            cycleId: { in: noQtyCycleIds },
            workflowStatus: "LOCKED",
            reversalOfId: null,
          },
          select: { soId: true, cycleId: true },
        });
        for (const d of dispatchRows) noQtyDispatchBySoCycleKey.add(`${d.soId}:${Number(d.cycleId)}`);

        const bills = await prisma.salesBill.findMany({
          where: {
            cycleId: { in: noQtyCycleIds },
            status: { in: ["DRAFT", "FINALIZED"] },
            dispatch: { soId: { in: noQtyIds } },
          },
          select: { id: true, cycleId: true, dispatch: { select: { soId: true } } },
        });
        for (const b of bills) {
          const soId = b.dispatch?.soId;
          if (!soId) continue;
          noQtySalesBillBySoCycleKey.add(`${soId}:${Number(b.cycleId)}`);
        }

        const wosAny = await prisma.workOrder.findMany({
          where: { salesOrderId: { in: noQtyIds }, cycleId: { in: noQtyCycleIds } },
          select: { salesOrderId: true, cycleId: true },
        });
        for (const w of wosAny) noQtyAnyWorkOrderBySoCycleKey.add(`${w.salesOrderId}:${Number(w.cycleId)}`);

        const dispAny = await prisma.dispatch.findMany({
          where: { soId: { in: noQtyIds }, cycleId: { in: noQtyCycleIds } },
          select: { soId: true, cycleId: true },
        });
        for (const d of dispAny) noQtyAnyDispatchBySoCycleKey.add(`${d.soId}:${Number(d.cycleId)}`);

        const qcsAny = await prisma.qcEntry.findMany({
          where: {
            production: {
              workOrderLine: {
                workOrder: { salesOrderId: { in: noQtyIds }, cycleId: { in: noQtyCycleIds } },
              },
            },
          },
          select: {
            production: { select: { workOrderLine: { select: { workOrder: { select: { salesOrderId: true, cycleId: true } } } } } },
          },
        });
        for (const q of qcsAny) {
          const sid = q.production.workOrderLine.workOrder.salesOrderId;
          const c = Number(q.production.workOrderLine.workOrder.cycleId);
          noQtyAnyQcBySoCycleKey.add(`${sid}:${c}`);
        }
      }

      // Temporary admin-only debug evidence (NO_QTY, current cycle only).
      /** @type {Map<number, any>} */
      const noQtyDebugBySoId = new Map();
      if (req.user?.role === "ADMIN" && noQtyIds.length && noQtyCycleIds.length) {
        const hasReq = new Set(noQtyHasReqSheetBySoCycleKey);

        const woByKey = new Set(noQtyWorkOrderBySoCycleKey);

        const prodByKey = new Set(noQtyProductionBySoCycleKey);

        const qcByKey = new Set(noQtyQcBySoCycleKey);

        const dispByKey = new Set(noQtyDispatchBySoCycleKey);

        const billByKey = new Set(noQtySalesBillBySoCycleKey);

        for (const s of staged) {
          if (s.orderType !== "NO_QTY") continue;
          const c = s.currentCycleId != null ? Number(s.currentCycleId) : 0;
          if (!Number.isFinite(c) || c <= 0) continue;
          const key = `${s.id}:${c}`;
          noQtyDebugBySoId.set(s.id, {
            salesOrderId: s.id,
            orderType: s.orderType,
            currentCycleId: c,
            cycleNo: s.currentCycle?.cycleNo ?? null,
            requirementExists: hasReq.has(key),
            workOrderExists: woByKey.has(key),
            productionExists: prodByKey.has(key),
            qcExists: qcByKey.has(key),
            dispatchExists: dispByKey.has(key),
            salesBillExists: billByKey.has(key),
          });
        }
      }

      // Admin-only: hard-delete eligibility for NON-CONNECTED sales orders.
      // Delete is allowed only when no transactional downstream records exist (locked requirement, WO, production, QC, dispatch, sales bill, etc.).
      /** @type {Map<number, string[]>} */
      const deleteBlockedReasonsBySoId = new Map();
      if (req.user?.role === "ADMIN") {
        const soIds = staged.map((s) => s.id).filter((id) => Number.isFinite(id) && id > 0);
        if (soIds.length) {
          const [
            lockedReq,
            workOrdersAny,
            dispatchAny,
            billsAny,
            prodAny,
            qcAny,
            returnsAny,
            stockAdjQcAny,
          ] = await Promise.all([
            prisma.requirementSheet.findMany({
              where: { salesOrderId: { in: soIds }, status: "LOCKED" },
              select: { salesOrderId: true },
            }),
            prisma.workOrder.findMany({
              where: { salesOrderId: { in: soIds } },
              select: { salesOrderId: true },
            }),
            prisma.dispatch.findMany({
              where: { soId: { in: soIds } },
              select: { soId: true },
            }),
            prisma.salesBill.findMany({
              where: { dispatch: { soId: { in: soIds } }, status: { in: ["DRAFT", "FINALIZED"] } },
              select: { dispatch: { select: { soId: true } } },
            }),
            prisma.productionEntry.findMany({
              where: { workOrderLine: { workOrder: { salesOrderId: { in: soIds } } } },
              select: { workOrderLine: { select: { workOrder: { select: { salesOrderId: true } } } } },
            }),
            prisma.qcEntry.findMany({
              where: { production: { workOrderLine: { workOrder: { salesOrderId: { in: soIds } } } } },
              select: { production: { select: { workOrderLine: { select: { workOrder: { select: { salesOrderId: true } } } } } } },
            }),
            prisma.customerReturn.findMany({
              where: { salesOrderId: { in: soIds }, reversedAt: null },
              select: { salesOrderId: true },
            }),
            prisma.stockAdjustmentQcEntry.findMany({
              where: { salesOrderId: { in: soIds }, reversedAt: null },
              select: { salesOrderId: true },
            }),
          ]);

          const mark = (soId, reason) => {
            const sid = Number(soId);
            if (!Number.isFinite(sid) || sid <= 0) return;
            const arr = deleteBlockedReasonsBySoId.get(sid) ?? [];
            if (!arr.includes(reason)) arr.push(reason);
            deleteBlockedReasonsBySoId.set(sid, arr);
          };

          for (const r of lockedReq) mark(r.salesOrderId, "LOCKED_REQUIREMENT_SHEET_EXISTS");
          for (const r of workOrdersAny) mark(r.salesOrderId, "WORK_ORDER_EXISTS");
          for (const r of dispatchAny) mark(r.soId, "DISPATCH_EXISTS");
          for (const r of billsAny) mark(r.dispatch?.soId, "SALES_BILL_EXISTS");
          for (const r of prodAny) mark(r.workOrderLine?.workOrder?.salesOrderId, "PRODUCTION_ENTRY_EXISTS");
          for (const r of qcAny) mark(r.production?.workOrderLine?.workOrder?.salesOrderId, "QC_ENTRY_EXISTS");
          for (const r of returnsAny) mark(r.salesOrderId, "CUSTOMER_RETURN_EXISTS");
          for (const r of stockAdjQcAny) mark(r.salesOrderId, "STOCK_ADJUSTMENT_QC_EXISTS");
        }
      }

      return res.json(
        staged.map((s) => ({
          ...s,
          ...(s.orderType === "NO_QTY" && s.currentCycleId != null
            ? (() => {
                const c = Number(s.currentCycleId);
                const key = `${s.id}:${c}`;
                // Priority-based stage mapping for NO_QTY (current cycle only).
                const isCompleted = s.internalStatus === "CLOSED";
                const salesBillExists = noQtySalesBillBySoCycleKey.has(key);
                const dispatchExists = noQtyDispatchBySoCycleKey.has(key);
                const qcExists = noQtyQcBySoCycleKey.has(key);
                const productionExists = noQtyProductionBySoCycleKey.has(key);
                const workOrderExists = noQtyWorkOrderBySoCycleKey.has(key);
                const requirementExists = noQtyHasReqSheetBySoCycleKey.has(key);

                // Single next-action hint for NO_QTY list: open the current actionable module directly.
                const nextAction = (() => {
                  if (isCompleted) return "COMPLETED";
                  if (salesBillExists) return "SALES_BILL";
                  if (dispatchExists) return "SALES_BILL";
                  if (qcExists) return "DISPATCH";
                  if (productionExists) return "QC";
                  if (workOrderExists) return "PRODUCTION";
                  if (requirementExists) return "WORK_ORDER";
                  return "REQUIREMENT";
                })();

                let stageKey = "NO_QTY_DRAFT";
                let stageLabel = "Draft";
                if (isCompleted) {
                  stageKey = "COMPLETED";
                  stageLabel = "Completed";
                } else if (salesBillExists || dispatchExists) {
                  stageKey = "NO_QTY_DISPATCH_BILLING";
                  stageLabel = "Dispatch / Billing";
                } else if (qcExists || productionExists) {
                  stageKey = "NO_QTY_IN_PRODUCTION";
                  stageLabel = "Production / QC";
                } else if (workOrderExists) {
                  stageKey = "NO_QTY_WORK_ORDER";
                  stageLabel = "Work order";
                } else if (requirementExists) {
                  stageKey = "NO_QTY_REQUIREMENT_READY";
                  stageLabel = "Requirement ready";
                } else {
                  stageKey = "NO_QTY_DRAFT";
                  stageLabel = "Draft";
                }

                return { processStage: { key: stageKey, label: stageLabel }, noQtyNextAction: nextAction };
              })()
            : {}),
          unbilledDispatchedQty: s.orderType === "NO_QTY" ? (unbilledBySoId.get(s.id) ?? 0) : null,
          invoicedQty: invoicedBySoId.get(s.id) ?? 0,
          hasCurrentCycleRequirementSheet:
            s.orderType === "NO_QTY" && s.currentCycleId != null
              ? noQtyHasReqSheetBySoCycleKey.has(`${s.id}:${Number(s.currentCycleId)}`)
              : null,
          hasCurrentCycleSalesBill:
            s.orderType === "NO_QTY" && s.currentCycleId != null
              ? noQtySalesBillBySoCycleKey.has(`${s.id}:${Number(s.currentCycleId)}`)
              : null,
          noQtyCanCloseEmptyCycle:
            s.orderType === "NO_QTY" && s.currentCycleId != null
              ? (() => {
                  if (s.internalStatus === "CLOSED" || s.currentCycle?.status !== "ACTIVE") return false;
                  const c = Number(s.currentCycleId);
                  const key = `${s.id}:${c}`;
                  return (
                    !noQtyHasReqSheetBySoCycleKey.has(key) &&
                    !noQtyAnyWorkOrderBySoCycleKey.has(key) &&
                    !noQtyProductionBySoCycleKey.has(key) &&
                    !noQtyAnyQcBySoCycleKey.has(key) &&
                    !noQtyAnyDispatchBySoCycleKey.has(key) &&
                    !noQtySalesBillBySoCycleKey.has(key)
                  );
                })()
              : null,
          ...(req.user?.role === "ADMIN" && s.orderType === "NO_QTY"
            ? { noQtyStageDebug: noQtyDebugBySoId.get(s.id) ?? null }
            : {}),
          ...(req.user?.role === "ADMIN"
            ? {
                deleteAllowed: !(deleteBlockedReasonsBySoId.get(s.id) ?? []).length,
                deleteBlockedReasons: deleteBlockedReasonsBySoId.get(s.id) ?? [],
              }
            : {}),
          noQtyActiveCycleCount: s.orderType === "NO_QTY" ? (noQtyActiveCycleCountBySoId.get(s.id) ?? 0) : null,
          noQtyStrandedWithoutActiveCycle:
            s.orderType === "NO_QTY" &&
            s.internalStatus === "OPEN" &&
            (noQtyActiveCycleCountBySoId.get(s.id) ?? 0) === 0,
        })),
      );
    } catch (e) {
      return next(e);
    }
  },
);

salesOrderRouter.get(
  "/:id/rm-check",
  requireAuth,
  requireRole(["ADMIN", "STORE", "SALES", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      const data = await rmCheckForSalesOrder(soId);
      const strict = await getStrictInventoryControl();
      const sufficient = data.allFgEnough && data.allRmEnough;
      return res.json({
        ...data,
        strictInventoryControl: strict,
        /** WO / downstream flows do not block on RM check; UI may still warn when strict + shortage. */
        proceedAllowed: true,
        blockMessage:
          strict && !sufficient
            ? "Strict Inventory Control is ON. Review shortage before proceeding."
            : null,
      });
    } catch (e) {
      return next(e);
    }
  },
);

salesOrderRouter.put(
  "/:id/status",
  requireAuth,
  requireRole(["ADMIN", "STORE", "SALES"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      const { internalStatus } = z.object({ internalStatus: statusEnum }).parse(req.body);
      const row = await prisma.$transaction(async (tx) => {
        const existing = await tx.salesOrder.findUnique({
          where: { id: soId },
          select: { internalStatus: true },
        });
        if (!existing) {
          const err = new Error("Sales order not found");
          err.statusCode = 404;
          throw err;
        }
        if (internalStatus === existing.internalStatus) {
          return tx.salesOrder.findUnique({
            where: { id: soId },
            include: soInclude,
          });
        }
        if (internalStatus === "DRAFT" && existing.internalStatus !== "DRAFT") {
          const err = new Error(
            "Cannot set a sales order back to DRAFT after it has been approved or processed.",
          );
          err.statusCode = 400;
          throw err;
        }
        if (internalStatus === "COMPLETED") {
          await lockSalesOrderAndAssertCanComplete(tx, soId);
        }
        const updated = await tx.salesOrder.update({
          where: { id: soId },
          data: { internalStatus },
          include: soInclude,
        });
        if (internalStatus === "APPROVED") {
          await auditLog.write(tx, {
            action: auditLog.AuditAction.APPROVE,
            entityType: auditLog.AuditEntityType.SALES_ORDER,
            entityId: String(soId),
            actorUserId: req.user.userId,
            actorRole: req.user.role,
            summary: formatSalesOrderApproveSummary(soId, updated),
            payload: {
              changes: {
                internalStatus: { from: existing.internalStatus, to: "APPROVED" },
              },
            },
          });
          const docLabel = displaySalesOrderNo(soId, updated.docNo);
          await logActivity({
            tx,
            user: req.user,
            module: ACTIVITY_MODULES.SALES_ORDER,
            entityType: ACTIVITY_ENTITY_TYPES.SALES_ORDER,
            entityId: soId,
            docNo: docLabel,
            action: ACTIVITY_ACTIONS.APPROVED,
            message: `Sales Order ${docLabel} approved`,
            metadata: salesOrderActivityMeta(updated),
          });
        }
        if (internalStatus === "COMPLETED" && existing.internalStatus !== "COMPLETED") {
          const docLabel = displaySalesOrderNo(soId, updated.docNo);
          await logActivity({
            tx,
            user: req.user,
            module: ACTIVITY_MODULES.SALES_ORDER,
            entityType: ACTIVITY_ENTITY_TYPES.SALES_ORDER,
            entityId: soId,
            docNo: docLabel,
            action: ACTIVITY_ACTIONS.CLOSED,
            message: `Sales Order ${docLabel} closed`,
            metadata: salesOrderActivityMeta(updated),
          });
        }
        return updated;
      });
      const [out] = await enrichSalesOrdersWithProcessStage(prisma, [enrichSalesOrderWithDispatchStats(row)]);
      return res.json(out);
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * Manual creation: NO_QTY sales order without quotation link.
 * POST /api/sales-orders/no-qty
 */
salesOrderRouter.post(
  "/no-qty",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE"]),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          customerId: z.number().int().positive(),
          customerPoReference: z.string().optional().nullable(),
          remarks: z.string().optional().nullable(),
          items: z
            .array(
              z.object({
                itemId: z.number().int().positive(),
                rate: z.number(),
              }),
            )
            .min(1),
        })
        .parse(req.body);

      const so = await prisma.$transaction(async (tx) => {
        if (!body.items || body.items.length === 0) {
          const err = new Error("At least one item is required");
          err.statusCode = 400;
          throw err;
        }
        const customer = await tx.customer.findUnique({ where: { id: body.customerId } });
        if (!customer) {
          const err = new Error("Customer not found");
          err.statusCode = 400;
          throw err;
        }

        const itemIds = [...new Set(body.items.map((x) => x.itemId))];
        if (itemIds.length !== body.items.length) {
          const err = new Error("Duplicate items are not allowed.");
          err.statusCode = 400;
          throw err;
        }

        for (const it of body.items) {
          if (!it.rate || Number(it.rate) <= 0) {
            const err = new Error("Rate must be greater than 0");
            err.statusCode = 400;
            throw err;
          }
        }

        const items = await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, itemType: true } });
        const ok = new Set(items.filter((i) => i.itemType === "FG").map((i) => i.id));
        for (const it of itemIds) {
          if (!ok.has(it)) {
            const err = new Error("Only FG items are allowed in No Qty SO.");
            err.statusCode = 400;
            throw err;
          }
        }

        const createdSo = await tx.salesOrder.create({
          data: {
            docNo: await allocateDocNo(tx, { docType: DocType.SALES_ORDER, date: new Date() }),
            customerId: body.customerId,
            quotationId: null,
            poId: null,
            customerPoReference: body.customerPoReference?.trim() || null,
            remarks: body.remarks?.trim() || null,
            orderType: "NO_QTY",
            internalStatus: "OPEN",
            lines: {
              create: body.items.map((x) => ({
                itemId: x.itemId,
                qty: 0,
                customerPoQty: 0,
                bufferPercent: 0,
                rate: new Prisma.Decimal(Number(x.rate)),
                isFree: false,
                quotationLineId: null,
              })),
            },
          },
          include: soInclude,
        });
        // Create cycle 1 immediately so downstream screens can rely on currentCycleId.
        const c1 = await tx.salesOrderCycle.create({
          data: { salesOrderId: createdSo.id, cycleNo: 1, status: "ACTIVE" },
          select: { id: true },
        });
        await tx.salesOrder.update({ where: { id: createdSo.id }, data: { currentCycleId: c1.id } });
        await auditLog.write(tx, {
          action: auditLog.AuditAction.CREATE,
          entityType: auditLog.AuditEntityType.SALES_ORDER,
          entityId: String(createdSo.id),
          actorUserId: req.user.userId,
          actorRole: req.user.role,
          summary: `No Qty sales order SO-${createdSo.id} created`,
          payload: {
            module: "SALES",
            actionLabel: "CREATE",
            ref: { type: "SO", id: String(createdSo.id), no: `SO-${createdSo.id}` },
            snapshot: { orderType: "NO_QTY", customerId: createdSo.customerId, lineCount: createdSo.lines?.length ?? null },
            status: { from: null, to: createdSo.internalStatus },
          },
        });
        return { ...createdSo, currentCycleId: c1.id };
      });

      const [out] = await enrichSalesOrdersWithProcessStage(prisma, [enrichSalesOrderWithDispatchStats(so)]);
      return res.status(201).json(out);
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * Cancel approval: return an approved (not yet processed) sales order to DRAFT. Reason required.
 * POST /api/sales-orders/:id/cancel-approval
 */
salesOrderRouter.post(
  "/:id/cancel-approval",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) {
        const err = new Error("Invalid sales order id.");
        err.statusCode = 400;
        throw err;
      }
      const body = z.object({ reason: z.string().min(1, "Reason is required.") }).parse(req.body);
      const reason = body.reason.trim();
      if (!reason) {
        const err = new Error("Reason is required.");
        err.statusCode = 400;
        throw err;
      }

      const row = await prisma.$transaction(async (tx) => {
        const existing = await tx.salesOrder.findUnique({
          where: { id: soId },
          include: soInclude,
        });
        if (!existing) {
          const err = new Error("Sales order not found");
          err.statusCode = 404;
          throw err;
        }
        if (existing.internalStatus !== "APPROVED") {
          const err = new Error("Cancel approval is allowed only while the sales order is in APPROVED status.");
          err.statusCode = 409;
          throw err;
        }
        const [woCount, dispCount, rsCount] = await Promise.all([
          tx.workOrder.count({ where: { salesOrderId: soId } }),
          tx.dispatch.count({ where: { soId } }),
          tx.requirementSheet.count({ where: { salesOrderId: soId } }),
        ]);
        if (woCount > 0 || dispCount > 0 || rsCount > 0) {
          const err = new Error(
            "Cannot cancel approval while requirement sheets, work orders, or dispatch records exist for this sales order.",
          );
          err.statusCode = 409;
          throw err;
        }

        const updated = await tx.salesOrder.update({
          where: { id: soId },
          data: { internalStatus: "DRAFT" },
          include: soInclude,
        });

        const docLabel = displaySalesOrderNo(soId, updated.docNo);
        await logActivity({
          tx,
          user: req.user,
          module: ACTIVITY_MODULES.SALES_ORDER,
          entityType: ACTIVITY_ENTITY_TYPES.SALES_ORDER,
          entityId: soId,
          docNo: docLabel,
          action: ACTIVITY_ACTIONS.APPROVAL_CANCELLED,
          message: `Sales Order ${docLabel} approval cancelled`,
          reason,
          metadata: salesOrderActivityMeta(updated),
        });

        return updated;
      });

      const [out] = await enrichSalesOrdersWithProcessStage(prisma, [enrichSalesOrderWithDispatchStats(row)]);
      return res.json(out);
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * NO_QTY only: manually close the sales order container (cycles remain unchanged).
 * POST /api/sales-orders/:id/close
 */
salesOrderRouter.post(
  "/:id/close",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) {
        const err = new Error("Invalid sales order id.");
        err.statusCode = 400;
        throw err;
      }

      const row = await prisma.$transaction(async (tx) => {
        const so = await tx.salesOrder.findUnique({ where: { id: soId }, include: soInclude });
        if (!so) {
          const err = new Error("Sales order not found");
          err.statusCode = 404;
          throw err;
        }
        if (so.orderType !== "NO_QTY") {
          const err = new Error("Close is allowed only for No Qty sales orders.");
          err.statusCode = 409;
          throw err;
        }
        if (so.internalStatus === "CLOSED") return so;

        const updated = await tx.salesOrder.update({
          where: { id: soId },
          data: { internalStatus: "CLOSED" },
          include: soInclude,
        });
        const docLabel = displaySalesOrderNo(soId, updated.docNo);
        await logActivity({
          tx,
          user: req.user,
          module: ACTIVITY_MODULES.SALES_ORDER,
          entityType: ACTIVITY_ENTITY_TYPES.SALES_ORDER,
          entityId: soId,
          docNo: docLabel,
          action: ACTIVITY_ACTIONS.CLOSED,
          message: `Sales Order ${docLabel} closed`,
          metadata: salesOrderActivityMeta(updated),
        });
        return updated;
      });

      const [out] = await enrichSalesOrdersWithProcessStage(prisma, [enrichSalesOrderWithDispatchStats(row)]);
      return res.json(out);
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * NO_QTY only: reopen a manually closed sales order (cycles remain unchanged).
 * POST /api/sales-orders/:id/reopen
 */
salesOrderRouter.post(
  "/:id/reopen",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) {
        const err = new Error("Invalid sales order id.");
        err.statusCode = 400;
        throw err;
      }

      const row = await prisma.$transaction(async (tx) => {
        const so = await tx.salesOrder.findUnique({ where: { id: soId }, include: soInclude });
        if (!so) {
          const err = new Error("Sales order not found");
          err.statusCode = 404;
          throw err;
        }
        if (so.orderType !== "NO_QTY") {
          const err = new Error("Reopen is allowed only for No Qty sales orders.");
          err.statusCode = 409;
          throw err;
        }
        if (so.internalStatus !== "CLOSED") {
          const err = new Error("Only closed No Qty sales orders can be reopened.");
          err.statusCode = 409;
          throw err;
        }

        const updated = await tx.salesOrder.update({
          where: { id: soId },
          data: { internalStatus: "OPEN" },
          include: soInclude,
        });
        const docLabel = displaySalesOrderNo(soId, updated.docNo);
        await logActivity({
          tx,
          user: req.user,
          module: ACTIVITY_MODULES.SALES_ORDER,
          entityType: ACTIVITY_ENTITY_TYPES.SALES_ORDER,
          entityId: soId,
          docNo: docLabel,
          action: ACTIVITY_ACTIONS.REOPENED,
          message: `Sales Order ${docLabel} reopened`,
          metadata: salesOrderActivityMeta(updated),
        });
        return updated;
      });

      const [out] = await enrichSalesOrdersWithProcessStage(prisma, [enrichSalesOrderWithDispatchStats(row)]);
      return res.json(out);
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * NO_QTY only (admin): Diagnose why current cycle isn't auto-closed.
 * GET /api/sales-orders/:id/no-qty-cycle/auto-close-diagnose
 */
salesOrderRouter.get(
  "/:id/no-qty-cycle/auto-close-diagnose",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can view auto-close diagnostics."),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) return res.status(400).json({ error: { message: "Invalid sales order id." } });
      const diag = await prisma.$transaction((tx) => diagnoseNoQtyCycleAutoClose(tx, { soId }));
      return res.json(diag);
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * NO_QTY only: Minimal flow evidence for the current active cycle.
 * Used by frontend step bars / back navigation helpers.
 *
 * GET /api/sales-orders/:id/no-qty-flow-state
 */
salesOrderRouter.get(
  "/:id/no-qty-flow-state",
  requireAuth,
  requireRole(["ADMIN", "STORE", "SALES", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) {
        const err = new Error("Invalid sales order id.");
        err.statusCode = 400;
        throw err;
      }

      const head = await prisma.salesOrder.findUnique({
        where: { id: soId },
        select: { id: true, orderType: true, currentCycleId: true, internalStatus: true },
      });
      if (!head) {
        const err = new Error("Sales order not found");
        err.statusCode = 404;
        throw err;
      }
      // Never hard-fail the UI with 400 for a valid SO id.
      // Frontend uses this endpoint for guided flow; for non-NO_QTY SOs, return a safe no-op payload.
      if (head.orderType !== "NO_QTY") {
        const isCompleted =
          head.internalStatus === "COMPLETED" || head.internalStatus === "CLOSED";
        return res.json({
          salesOrderId: soId,
          cycleId: null,
          isCompleted,
          requirementExists: false,
          requirementLocked: false,
          workOrderExists: false,
          workOrderId: null,
          productionExists: false,
          qcExists: false,
          dispatchExists: false,
          salesBillExists: false,
          nextAction: "REQUIREMENT",
          activeStep: 1,
        });
      }

      const cycleIdFromQueryRaw = Number(req.query?.cycleId ?? 0);
      const cycleIdFromQuery =
        Number.isFinite(cycleIdFromQueryRaw) && cycleIdFromQueryRaw > 0 ? cycleIdFromQueryRaw : null;
      const cycleIdRaw = cycleIdFromQuery ?? (head.currentCycleId != null ? Number(head.currentCycleId) : 0);
      const cycleId = Number.isFinite(cycleIdRaw) && cycleIdRaw > 0 ? cycleIdRaw : null;

      if (!cycleId) {
        return res.json({
          salesOrderId: soId,
          cycleId: null,
          isCompleted: head.internalStatus === "COMPLETED" || head.internalStatus === "CLOSED",
          requirementExists: false,
          requirementLocked: false,
          workOrderExists: false,
          workOrderId: null,
          productionExists: false,
          qcExists: false,
          dispatchExists: false,
          salesBillExists: false,
          nextAction: "REQUIREMENT",
          activeStep: 1,
        });
      }

      const [reqSheets, workOrders, prodAny, qcAny, dispatchRows] = await prisma.$transaction([
        prisma.requirementSheet.findMany({
          where: { salesOrderId: soId, cycleId },
          select: { id: true, status: true },
        }),
        prisma.workOrder.findMany({
          where: { salesOrderId: soId, cycleId, status: { not: "REJECTED" } },
          select: { id: true, status: true },
        }),
        prisma.productionEntry.findFirst({
          where: {
            workflowStatus: "APPROVED",
            workOrderLine: { workOrder: { salesOrderId: soId, cycleId } },
          },
          select: { id: true },
        }),
        prisma.qcEntry.findFirst({
          where: {
            reversedAt: null,
            production: { workOrderLine: { workOrder: { salesOrderId: soId, cycleId } } },
          },
          select: { id: true },
        }),
        prisma.dispatch.findMany({
          where: { soId, cycleId, reversalOfId: null },
          select: { id: true, workflowStatus: true },
        }),
      ]);

      const requirementExists = (reqSheets || []).length > 0;
      const requirementLocked = (reqSheets || []).some((s) => s.status === "LOCKED");
      const workOrderExists = (workOrders || []).length > 0;
      const workOrderId = workOrders && workOrders.length ? Number(workOrders[workOrders.length - 1].id) : null;
      const productionExists = Boolean(prodAny?.id);
      const qcExists = Boolean(qcAny?.id);
      const dispatchExists = (dispatchRows || []).some((d) => d.workflowStatus === "LOCKED");

      const dispatchIds = (dispatchRows || []).map((d) => d.id).filter((id) => Number.isFinite(id) && id > 0);
      const billAny = dispatchIds.length
        ? await prisma.salesBill.findFirst({
            where: { dispatchId: { in: dispatchIds }, status: { in: ["DRAFT", "FINALIZED"] } },
            select: { id: true },
          })
        : null;
      const salesBillExists = Boolean(billAny?.id);

      const isCompleted = head.internalStatus === "COMPLETED" || head.internalStatus === "CLOSED";

      // NO_QTY: if requirement is locked and dispatchable stock exists (even with no WO/QC/production),
      // the correct next action is Dispatch (stock-covered flow).
      const NO_QTY_EPS = 1e-6;
      let noQtyDispatchableNow = false;
      if (head.orderType === "NO_QTY" && requirementLocked && cycleId != null) {
        const sheet = await prisma.requirementSheet.findFirst({
          where: { salesOrderId: soId, cycleId, status: "LOCKED" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: { lines: true },
        });
        if (sheet && (sheet.lines || []).length) {
          const capsByItemId = new Map();
          for (const ln of sheet.lines || []) {
            const cap = Math.max(Number(ln.requirementQty ?? 0), Number(ln.suggestedWoQtySnapshot ?? 0));
            if (Number.isFinite(cap) && cap > NO_QTY_EPS) {
              capsByItemId.set(Number(ln.itemId), cap);
            }
          }

          if (capsByItemId.size) {
            const dispatchRowsAll = await prisma.dispatch.findMany({
              where: { soId, cycleId },
              select: { itemId: true, dispatchedQty: true },
            });
            const netByItem = new Map();
            for (const d of dispatchRowsAll) {
              const id = Number(d.itemId);
              const q = Number(d.dispatchedQty ?? 0);
              if (!Number.isFinite(id) || !Number.isFinite(q)) continue;
              netByItem.set(id, (netByItem.get(id) ?? 0) + q);
            }

            const itemIds = [...capsByItemId.keys()];
            const stockRows = await prisma.stockTransaction.groupBy({
              by: ["itemId"],
              where: { stockBucket: "USABLE", itemId: { in: itemIds } },
              _sum: { qtyIn: true, qtyOut: true },
            });
            const usableByItemId = new Map(stockRows.map((r) => [Number(r.itemId), Number(r._sum.qtyIn ?? 0) - Number(r._sum.qtyOut ?? 0)]));

            for (const [itemId, cap] of capsByItemId.entries()) {
              const usable = usableByItemId.get(itemId) ?? 0;
              // NO_QTY dispatch is not cycle-capped. If usable stock exists for any planned item, dispatch is the correct next action.
              if (usable > NO_QTY_EPS) {
                noQtyDispatchableNow = true;
                break;
              }
            }
          }
        }
      }

      let nextAction = (() => {
        if (salesBillExists) return "SALES_BILL";
        if (dispatchExists) return "SALES_BILL";
        if (qcExists) return "DISPATCH";
        if (productionExists) return "QC";
        if (workOrderExists) return "PRODUCTION";
        if (requirementLocked) return noQtyDispatchableNow ? "DISPATCH" : "WORK_ORDER";
        return "REQUIREMENT";
      })();

      // Safeguard: if a work order exists, we must never send the user back to "WORK_ORDER".
      if (workOrderExists && nextAction === "WORK_ORDER") {
        nextAction = "PRODUCTION";
      }

      const activeStep = (() => {
        if (salesBillExists) return 6;
        if (dispatchExists) return 5;
        if (qcExists) return 4;
        if (productionExists) return 3;
        if (requirementLocked && noQtyDispatchableNow) return 5;
        if (workOrderExists || requirementLocked) return 2;
        return 1;
      })();

      return res.json({
        salesOrderId: soId,
        cycleId,
        isCompleted,
        requirementExists,
        requirementLocked,
        workOrderExists,
        workOrderId,
        productionExists,
        qcExists,
        dispatchExists,
        salesBillExists,
        nextAction,
        activeStep,
      });
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * NO_QTY only (admin): Attempt auto-close now (safe repair for historical rows).
 * POST /api/sales-orders/:id/no-qty-cycle/auto-close
 */
salesOrderRouter.post(
  "/:id/no-qty-cycle/auto-close",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can auto-close a cycle."),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) return res.status(400).json({ error: { message: "Invalid sales order id." } });
      const result = await prisma.$transaction(async (tx) => {
        const diag = await diagnoseNoQtyCycleAutoClose(tx, { soId });
        if (!diag?.currentCycleId || !diag.wouldClose) return { attempted: false, diag };
        const r = await maybeAutoCloseNoQtyCycle(tx, { soId, cycleId: Number(diag.currentCycleId) });
        return { attempted: true, closed: Boolean(r.closed), reason: r.reason ?? null, diag };
      });
      return res.json(result);
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * NO_QTY only: Close an empty active cycle (e.g. after reopen + deleted draft requirement).
 * Restores SO to COMPLETED and points currentCycleId at the previous closed cycle.
 * POST /api/sales-orders/:id/no-qty-cycle/close-empty
 */
salesOrderRouter.post(
  "/:id/no-qty-cycle/close-empty",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) {
        const err = new Error("Invalid sales order id.");
        err.statusCode = 400;
        throw err;
      }
      const body = z.object({ reason: z.string().optional().nullable() }).parse(req.body ?? {});

      const out = await prisma.$transaction(async (tx) => {
        const result = await closeEmptyNoQtyActiveCycle(tx, { salesOrderId: soId });
        await auditLog.write(tx, {
          action: auditLog.AuditAction.UPDATE,
          entityType: auditLog.AuditEntityType.SALES_ORDER,
          entityId: String(soId),
          actorUserId: req.user.userId,
          actorRole: req.user.role,
          summary: `No Qty SO empty cycle closed (cycle ${result.closedCycleNo}).`,
          payload: {
            module: "SALES",
            actionLabel: "NO_QTY_CLOSE_EMPTY_CYCLE",
            closedCycleId: result.closedCycleId,
            closedCycleNo: result.closedCycleNo,
            priorCycleId: result.priorCycleId,
            reason: body.reason?.trim() || null,
          },
          reason: body.reason?.trim() || undefined,
        });
        return result;
      });

      const row = await prisma.salesOrder.findUnique({
        where: { id: soId },
        include: soInclude,
      });
      const [enriched] = await enrichSalesOrdersWithProcessStage(prisma, [enrichSalesOrderWithDispatchStats(row)]);
      return res.json({ ...out, salesOrder: enriched });
    } catch (e) {
      return next(e);
    }
  },
);

/** Update draft SO: remarks, PO ref, line qtys and delete lines (no new items). */
salesOrderRouter.put(
  "/:id",
  requireAuth,
  requireRole(["ADMIN", "STORE", "SALES"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      const body = z
        .object({
          customerPoReference: z.string().nullable().optional(),
          remarks: z.string().nullable().optional(),
          lines: z
            .array(
              z.object({
                lineId: z.number().int(),
                qty: z.number().nonnegative().optional(),
                customerPoQty: z.number().nonnegative().optional(),
                bufferPercent: z.number().min(0).optional(),
              }),
            )
            .min(1),
        })
        .parse(req.body);

      const result = await prisma.$transaction(async (tx) => {
        const maxBufRow = await tx.appSetting.findUnique({
          where: { id: 1 },
          select: { maxRegularSoBufferPercent: true },
        });
        const maxBuf = clampMaxRegularSoBufferPercent(maxBufRow?.maxRegularSoBufferPercent);

        const so = await tx.salesOrder.findUnique({
          where: { id: soId },
          include: { lines: true, dispatch: true, quotation: { include: { lines: true } } },
        });
        if (!so) {
          const err = new Error("Sales order not found");
          err.statusCode = 404;
          throw err;
        }
        if (so.internalStatus !== "DRAFT") {
          const err = new Error("Only draft sales orders can be edited.");
          err.statusCode = 409;
          throw err;
        }

        if (so.orderType === "REPLACEMENT") {
          const keepIds = new Set(body.lines.map((x) => x.lineId));
          if (keepIds.size !== 1 || so.lines.length !== 1 || !keepIds.has(so.lines[0].id)) {
            const err = new Error("Replacement order item cannot be changed (phase 1).");
            err.statusCode = 400;
            throw err;
          }
        }

        // NORMAL/REPLACEMENT: positive quantities enforced in normalizeSalesOrderDraftLineQuantities.
        if (so.orderType !== "NO_QTY") {
          for (const upd of body.lines) {
            normalizeSalesOrderDraftLineQuantities(upd, so.orderType, maxBuf);
          }
        } else {
          // NO_QTY: quantities must remain 0 (planning comes from requirement sheet).
          if (body.lines.some((x) => Number(x.qty ?? 0) !== 0)) {
            const err = new Error("No Qty SO line quantity must be 0.");
            err.statusCode = 400;
            throw err;
          }
        }

        for (const upd of body.lines) {
          const exists = so.lines.some((l) => l.id === upd.lineId);
          if (!exists) {
            const err = new Error(`Invalid line ${upd.lineId}`);
            err.statusCode = 400;
            throw err;
          }
        }

        const allowedItemIds = so.quotation
          ? new Set(so.quotation.lines.map((l) => l.itemId))
          : new Set(so.lines.map((l) => l.itemId));

        const keepIds = new Set(body.lines.map((x) => x.lineId));
        for (const ln of so.lines) {
          if (!keepIds.has(ln.id)) {
            if (await workOrderLineExistsForSoItem(tx, soId, ln.itemId)) {
              const err = new Error(
                "Cannot remove a sales order line that is still referenced on a work order for this order.",
              );
              err.statusCode = 400;
              throw err;
            }
            const attributedDispatch = getAttributedDispatchQtyForSalesOrderLine(
              so.lines,
              so.dispatch || [],
              ln.id,
              so.orderType,
            );
            if (attributedDispatch > INTEGRITY_EPS) {
              const err = new Error(
                "Cannot remove a sales order line that still has dispatch quantity attributed to it (FIFO by line).",
              );
              err.statusCode = 400;
              throw err;
            }
            await tx.salesOrderLine.delete({ where: { id: ln.id } });
          }
        }

        const updatedSo = await tx.salesOrder.findUnique({
          where: { id: soId },
          include: { lines: true, dispatch: true },
        });

        const netDispatched = netDispatchedByItemId(updatedSo.dispatch || []);
        const proposedQtyByLineId = new Map(updatedSo.lines.map((l) => [l.id, Number(l.qty)]));
        for (const upd of body.lines) {
          if (so.orderType === "NO_QTY") {
            proposedQtyByLineId.set(upd.lineId, 0);
          } else {
            const n = normalizeSalesOrderDraftLineQuantities(upd, so.orderType, maxBuf);
            proposedQtyByLineId.set(upd.lineId, n.plannedQty);
          }
        }
        const itemIdsToValidate = new Set(
          body.lines.map((u) => updatedSo.lines.find((l) => l.id === u.lineId)?.itemId).filter((id) => id != null),
        );
        const woPlannedByItemId = new Map();
        const producedByItemId = new Map();
        for (const itemId of itemIdsToValidate) {
          woPlannedByItemId.set(itemId, await totalWoPlannedQtyForSoItem(tx, soId, itemId));
          producedByItemId.set(itemId, await totalProducedQtyForSoItem(tx, soId, itemId));
        }
        const lineInputs = updatedSo.lines.map((l) => ({ id: l.id, itemId: l.itemId, qty: Number(l.qty) }));
        const violations = getDraftSoItemQtyFloorViolations({
          lines: lineInputs,
          proposedQtyByLineId,
          itemIdsToValidate,
          netDispatchedByItemId: netDispatched,
          woPlannedByItemId,
          producedByItemId,
          eps: INTEGRITY_EPS,
        });
        if (violations.length > 0) {
          const err = new Error(formatDraftSoFloorViolationMessage(violations[0]));
          err.statusCode = 400;
          throw err;
        }

        for (const upd of body.lines) {
          const line = updatedSo.lines.find((l) => l.id === upd.lineId);
          if (!line) {
            const err = new Error(`Invalid line ${upd.lineId}`);
            err.statusCode = 400;
            throw err;
          }
          if (!allowedItemIds.has(line.itemId)) {
            const err = new Error("Line item does not match quotation");
            err.statusCode = 400;
            throw err;
          }
          if (so.orderType === "NO_QTY") {
            await tx.salesOrderLine.update({
              where: { id: line.id },
              data: { qty: "0", customerPoQty: "0", bufferPercent: "0" },
            });
          } else {
            const n = normalizeSalesOrderDraftLineQuantities(upd, so.orderType, maxBuf);
            await tx.salesOrderLine.update({
              where: { id: line.id },
              data: {
                qty: String(n.plannedQty),
                customerPoQty: String(n.customerPoQty),
                bufferPercent: String(n.bufferPercent),
              },
            });
          }
        }

        const saved = await tx.salesOrder.update({
          where: { id: soId },
          data: {
            customerPoReference:
              body.customerPoReference === undefined ? undefined : body.customerPoReference?.trim() || null,
            remarks: body.remarks === undefined ? undefined : body.remarks?.trim() || null,
          },
          include: soInclude,
        });

        await assertReplacementSoQtyWithinAvailable(tx, saved);
        return saved;
      });

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  },
);

salesOrderRouter.patch(
  "/:id/meta",
  requireAuth,
  requireRole(["ADMIN", "STORE", "SALES"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      const schema = z.object({
        customerPoReference: z.string().nullable().optional(),
        remarks: z.string().nullable().optional(),
        quotationId: z.number().int().nullable().optional(),
        internalStatus: statusEnum.optional(),
      });
      const body = schema.parse(req.body);

      const row = await prisma.$transaction(async (tx) => {
        const soHead = await tx.salesOrder.findUnique({
          where: { id: soId },
          select: { internalStatus: true },
        });
        if (!soHead) {
          const err = new Error("Sales order not found");
          err.statusCode = 404;
          throw err;
        }

        if (soHead.internalStatus === "COMPLETED") {
          const hasAnyField = Object.keys(body).length > 0;
          if (hasAnyField) {
            const err = new Error("This sales order is completed and read-only.");
            err.statusCode = 409;
            throw err;
          }
          return tx.salesOrder.findUnique({
            where: { id: soId },
            include: soInclude,
          });
        }

        if (body.internalStatus === "COMPLETED") {
          await lockSalesOrderAndAssertCanComplete(tx, soId);
        }

        const so = await tx.salesOrder.findUnique({
          where: { id: soId },
          include: { quotation: { include: { enquiry: true } }, customer: true, po: true },
        });
        if (!so) {
          const err = new Error("Sales order not found");
          err.statusCode = 404;
          throw err;
        }

        if (body.internalStatus === "DRAFT" && so.internalStatus !== "DRAFT") {
          const err = new Error(
            "Cannot set a sales order back to DRAFT after it has been approved or processed.",
          );
          err.statusCode = 400;
          throw err;
        }

        if (body.quotationId !== undefined) {
          const nextQ = body.quotationId === null ? null : body.quotationId;
          if (nextQ !== so.quotationId) {
            const woCount = await tx.workOrder.count({ where: { salesOrderId: soId } });
            const dispCount = await tx.dispatch.count({ where: { soId } });
            if (so.internalStatus !== "DRAFT") {
              const err = new Error("Quotation link can only be changed while the sales order is in DRAFT.");
              err.statusCode = 400;
              throw err;
            }
            if (woCount > 0 || dispCount > 0) {
              const err = new Error(
                "Cannot change quotation link while work orders or dispatch records exist for this sales order.",
              );
              err.statusCode = 400;
              throw err;
            }
          }
        }

        let nextQuotationId = so.quotationId;
        if (body.quotationId !== undefined) {
          if (body.quotationId === null) {
            nextQuotationId = null;
          } else {
            const q = await tx.quotation.findUnique({
              where: { id: body.quotationId },
              include: { enquiry: true, salesOrder: true },
            });
            if (!q) {
              const err = new Error("Quotation not found");
              err.statusCode = 404;
              throw err;
            }
            if (q.salesOrder && q.salesOrder.id !== soId) {
              const err = new Error("Quotation already linked to another sales order");
              err.statusCode = 400;
              throw err;
            }
            const cid = so.customerId ?? so.po?.customerId;
            if (cid != null && q.enquiry.customerId !== cid) {
              const err = new Error("Quotation customer must match sales order customer");
              err.statusCode = 400;
              throw err;
            }
            if (q.workflowStatus !== "APPROVED") {
              const err = new Error("Sales Order can only be created from an approved quotation.");
              err.statusCode = 409;
              throw err;
            }
            nextQuotationId = body.quotationId;
          }
        }

        const updatedMeta = await tx.salesOrder.update({
          where: { id: soId },
          data: {
            customerPoReference:
              body.customerPoReference === undefined ? undefined : body.customerPoReference?.trim() || null,
            remarks: body.remarks === undefined ? undefined : body.remarks?.trim() || null,
            quotationId: body.quotationId === undefined ? undefined : nextQuotationId,
            internalStatus: body.internalStatus ?? undefined,
          },
          include: soInclude,
        });
        if (body.internalStatus === "COMPLETED" && so.internalStatus !== "COMPLETED") {
          const docLabel = displaySalesOrderNo(soId, updatedMeta.docNo);
          await logActivity({
            tx,
            user: req.user,
            module: ACTIVITY_MODULES.SALES_ORDER,
            entityType: ACTIVITY_ENTITY_TYPES.SALES_ORDER,
            entityId: soId,
            docNo: docLabel,
            action: ACTIVITY_ACTIONS.CLOSED,
            message: `Sales Order ${docLabel} closed`,
            metadata: salesOrderActivityMeta(updatedMeta),
          });
        }
        return updatedMeta;
      });

      const [out] = await enrichSalesOrdersWithProcessStage(prisma, [enrichSalesOrderWithDispatchStats(row)]);
      return res.json(out);
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * NO_QTY only: Close an empty active cycle (e.g. after reopen + deleted draft requirement).
 * Restores SO to COMPLETED and points currentCycleId at the previous closed cycle.
 * POST /api/sales-orders/:id/no-qty-cycle/close-empty
 */
salesOrderRouter.post(
  "/:id/no-qty-cycle/close-empty",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) {
        const err = new Error("Invalid sales order id.");
        err.statusCode = 400;
        throw err;
      }
      const body = z.object({ reason: z.string().optional().nullable() }).parse(req.body ?? {});

      const out = await prisma.$transaction(async (tx) => {
        const result = await closeEmptyNoQtyActiveCycle(tx, { salesOrderId: soId });
        await auditLog.write(tx, {
          action: auditLog.AuditAction.UPDATE,
          entityType: auditLog.AuditEntityType.SALES_ORDER,
          entityId: String(soId),
          actorUserId: req.user.userId,
          actorRole: req.user.role,
          summary: `No Qty SO empty cycle closed (cycle ${result.closedCycleNo}).`,
          payload: {
            module: "SALES",
            actionLabel: "NO_QTY_CLOSE_EMPTY_CYCLE",
            closedCycleId: result.closedCycleId,
            closedCycleNo: result.closedCycleNo,
            priorCycleId: result.priorCycleId,
            reason: body.reason?.trim() || null,
          },
          reason: body.reason?.trim() || undefined,
        });
        return result;
      });

      const row = await prisma.salesOrder.findUnique({
        where: { id: soId },
        include: soInclude,
      });
      const [enriched] = await enrichSalesOrdersWithProcessStage(prisma, [enrichSalesOrderWithDispatchStats(row)]);
      return res.json({ ...out, salesOrder: enriched });
    } catch (e) {
      return next(e);
    }
  },
);

salesOrderRouter.get(
  "/:id",
  requireAuth,
  requireRole(["ADMIN", "STORE", "SALES", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      const row = await prisma.salesOrder.findUnique({
        where: { id: soId },
        include: soInclude,
      });
      if (!row) {
        const err = new Error("Sales order not found");
        err.statusCode = 404;
        throw err;
      }
      const [out] = await enrichSalesOrdersWithProcessStage(prisma, [enrichSalesOrderWithDispatchStats(row)]);
      return res.json(out);
    } catch (e) {
      return next(e);
    }
  },
);

salesOrderRouter.patch(
  "/:id/lines",
  requireAuth,
  requireRole(["ADMIN", "STORE"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      const body = z
        .object({
          lines: z
            .array(
              z.object({
                lineId: z.number().int(),
                qty: z.number().nonnegative().optional(),
                customerPoQty: z.number().nonnegative().optional(),
                bufferPercent: z.number().min(0).optional(),
              }),
            )
            .min(1),
        })
        .parse(req.body);

      const result = await prisma.$transaction(async (tx) => {
        const maxBufRow = await tx.appSetting.findUnique({
          where: { id: 1 },
          select: { maxRegularSoBufferPercent: true },
        });
        const maxBuf = clampMaxRegularSoBufferPercent(maxBufRow?.maxRegularSoBufferPercent);

        const so = await tx.salesOrder.findUnique({
          where: { id: soId },
          include: { lines: true, dispatch: true },
        });
        if (!so) {
          const err = new Error("Sales order not found");
          err.statusCode = 404;
          throw err;
        }
        if (so.internalStatus !== "DRAFT") {
          const err = new Error("Only draft sales orders can be edited.");
          err.statusCode = 409;
          throw err;
        }

        if (so.orderType === "REPLACEMENT") {
          const keepIds = new Set(body.lines.map((x) => x.lineId));
          if (keepIds.size !== 1 || so.lines.length !== 1 || !keepIds.has(so.lines[0].id)) {
            const err = new Error("Replacement order item cannot be changed (phase 1).");
            err.statusCode = 400;
            throw err;
          }
        }
        if (so.orderType === "NO_QTY") {
          if (body.lines.some((x) => Number(x.qty ?? 0) !== 0)) {
            const err = new Error("No Qty SO line quantity must be 0.");
            err.statusCode = 400;
            throw err;
          }
        } else {
          for (const upd of body.lines) {
            normalizeSalesOrderDraftLineQuantities(upd, so.orderType, maxBuf);
          }
        }
        const netDispatched = netDispatchedByItemId(so.dispatch || []);
        const proposedQtyByLineId = new Map(so.lines.map((l) => [l.id, Number(l.qty)]));
        for (const upd of body.lines) {
          if (so.orderType === "NO_QTY") {
            proposedQtyByLineId.set(upd.lineId, 0);
          } else {
            const n = normalizeSalesOrderDraftLineQuantities(upd, so.orderType, maxBuf);
            proposedQtyByLineId.set(upd.lineId, n.plannedQty);
          }
        }
        const itemIdsToValidate = new Set(
          body.lines.map((u) => so.lines.find((l) => l.id === u.lineId)?.itemId).filter((id) => id != null),
        );
        const woPlannedByItemId = new Map();
        const producedByItemId = new Map();
        for (const itemId of itemIdsToValidate) {
          woPlannedByItemId.set(itemId, await totalWoPlannedQtyForSoItem(tx, soId, itemId));
          producedByItemId.set(itemId, await totalProducedQtyForSoItem(tx, soId, itemId));
        }
        const lineInputs = so.lines.map((l) => ({ id: l.id, itemId: l.itemId, qty: Number(l.qty) }));
        const violations = getDraftSoItemQtyFloorViolations({
          lines: lineInputs,
          proposedQtyByLineId,
          itemIdsToValidate,
          netDispatchedByItemId: netDispatched,
          woPlannedByItemId,
          producedByItemId,
          eps: INTEGRITY_EPS,
        });
        if (violations.length > 0) {
          const err = new Error(formatDraftSoFloorViolationMessage(violations[0]));
          err.statusCode = 400;
          throw err;
        }
        for (const upd of body.lines) {
          const line = so.lines.find((l) => l.id === upd.lineId);
          if (!line) {
            const err = new Error(`Invalid line ${upd.lineId}`);
            err.statusCode = 400;
            throw err;
          }
          if (so.orderType === "NO_QTY") {
            await tx.salesOrderLine.update({
              where: { id: line.id },
              data: { qty: "0", customerPoQty: "0", bufferPercent: "0" },
            });
          } else {
            const n = normalizeSalesOrderDraftLineQuantities(upd, so.orderType, maxBuf);
            await tx.salesOrderLine.update({
              where: { id: line.id },
              data: {
                qty: String(n.plannedQty),
                customerPoQty: String(n.customerPoQty),
                bufferPercent: String(n.bufferPercent),
              },
            });
          }
        }
        const saved = await tx.salesOrder.findUnique({ where: { id: soId }, include: soInclude });
        await assertReplacementSoQtyWithinAvailable(tx, saved);
        return saved;
      });
      return res.json(result);
    } catch (e) {
      return next(e);
    }
  },
);

salesOrderRouter.delete(
  "/:id",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) return res.status(400).json({ ok: false, message: "Invalid sales order id." });

      const out = await prisma.$transaction(async (tx) => {
        const so = await tx.salesOrder.findUnique({
          where: { id: soId },
          select: { id: true, docNo: true, orderType: true, internalStatus: true },
        });
        if (!so) {
          const err = new Error("Sales order not found");
          err.statusCode = 404;
          throw err;
        }

        /** @type {string[]} */
        const reasons = [];

        const lockedReqCount = await tx.requirementSheet.count({
          where: { salesOrderId: soId, status: "LOCKED" },
        });
        if (lockedReqCount > 0) reasons.push("LOCKED_REQUIREMENT_SHEET_EXISTS");

        const woCount = await tx.workOrder.count({ where: { salesOrderId: soId } });
        if (woCount > 0) reasons.push("WORK_ORDER_EXISTS");

        const prodCount = await tx.productionEntry.count({
          where: { workOrderLine: { workOrder: { salesOrderId: soId } } },
        });
        if (prodCount > 0) reasons.push("PRODUCTION_ENTRY_EXISTS");

        const qcCount = await tx.qcEntry.count({
          where: { production: { workOrderLine: { workOrder: { salesOrderId: soId } } } },
        });
        if (qcCount > 0) reasons.push("QC_ENTRY_EXISTS");

        const dispatchCount = await tx.dispatch.count({ where: { soId } });
        if (dispatchCount > 0) reasons.push("DISPATCH_EXISTS");

        const billCount = await tx.salesBill.count({
          where: { dispatch: { soId }, status: { in: ["DRAFT", "FINALIZED"] } },
        });
        if (billCount > 0) reasons.push("SALES_BILL_EXISTS");

        const returnCount = await tx.customerReturn.count({
          where: { salesOrderId: soId, reversedAt: null },
        });
        if (returnCount > 0) reasons.push("CUSTOMER_RETURN_EXISTS");

        const stockAdjQcCount = await tx.stockAdjustmentQcEntry.count({
          where: { salesOrderId: soId, reversedAt: null },
        });
        if (stockAdjQcCount > 0) reasons.push("STOCK_ADJUSTMENT_QC_EXISTS");

        if (reasons.length) {
          return {
            ok: false,
            code: "SALES_ORDER_DELETE_BLOCKED",
            message: "Cannot delete this Sales Order because downstream transactions already exist.",
            reasons,
          };
        }

        // Safe delete: only draft/pre-transaction rows may exist. Remove them together.
        const draftSheets = await tx.requirementSheet.findMany({
          where: { salesOrderId: soId, status: "DRAFT" },
          select: { id: true },
          orderBy: { id: "asc" },
        });
        const draftSheetIds = draftSheets.map((s) => s.id);
        if (draftSheetIds.length) {
          await tx.requirementSheetLine.deleteMany({ where: { sheetId: { in: draftSheetIds } } });
          await tx.requirementSheet.deleteMany({ where: { id: { in: draftSheetIds } } });
        }

        await tx.salesOrderLine.deleteMany({ where: { soId } });
        await tx.salesOrderCycle.deleteMany({ where: { salesOrderId: soId } });
        await tx.salesOrder.delete({ where: { id: soId } });

        return {
          ok: true,
          deletedSalesOrderId: soId,
          deletedDraftRequirementSheetIds: draftSheetIds,
          message: "Sales Order deleted successfully.",
        };
      });

      if (out?.ok === false) {
        return res.status(409).json(out);
      }
      return res.json(out);
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { salesOrderRouter };
