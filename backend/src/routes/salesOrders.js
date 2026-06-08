const express = require("express");
const { z } = require("zod");
const { Prisma } = require("../prismaClientPackage");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  SO_WRITE_ROLES,
  SO_READ_ROLES,
  SO_DETAIL_READ_ROLES,
  WO_PLAN_PREP_ROLES,
  NEXT_RS_WRITE_ROLES,
  NO_QTY_FLOW_STATE_READ_ROLES,
  DISPATCH_WRITE_ROLES,
  MATERIAL_REQUISITION_WRITE_ROLES,
} = require("../constants/erpRoles");
const { createSalesOrderFromPo } = require("../services/salesOrderFromPo");
const { rmCheckForSalesOrder } = require("../services/rmCheckService");
const { createMaterialRequirementFromWoPlanning } = require("../services/materialPlanningService");
const { blockProcurementDemandWhenPlanningDriven } = require("../middleware/planningDrivenProcurementGuard");
const {
  buildRegularSoPlanningSnapshotView,
  regularSoPlanningSnapshotToDto,
  upsertRegularSoPlanningSnapshot,
  resolveSuggestedFgPlanningBufferPercentForSalesOrder,
} = require("../services/regularSoPlanningSnapshotService");
const { getStrictInventoryControl } = require("../services/appSettings");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("../services/docNoService");
const {
  lockSalesOrderAndAssertCanComplete,
  enrichSalesOrderWithDispatchStats,
} = require("../services/salesOrderDispatchHelpers");
const { diagnoseNoQtyCycleAutoClose, maybeAutoCloseNoQtyCycle } = require("../services/noQtyCycleAutoClose");
const { closeEmptyNoQtyActiveCycle } = require("../services/noQtyCloseEmptyCycle");
const { enrichSalesOrdersWithProcessStage, fetchInvoicedQtyBySoId } = require("../services/salesOrderProcessStage");
const { enrichSalesOrdersWithWoPrepareOperational } = require("../services/woPrepareOperationalQueue");
const {
  STOCK_EPS: INTEGRITY_EPS,
  totalWoPlannedQtyForSoItem,
  totalProducedQtyForSoItem,
} = require("../services/transactionalIntegrityGuards");
const {
  netDispatchedByItemId,
  DISPATCH_ALLOC_MODE,
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
const { findApplicableRateContractLine, normalizeUtcDateOnly } = require("../services/rateContractService");
const auditLog = require("../services/auditLog");
const { logActivity } = require("../services/activityLogService");
const {
  ACTIVITY_MODULES,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
} = require("../constants/activityLogConstants");
const { displaySalesOrderNo } = require("../utils/docNoLabels");
const { normalizePositiveCycleId, parseStrictPositiveIntId } = require("../utils/cycleIds");
const { loadNoQtyCycleQcAcceptedMap } = require("./dispatch");
const { getCompanyStateDetails } = require("../services/appSettings");
const {
  resolveCommercialView,
  freezeSalesOrderCommercialSnapshots,
  ensureShipToAutoPick,
} = require("../services/salesOrderCommercialAddress");
const {
  loadNoQtyDispositionUsableForDispatchPoolMap,
  loadNoQtyPostCycleApprovalMapForInputs,
} = require("../services/noQtyPostCycleApprovalService");
const { QC_ENTRY_ACTIVE_WHERE } = require("../services/qcEntryConstants");
const {
  getProductionBatchQcPendingQty,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
} = require("../services/reportMetrics");
const { computeNoQtyCreateNextRsEligibility, computeNoQtyCreateNextRsEligibilityResolved, resolveNoQtyEligibilityCycleId } = require("../services/noQtyCreateNextRsEligibility");
const {
  computeNoQtyManualCloseEligibility,
  assertNoQtyManualCloseEligible,
} = require("../services/noQtySoManualCloseEligibility");
const { findNoQtyNextRollingRequirementSheetTarget } = require("../services/noQtyRollingRequirementNav");
const { resolveNoQtyWorkflowState } = require("../services/noQtyWorkflowEngine");
const { advanceNoQtyCycleForNextRequirementSheetIfEligible } = require("../services/noQtyCycleLifecycle");
const { assertAnyAdminPassword } = require("../services/adminPasswordAuth");
const { getUsableItemStockQty } = require("../services/stockService");
const { loadNoQtyPendingQcDispositionQtyByItem } = require("../services/noQtyPostCycleApprovalService");
const {
  createNoQtyCloseSnapshot,
  getLatestActiveNoQtyCloseSnapshot,
  markSnapshotReopened,
  REOPEN_MODE,
  SNAPSHOT_STATUS,
  sumRawShortfall,
  loadEffectiveNoQtyCarryForwardShortfallByItem,
  getLatestNoQtyCloseSnapshot,
} = require("../services/noQtySoCloseSnapshotService");

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
  shipToAddress: { include: { stateRef: true, customer: true } },
  quotation: { include: { enquiry: true } },
  lines: { include: { item: true, quotationLine: quotationLineSelectForSo } },
  dispatch: true,
  currentCycle: { select: { id: true, cycleNo: true, status: true } },
};

async function enrichSalesOrderWithCommercialAddress(tx, so) {
  const company = await getCompanyStateDetails();
  const companyStateCode = company?.companyStateRef?.stateCode ?? null;
  const view = await resolveCommercialView(tx, so, { companyStateCode });
  return {
    ...so,
    snapshotState: view.snapshotState,
    resolvedBillTo: view.resolvedBillTo,
    resolvedShipTo: view.resolvedShipTo,
    resolvedPOS: view.resolvedPOS,
  };
}

const statusEnum = z.enum([
  "DRAFT",
  "OPEN",
  "APPROVED",
  "IN_PROCESS",
  "COMPLETED",
  "CLOSED",
  "MANUALLY_CLOSED",
]);

/** Create internal SO from approved quotation only. */
salesOrderRouter.post(
  "/from-quotation/:quotationId",
  requireAuth,
  requireRole(SO_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const quotationId = Number(req.params.quotationId);
      const body = z
        .object({
          customerPoReference: z.string().min(1, "Customer PO reference is required."),
          remarks: z.string().optional().nullable(),
          shipToAddressId: z.number().int().positive().optional().nullable(),
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
        if ((q.flowTypeSnapshot ?? "REGULAR") === "NO_QTY") {
          const err = new Error("This quotation is NO_QTY. Use NO_QTY Sales Order creation.");
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
            shipToAddressId: body.shipToAddressId ?? null,
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

        // Validate ship-to ownership/active and auto-pick default if missing.
        if (createdSo.shipToAddressId != null) {
          const ok = await tx.customerDeliveryAddress.findFirst({
            where: { id: createdSo.shipToAddressId, customerId: createdSo.customerId, isActive: true },
            select: { id: true },
          });
          if (!ok) {
            const err = new Error("Invalid Ship To address for selected customer.");
            err.statusCode = 400;
            throw err;
          }
        } else {
          await ensureShipToAutoPick(tx, createdSo.id);
        }

        // Freeze commercial snapshots immediately for auto-approved REGULAR SO.
        const company = await getCompanyStateDetails();
        const companyStateCode = company?.companyStateRef?.stateCode ?? null;
        await freezeSalesOrderCommercialSnapshots(tx, createdSo.id, { companyStateCode });

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
            module: "ADMIN",
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

        const row = await tx.salesOrder.findUnique({ where: { id: createdSo.id }, include: soInclude });
        return row ?? createdSo;
      });

      return res.status(201).json(so);
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * NO_QTY branching: create NO_QTY Sales Order from approved NO_QTY quotation only.
 * POST /api/sales-orders/no-qty/from-quotation/:quotationId
 */
salesOrderRouter.post(
  "/no-qty/from-quotation/:quotationId",
  requireAuth,
  requireRole(SO_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const quotationId = Number(req.params.quotationId);
      const body = z
        .object({
          customerPoReference: z.string().min(1, "Customer PO reference is required."),
          remarks: z.string().optional().nullable(),
        })
        .parse(req.body);

      const so = await prisma.$transaction(async (tx) => {
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
        if ((q.flowTypeSnapshot ?? "REGULAR") !== "NO_QTY") {
          const err = new Error("This quotation is REGULAR. Use regular Sales Order creation.");
          err.statusCode = 409;
          throw err;
        }
        if (!q.lines.length) {
          const err = new Error("Quotation has no lines");
          err.statusCode = 400;
          throw err;
        }

        for (const ln of q.lines) {
          const r = Number(ln.rate);
          if (!Number.isFinite(r) || r <= 0) {
            const err = new Error("Quotation has an invalid rate snapshot. Fix the quotation before creating NO_QTY Sales Order.");
            err.statusCode = 400;
            throw err;
          }
        }

        const createdSo = await tx.salesOrder.create({
          data: {
            docNo: await allocateDocNo(tx, { docType: DocType.SALES_ORDER, date: new Date() }),
            customerId: q.enquiry.customerId,
            shipToAddressId: null,
            quotationId: q.id,
            poId: null,
            customerPoReference: body.customerPoReference.trim(),
            remarks: body.remarks?.trim() || null,
            orderType: "NO_QTY",
            internalStatus: "OPEN",
            lines: {
              create: q.lines.map((l) => ({
                itemId: l.itemId,
                qty: String(0),
                customerPoQty: 0,
                bufferPercent: 0,
                rate: l.rate,
                gstRate: l.gstPct != null ? l.gstPct : null,
                rateEffectiveFrom: l.rateEffectiveFromSnapshot ?? null,
                isFree: Boolean(l.isFree),
                quotationLineId: l.id,
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

        // Optional: close enquiry after conversion to SO (keep existing behavior consistent with regular conversion).
        if (q.enquiry?.id != null) {
          await tx.enquiry.update({ where: { id: q.enquiry.id }, data: { status: "CLOSED" } });
        }

        const row = await tx.salesOrder.findUnique({ where: { id: createdSo.id }, include: soInclude });
        return { ...(row ?? createdSo), currentCycleId: c1.id };
      });

      const [out] = await enrichSalesOrdersWithProcessStage(prisma, [enrichSalesOrderWithDispatchStats(so)]);
      const enriched = await prisma.$transaction(async (tx) => enrichSalesOrderWithCommercialAddress(tx, out));
      return res.status(201).json(enriched);
    } catch (e) {
      return next(e);
    }
  },
);

/** Legacy: create SO from customer PO only. */
salesOrderRouter.post(
  "/",
  requireAuth,
  requireRole(SO_WRITE_ROLES),
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
  requireRole(SO_READ_ROLES),
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
      /** Prisma ACTIVE rows (may include pre-allocated empty “next” cycles — not used alone for operator display). */
      /** @type {Array<{ id: number; salesOrderId: number; cycleNo: number }>} */
      let noQtyPrismaActiveRows = [];
      /** @type {Map<number, number>} */
      const noQtyActiveCycleCountBySoId = new Map();
      /** Prefer highest cycleNo among ACTIVE rows (matches prepare-next RS / eligibility resolution). */
      /** @type {Map<number, { id: number; cycleNo: number }>} */
      const noQtyPreferredActiveCycleBySoId = new Map();
      if (noQtyIds.length) {
        noQtyPrismaActiveRows = await prisma.salesOrderCycle.findMany({
          where: { salesOrderId: { in: noQtyIds }, status: "ACTIVE" },
          select: { id: true, salesOrderId: true, cycleNo: true },
        });
        for (const r of noQtyPrismaActiveRows) {
          const sid = r.salesOrderId;
          noQtyActiveCycleCountBySoId.set(sid, (noQtyActiveCycleCountBySoId.get(sid) ?? 0) + 1);
          const prev = noQtyPreferredActiveCycleBySoId.get(sid);
          if (!prev || r.cycleNo > prev.cycleNo) {
            noQtyPreferredActiveCycleBySoId.set(sid, { id: r.id, cycleNo: r.cycleNo });
          }
        }
      }
      /** SalesOrderCycle.id → cycleNo (NO_QTY list display only). */
      /** @type {Map<number, number>} */
      const noQtyCycleNoById = new Map();
      /** `${salesOrderId}:${cycleNo}` → cycle row id (list anchor / display only). */
      /** @type {Map<string, number>} */
      const noQtyCycleIdBySoAndNo = new Map();
      /** When an SO has exactly one cycle row, attribute list state to it even before first RS exists. */
      /** @type {Map<number, number>} */
      const noQtySingleCycleIdBySoId = new Map();
      /** @type {Map<number, Array<{ id: number; cycleNo: number }>>} */
      const noQtyCyclesListBySoId = new Map();
      /** Highest finalized-bill cycleNo per SO (display only; not used for caps). */
      /** @type {Map<number, { maxCycleNo: number; exported: boolean }>} */
      const noQtyFinalizedCommercialBySoId = new Map();
      if (noQtyIds.length) {
        const allCyc = await prisma.salesOrderCycle.findMany({
          where: { salesOrderId: { in: noQtyIds } },
          select: { id: true, salesOrderId: true, cycleNo: true },
        });
        for (const row of allCyc) {
          const sid = Number(row.salesOrderId);
          const cid = Number(row.id);
          const cn = Number(row.cycleNo);
          if (Number.isFinite(cid) && cid > 0 && Number.isFinite(cn)) noQtyCycleNoById.set(cid, cn);
          if (Number.isFinite(sid) && sid > 0 && Number.isFinite(cid) && cid > 0 && Number.isFinite(cn)) {
            noQtyCycleIdBySoAndNo.set(`${sid}:${cn}`, cid);
            const arr = noQtyCyclesListBySoId.get(sid) ?? [];
            arr.push({ id: cid, cycleNo: cn });
            noQtyCyclesListBySoId.set(sid, arr);
          }
        }
        for (const [sid, arr] of noQtyCyclesListBySoId.entries()) {
          if (arr.length === 1 && arr[0]?.id != null) noQtySingleCycleIdBySoId.set(sid, Number(arr[0].id));
        }
        const finBillsAll = await prisma.salesBill.findMany({
          where: { status: "FINALIZED", dispatch: { soId: { in: noQtyIds } } },
          select: { cycleId: true, isExported: true, dispatch: { select: { soId: true } } },
        });
        for (const b of finBillsAll) {
          const sid = b.dispatch?.soId;
          const cid = b.cycleId != null ? Number(b.cycleId) : 0;
          if (!sid || !cid) continue;
          const cn = noQtyCycleNoById.get(cid);
          if (!Number.isFinite(cn)) continue;
          const cur = noQtyFinalizedCommercialBySoId.get(sid);
          if (!cur || cn > cur.maxCycleNo) {
            noQtyFinalizedCommercialBySoId.set(sid, { maxCycleNo: cn, exported: b.isExported === true });
          } else if (cn === cur.maxCycleNo && b.isExported === true) {
            cur.exported = true;
            noQtyFinalizedCommercialBySoId.set(sid, cur);
          }
        }
      }
      /** All cycle row ids for NO_QTY SOs on this list — include every cycle so evidence maps cover billed/closed rows. */
      const noQtyAllGraphCycleIds = [
        ...new Set(
          [...noQtyCyclesListBySoId.values()]
            .flat()
            .map((r) => Number(r.id))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      ];

      /** @type {Map<number, number>} */
      const unbilledBySoId = new Map();
      if (noQtyIds.length) {
        /** Effective cycle for list attribution: ACTIVE (preferred) wins over stale/null SalesOrder.currentCycleId. */
        /** @type {Map<number, number>} */
        const currentCycleIdBySoId = new Map();
        for (const s of staged) {
          if (s.orderType !== "NO_QTY") continue;
          const pref = noQtyPreferredActiveCycleBySoId.get(s.id);
          const ptr = s.currentCycleId != null ? Number(s.currentCycleId) : 0;
          const eff = pref?.id ?? (Number.isFinite(ptr) && ptr > 0 ? ptr : 0);
          if (Number.isFinite(eff) && eff > 0) currentCycleIdBySoId.set(s.id, eff);
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
      /** `${soId}:${cycleId}` — LOCKED RS only; distinguishes operational cycle from draft / planning pointer. */
      const noQtyLockedReqBySoCycleKey = new Set();
      const pointerCycleIds = staged
        .filter((s) => s.orderType === "NO_QTY" && s.currentCycleId != null)
        .map((s) => Number(s.currentCycleId))
        .filter((x) => Number.isFinite(x) && x > 0);
      const preferredActiveCycleIds = [...noQtyPreferredActiveCycleBySoId.values()].map((v) => v.id);
      const noQtyCycleIds = [...new Set([...pointerCycleIds, ...preferredActiveCycleIds, ...noQtyAllGraphCycleIds])].filter(
        (x) => Number.isFinite(x) && x > 0,
      );
      if (noQtyIds.length && noQtyCycleIds.length) {
        const sheets = await prisma.requirementSheet.findMany({
          where: { salesOrderId: { in: noQtyIds }, cycleId: { in: noQtyCycleIds } },
          select: { salesOrderId: true, cycleId: true, status: true },
        });
        for (const sh of sheets) {
          const soId = Number(sh.salesOrderId);
          const cycleId = sh.cycleId != null ? Number(sh.cycleId) : 0;
          if (!Number.isFinite(soId) || soId <= 0) continue;
          if (!Number.isFinite(cycleId) || cycleId <= 0) continue;
          noQtyHasReqSheetBySoCycleKey.add(`${soId}:${cycleId}`);
          if (String(sh.status) === "LOCKED") noQtyLockedReqBySoCycleKey.add(`${soId}:${cycleId}`);
        }
      }

      // NO_QTY current-cycle downstream evidence (used for stage priority mapping).
      const noQtyWorkOrderBySoCycleKey = new Set();
      const noQtyProductionBySoCycleKey = new Set();
      const noQtyQcBySoCycleKey = new Set();
      const noQtyDispatchBySoCycleKey = new Set();
      const noQtySalesBillBySoCycleKey = new Set();
      const noQtyFinalizedBillBySoCycleKey = new Set();
      const noQtyExportedFinalizedBillBySoCycleKey = new Set();
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
          select: { id: true, cycleId: true, status: true, isExported: true, dispatch: { select: { soId: true } } },
        });
        for (const b of bills) {
          const soId = b.dispatch?.soId;
          if (!soId) continue;
          const key = `${soId}:${Number(b.cycleId)}`;
          noQtySalesBillBySoCycleKey.add(key);
          if (b.status === "FINALIZED") {
            noQtyFinalizedBillBySoCycleKey.add(key);
            if (b.isExported === true) noQtyExportedFinalizedBillBySoCycleKey.add(key);
          }
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

      /** NO_QTY: server-side Create Next RS eligibility (ACTIVE cycle; same resolution as prepare-next RS). */
      /** @type {Map<number, Awaited<ReturnType<typeof computeNoQtyCreateNextRsEligibility>>>} */
      const createNextRsEligibilityBySoId = new Map();
      /** Cycle id used for eligibility (null if none). */
      /** @type {Map<number, number | null>} */
      const noQtyEligibilityResolvedCycleIdBySoId = new Map();
      if (noQtyIds.length) {
        const debugNoQtyPointer =
          process.env.DEBUG_NO_QTY_RS_ELIGIBILITY === "1" || process.env.DEBUG_NO_QTY_RS_ELIGIBILITY === "true";
        await Promise.all(
          staged
            .filter((s) => s.orderType === "NO_QTY")
            .map(async (s) => {
              const resolved = await resolveNoQtyEligibilityCycleId(prisma, s.id);
              noQtyEligibilityResolvedCycleIdBySoId.set(s.id, resolved.cycleId);
              const pointer = s.currentCycleId != null ? Number(s.currentCycleId) : null;
              if (
                debugNoQtyPointer &&
                resolved.source === "ACTIVE" &&
                pointer != null &&
                Number.isFinite(pointer) &&
                resolved.cycleId != null &&
                pointer !== resolved.cycleId
              ) {
                console.warn(
                  "[NO_QTY_POINTER_MISMATCH]",
                  JSON.stringify({
                    salesOrderId: s.id,
                    currentCycleIdPointer: pointer,
                    eligibilityUsesCycleId: resolved.cycleId,
                  }),
                );
              }
              const r =
                !resolved.cycleId
                  ? {
                      eligible: false,
                      reason: resolved.source === "INVALID_SO" ? "INVALID_SO" : "NO_CYCLE",
                      existingNextRsDocNo: null,
                      existingNextRsId: null,
                    }
                  : await computeNoQtyCreateNextRsEligibility(prisma, {
                      salesOrderId: s.id,
                      cycleId: resolved.cycleId,
                    });
              createNextRsEligibilityBySoId.set(s.id, r);
            }),
        );
      }

      /** NO_QTY: manual Close SO eligibility (same rules as POST /:id/close). */
      /** @type {Map<number, Awaited<ReturnType<typeof computeNoQtyManualCloseEligibility>>>} */
      const manualCloseEligibilityBySoId = new Map();
      if (noQtyIds.length) {
        await Promise.all(
          staged
            .filter(
              (s) =>
                s.orderType === "NO_QTY" &&
                !["COMPLETED", "CLOSED", "MANUALLY_CLOSED"].includes(String(s.internalStatus ?? "")),
            )
            .map(async (s) => {
              const r = await computeNoQtyManualCloseEligibility(prisma, s.id);
              manualCloseEligibilityBySoId.set(s.id, r);
            }),
        );
      }

      /** Diagnostic: verbose eligibility audit (DEBUG env only — avoid noisy production logs). */
      const auditNoQtyRsEligibility =
        process.env.DEBUG_NO_QTY_RS_ELIGIBILITY === "1" || process.env.DEBUG_NO_QTY_RS_ELIGIBILITY === "true";
      if (auditNoQtyRsEligibility && noQtyIds.length) {
        const { auditAllOpenNoQtyForDashboard } = require("../services/noQtyCreateNextRsEligibilityAudit");
        try {
          const lines = await auditAllOpenNoQtyForDashboard(prisma, staged);
          if (!lines.length) {
            console.log("[NO_QTY_RS_ELIGIBILITY_AUDIT] no open NO_QTY sales orders (internalStatus filter)");
          }
          for (const row of lines) {
            console.log("[NO_QTY_RS_ELIGIBILITY_AUDIT]", JSON.stringify(row));
          }
        } catch (e) {
          console.error("[NO_QTY_RS_ELIGIBILITY_AUDIT] audit failed", e);
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

      /**
       * NO_QTY list row: cycle has RS / WO / production / QC / locked dispatch / any sales bill.
       * Used so an empty “next cycle” pointer is never the sole attribution source.
       */
      const noQtyCycleHasListEvidence = (soId, cid) => {
        const sid = Number(soId);
        const c = Number(cid);
        if (!Number.isFinite(sid) || sid <= 0 || !Number.isFinite(c) || c <= 0) return false;
        const k = `${sid}:${c}`;
        return (
          noQtyHasReqSheetBySoCycleKey.has(k) ||
          noQtyWorkOrderBySoCycleKey.has(k) ||
          noQtyProductionBySoCycleKey.has(k) ||
          noQtyQcBySoCycleKey.has(k) ||
          noQtyDispatchBySoCycleKey.has(k) ||
          noQtySalesBillBySoCycleKey.has(k)
        );
      };

      /**
       * Operator-visible “active” cycle: Prisma ACTIVE **and** at least one RS/WO/prod/QC/dispatch/bill row.
       * Excludes empty pre-allocated ACTIVE rows (e.g. next cycle pointer with no RS yet).
       */
      /** @type {Map<number, { id: number; cycleNo: number }>} */
      const noQtyWorkflowActiveCycleBySoId = new Map();
      /** @type {Map<number, number>} */
      const noQtyWorkflowActiveCycleCountBySoId = new Map();
      for (const r of noQtyPrismaActiveRows) {
        const sid = r.salesOrderId;
        const id = Number(r.id);
        if (!Number.isFinite(sid) || sid <= 0 || !Number.isFinite(id) || id <= 0) continue;
        if (!noQtyCycleHasListEvidence(sid, id)) continue;
        noQtyWorkflowActiveCycleCountBySoId.set(sid, (noQtyWorkflowActiveCycleCountBySoId.get(sid) ?? 0) + 1);
        const prev = noQtyWorkflowActiveCycleBySoId.get(sid);
        const cn = Number(r.cycleNo);
        if (!prev || cn > prev.cycleNo) noQtyWorkflowActiveCycleBySoId.set(sid, { id, cycleNo: cn });
      }

      /**
       * List/stage attribution cycle id (display + row pipeline on one consistent cycle):
       * Workflow-active (ACTIVE + evidence) → resolved id only if it has evidence → anchor on max finalized bill cycleNo
       * → pointer only if it has evidence → single existing cycle row → 0.
       * Does not change billing/RS math elsewhere — only which cycle keys drive this list payload.
       */
      const noQtyEffectiveListCycleId = (s) => {
        if (s.orderType !== "NO_QTY") return 0;
        const soId = s.id;
        const wfCnt = noQtyWorkflowActiveCycleCountBySoId.get(soId) ?? 0;
        const wfPref = noQtyWorkflowActiveCycleBySoId.get(soId);
        if (wfCnt > 0 && wfPref?.id != null) {
          const id = Number(wfPref.id);
          return Number.isFinite(id) && id > 0 ? id : 0;
        }

        const resolved = noQtyEligibilityResolvedCycleIdBySoId.get(soId);
        const resolvedNum =
          resolved != null && Number.isFinite(Number(resolved)) && Number(resolved) > 0 ? Number(resolved) : 0;
        if (resolvedNum > 0 && noQtyCycleHasListEvidence(soId, resolvedNum)) return resolvedNum;

        const commercial = noQtyFinalizedCommercialBySoId.get(soId);
        if (commercial && Number.isFinite(commercial.maxCycleNo)) {
          const anchor = noQtyCycleIdBySoAndNo.get(`${soId}:${commercial.maxCycleNo}`);
          if (anchor != null && Number.isFinite(Number(anchor)) && Number(anchor) > 0) return Number(anchor);
        }

        const ptr = s.currentCycleId != null ? Number(s.currentCycleId) : 0;
        if (Number.isFinite(ptr) && ptr > 0 && noQtyCycleHasListEvidence(soId, ptr)) return ptr;

        const only = noQtySingleCycleIdBySoId.get(soId);
        if (only != null && Number.isFinite(Number(only)) && Number(only) > 0) return Number(only);

        return 0;
      };

      staged = await enrichSalesOrdersWithWoPrepareOperational(prisma, staged);

      const company = await getCompanyStateDetails();
      const companyStateCode = company?.companyStateRef?.stateCode ?? null;

      const enriched = await prisma.$transaction(async (tx) =>
        Promise.all(
          staged.map(async (s) => {
            const view = await resolveCommercialView(tx, s, { companyStateCode });
            return {
              ...s,
              snapshotState: view.snapshotState,
              resolvedBillTo: view.resolvedBillTo,
              resolvedShipTo: view.resolvedShipTo,
              resolvedPOS: view.resolvedPOS,
            };
          }),
        ),
      );

      return res.json(
        enriched.map((s) => ({
          ...s,
          ...(s.orderType === "NO_QTY"
            ? (() => {
                const c = noQtyEffectiveListCycleId(s);
                const key = `${s.id}:${c}`;
                const elig = createNextRsEligibilityBySoId.get(s.id);
                const createNextRsEligible = elig?.eligible ?? false;
                const commercial = noQtyFinalizedCommercialBySoId.get(s.id);
                const wfCnt = noQtyWorkflowActiveCycleCountBySoId.get(s.id) ?? 0;
                const wfPref = noQtyWorkflowActiveCycleBySoId.get(s.id);
                const completedSoRow =
                  s.internalStatus === "MANUALLY_CLOSED" ||
                  s.internalStatus === "CLOSED" ||
                  s.internalStatus === "COMPLETED";

                /** Max cycleNo among **this SO’s cycle rows** that have a finalized bill (display truth). */
                let latestBilledCycleNo = null;
                for (const row of noQtyCyclesListBySoId.get(s.id) ?? []) {
                  if (noQtyFinalizedBillBySoCycleKey.has(`${s.id}:${row.id}`)) {
                    const cn = Number(row.cycleNo);
                    if (Number.isFinite(cn) && (latestBilledCycleNo == null || cn > latestBilledCycleNo)) latestBilledCycleNo = cn;
                  }
                }
                const commercialCycleNoForCaption =
                  latestBilledCycleNo != null
                    ? latestBilledCycleNo
                    : commercial && Number.isFinite(commercial.maxCycleNo)
                      ? commercial.maxCycleNo
                      : null;

                const salesBillExists = c > 0 ? noQtySalesBillBySoCycleKey.has(key) : false;
                const finalizedBillExists = c > 0 ? noQtyFinalizedBillBySoCycleKey.has(key) : false;
                const billingExportedForCycle = c > 0 ? noQtyExportedFinalizedBillBySoCycleKey.has(key) : false;
                const dispatchExists = c > 0 ? noQtyDispatchBySoCycleKey.has(key) : false;
                const qcExists = c > 0 ? noQtyQcBySoCycleKey.has(key) : false;
                const productionExists = c > 0 ? noQtyProductionBySoCycleKey.has(key) : false;
                const workOrderExists = c > 0 ? noQtyWorkOrderBySoCycleKey.has(key) : false;
                const requirementExists = c > 0 ? noQtyHasReqSheetBySoCycleKey.has(key) : false;

                const nextAction = (() => {
                  if (completedSoRow) return "COMPLETED";
                  if (wfCnt === 0 && createNextRsEligible) return "CREATE_NEXT_RS";
                  if (finalizedBillExists) return "CLOSE_SO";
                  if (salesBillExists) return "SALES_BILL";
                  if (dispatchExists) return "SALES_BILL";
                  if (qcExists) return "STORE";
                  if (productionExists) return "QA";
                  if (workOrderExists) return "PRODUCTION";
                  if (requirementExists) return "WORK_ORDER";
                  return "REQUIREMENT";
                })();

                let stageKey = "NO_QTY_DRAFT";
                let stageLabel = "Draft";
                if (completedSoRow) {
                  stageKey = "COMPLETED";
                  stageLabel = "Completed";
                } else if (nextAction === "CREATE_NEXT_RS") {
                  stageKey = "NO_QTY_PREPARE_NEXT_RS";
                  stageLabel = "Next cycle RS";
                } else if (finalizedBillExists) {
                  stageKey = "NO_QTY_BILLING_COMPLETE";
                  stageLabel = "Billing complete";
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

                let noQtyListPositionLabel = "";
                const operatorEvidenceOnCycle = (soId, cycleRowId) => {
                  const k = `${soId}:${cycleRowId}`;
                  return (
                    noQtyLockedReqBySoCycleKey.has(k) ||
                    noQtyWorkOrderBySoCycleKey.has(k) ||
                    noQtyProductionBySoCycleKey.has(k) ||
                    noQtyQcBySoCycleKey.has(k) ||
                    noQtyDispatchBySoCycleKey.has(k) ||
                    noQtySalesBillBySoCycleKey.has(k)
                  );
                };
                /** Prisma ACTIVE row ahead of last billed cycle but no operational docs on that cycle (SO planning pointer after prepare-next). */
                const wfIsEmptyPlanningPointer =
                  wfPref != null &&
                  createNextRsEligible &&
                  !operatorEvidenceOnCycle(s.id, wfPref.id) &&
                  (commercialCycleNoForCaption == null || wfPref.cycleNo > commercialCycleNoForCaption);
                if (completedSoRow) {
                  noQtyListPositionLabel = "Closed";
                } else if (wfCnt > 0 && wfPref && wfIsEmptyPlanningPointer) {
                  noQtyListPositionLabel =
                    commercialCycleNoForCaption != null && Number.isFinite(commercialCycleNoForCaption)
                      ? `Cycle ${commercialCycleNoForCaption} completed`
                      : "Between cycles";
                } else if (wfCnt > 0 && wfPref) {
                  noQtyListPositionLabel = `Active cycle ${wfPref.cycleNo}`;
                } else if (wfCnt === 0 && createNextRsEligible) {
                  noQtyListPositionLabel = "Between cycles";
                } else if (wfCnt === 0 && commercialCycleNoForCaption != null && Number.isFinite(commercialCycleNoForCaption)) {
                  noQtyListPositionLabel = `Cycle ${commercialCycleNoForCaption} completed`;
                } else if (wfCnt === 0) {
                  noQtyListPositionLabel = "Between cycles";
                } else {
                  noQtyListPositionLabel = "Between cycles";
                }

                const unbNow = unbilledBySoId.get(s.id) ?? 0;
                let billingExportedDisplay = commercial?.exported === true;
                if (!billingExportedDisplay && commercialCycleNoForCaption != null) {
                  for (const row of noQtyCyclesListBySoId.get(s.id) ?? []) {
                    if (Number(row.cycleNo) !== commercialCycleNoForCaption) continue;
                    if (noQtyExportedFinalizedBillBySoCycleKey.has(`${s.id}:${row.id}`)) {
                      billingExportedDisplay = true;
                      break;
                    }
                  }
                }

                let noQtyCommercialCaption = null;
                if (commercialCycleNoForCaption != null && Number.isFinite(commercialCycleNoForCaption)) {
                  noQtyCommercialCaption = billingExportedDisplay
                    ? `Billing completed · Exported · Cycle ${commercialCycleNoForCaption}`
                    : `Billing completed · Cycle ${commercialCycleNoForCaption}`;
                } else if (c > 0 && salesBillExists && !finalizedBillExists) {
                  noQtyCommercialCaption = "Billing (draft)";
                } else if (c > 0 && dispatchExists) {
                  noQtyCommercialCaption = unbNow > 0 ? "Dispatch · billing pending" : "Dispatched";
                }

                const noQtyNextActionLabel = (() => {
                  if (completedSoRow) return "—";
                  switch (nextAction) {
                    case "CREATE_NEXT_RS":
                      return "Create next RS";
                    case "CLOSE_SO":
                      return "Review & close SO";
                    case "SALES_BILL":
                      return "Complete billing";
                    case "STORE":
                      return "STORE";
                    case "QA":
                      return "QA";
                    case "PRODUCTION":
                      return "Production";
                    case "WORK_ORDER":
                      return "Work order";
                    case "REQUIREMENT":
                      return "Requirement";
                    case "COMPLETED":
                      return "—";
                    default:
                      return "—";
                  }
                })();

                const noQtyGuidedCycleId = wfCnt > 0 && wfPref ? wfPref.id : null;

                return {
                  processStage: { key: stageKey, label: stageLabel },
                  noQtyNextAction: nextAction,
                  noQtyNextActionLabel,
                  noQtyFinalizedBillingComplete: finalizedBillExists,
                  noQtyBillingExported: billingExportedDisplay || billingExportedForCycle,
                  noQtyCreateNextRsEligible: createNextRsEligible,
                  noQtyNextRsAlreadyCreatedDocNo: elig?.existingNextRsDocNo ?? null,
                  noQtyListPositionLabel,
                  noQtyCommercialCaption,
                  commercialStatusLabel: noQtyCommercialCaption,
                  noQtyGuidedCycleId,
                  noQtyLatestBilledCycleNo: commercialCycleNoForCaption,
                  noQtyActualActiveCycleNo: wfPref?.cycleNo ?? null,
                  noQtyLatestCompletedCycleNo: wfCnt === 0 ? commercialCycleNoForCaption ?? null : null,
                  noQtyActiveCycleNo: wfPref?.cycleNo ?? null,
                  noQtyWorkflowActiveCycleCount: wfCnt,
                  noQtyIsBetweenCycles: !completedSoRow && wfCnt === 0,
                  noQtyManualCloseEligible: completedSoRow
                    ? false
                    : (manualCloseEligibilityBySoId.get(s.id)?.eligible ?? false),
                  noQtyManualCloseBlockReason: completedSoRow
                    ? null
                    : (manualCloseEligibilityBySoId.get(s.id)?.message ?? null),
                };
              })()
            : {}),
          unbilledDispatchedQty: s.orderType === "NO_QTY" ? (unbilledBySoId.get(s.id) ?? 0) : null,
          invoicedQty: invoicedBySoId.get(s.id) ?? 0,
          hasCurrentCycleRequirementSheet:
            s.orderType === "NO_QTY"
              ? (() => {
                  const cid = noQtyEffectiveListCycleId(s);
                  return cid > 0 ? noQtyHasReqSheetBySoCycleKey.has(`${s.id}:${cid}`) : null;
                })()
              : null,
          hasCurrentCycleSalesBill:
            s.orderType === "NO_QTY"
              ? (() => {
                  const cid = noQtyEffectiveListCycleId(s);
                  return cid > 0 ? noQtySalesBillBySoCycleKey.has(`${s.id}:${cid}`) : null;
                })()
              : null,
          noQtyCanCloseEmptyCycle:
            s.orderType === "NO_QTY"
              ? (() => {
                  const cid = noQtyEffectiveListCycleId(s);
                  if (cid <= 0) return null;
                  if (s.internalStatus === "MANUALLY_CLOSED" || s.internalStatus === "CLOSED") return false;
                  const pref = noQtyPreferredActiveCycleBySoId.get(s.id);
                  const cycleIsActive =
                    (pref != null && pref.id === cid) ||
                    (s.currentCycle != null && Number(s.currentCycle.id) === cid && s.currentCycle.status === "ACTIVE");
                  if (!cycleIsActive) return false;
                  const key = `${s.id}:${cid}`;
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
          ...(req.user?.role === "ADMIN"
            ? {
                deleteAllowed: !(deleteBlockedReasonsBySoId.get(s.id) ?? []).length,
                deleteBlockedReasons: deleteBlockedReasonsBySoId.get(s.id) ?? [],
                ...(s.orderType === "NO_QTY"
                  ? {
                      /** Display-only: max(cycleNo)+1 from existing cycle rows; not an active workflow cycle. */
                      noQtyNextPossibleCycleNo: (() => {
                        let max = 0;
                        for (const row of noQtyCyclesListBySoId.get(s.id) ?? []) {
                          const cn = Number(row.cycleNo);
                          if (Number.isFinite(cn) && cn > max) max = cn;
                        }
                        return max > 0 ? max + 1 : null;
                      })(),
                    }
                  : {}),
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

/**
 * REGULAR FLOW — RM / FG availability check before work order (NORMAL, REPLACEMENT). Not NO_QTY requirement planning.
 * Service: `rmCheckForSalesOrder` (no `planningDashboard` / NO_QTY cycle services).
 */
function parsePlanQtyByLineIdFromQuery(query) {
  const raw = query.planLineQty ?? query.planQty;
  if (!raw) return {};
  const out = {};
  for (const part of String(raw).split(",")) {
    const seg = part.trim();
    if (!seg) continue;
    const [k, v] = seg.split(":");
    const lineId = Number(k);
    const qty = Number(v);
    if (Number.isFinite(lineId) && lineId > 0 && Number.isFinite(qty) && qty >= 0) {
      out[lineId] = qty;
    }
  }
  return out;
}

salesOrderRouter.get(
  "/:id/production-planning-snapshot",
  requireAuth,
  requireRole(WO_PLAN_PREP_ROLES),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      const view = await buildRegularSoPlanningSnapshotView(soId, prisma);
      const suggestedFgPlanningBufferPercent = await resolveSuggestedFgPlanningBufferPercentForSalesOrder(soId, prisma);
      return res.json({
        salesOrderId: view.salesOrderId,
        orderType: view.orderType,
        bufferPercent: view.bufferPercent,
        suggestedFgPlanningBufferPercent,
        snapshotId: view.snapshotId,
        snapshotUpdatedAt: view.snapshotUpdatedAt,
        source: view.source,
        allFgEnough: view.allFgEnough,
        lines: view.lines,
      });
    } catch (e) {
      return next(e);
    }
  },
);

salesOrderRouter.put(
  "/:id/production-planning-snapshot",
  requireAuth,
  requireRole(["ADMIN", "STORE", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      const schema = z.object({
        bufferPercent: z.number().min(0).max(10).optional(),
      });
      const body = schema.parse(req.body ?? {});
      const snapshot = await upsertRegularSoPlanningSnapshot(
        {
          salesOrderId: soId,
          bufferPercent: body.bufferPercent ?? 0,
          createdByUserId: req.user?.userId ?? null,
        },
        prisma,
      );
      return res.json({
        ok: true,
        snapshot: regularSoPlanningSnapshotToDto(snapshot),
      });
    } catch (e) {
      return next(e);
    }
  },
);

salesOrderRouter.get(
  "/:id/rm-check",
  requireAuth,
  requireRole(WO_PLAN_PREP_ROLES),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      const planQtyByLineId = parsePlanQtyByLineIdFromQuery(req.query);
      const data = await rmCheckForSalesOrder(soId, { planQtyByLineId });
      const strict = await getStrictInventoryControl();
      const materialOk = Boolean(data.canCreateWorkOrder);
      return res.json({
        ...data,
        strictInventoryControl: strict,
        /** REGULAR WO prepare: material planning engine gates work-order creation. */
        proceedAllowed: materialOk,
        blockMessage: data.woBlockReason ?? null,
      });
    } catch (e) {
      return next(e);
    }
  },
);

const raiseMaterialRequirementBodySchema = z.object({
  workOrderId: z.number().int().positive().optional(),
  planLineQty: z.record(z.string(), z.coerce.number().nonnegative()).optional(),
  confirmReuse: z.boolean().optional(),
  confirmReopenClosed: z.boolean().optional(),
});

salesOrderRouter.post(
  "/:id/raise-material-requirement",
  requireAuth,
  requireRole(MATERIAL_REQUISITION_WRITE_ROLES, "Only Admin and Store can raise material requirements."),
  blockProcurementDemandWhenPlanningDriven,
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      const body = raiseMaterialRequirementBodySchema.parse(req.body ?? {});
      const planQtyByLineId = {};
      if (body.planLineQty) {
        for (const [k, v] of Object.entries(body.planLineQty)) {
          const lineId = Number(k);
          if (Number.isFinite(lineId) && lineId > 0) planQtyByLineId[lineId] = v;
        }
      }
      const result = await createMaterialRequirementFromWoPlanning({
        salesOrderId: soId,
        workOrderId: body.workOrderId,
        planQtyByLineId,
        createdByUserId: req.user?.userId,
        confirmReuse: Boolean(body.confirmReuse),
        confirmReopenClosed: Boolean(body.confirmReopenClosed),
      });
      const mr = result.materialRequirement;
      return res.status(result.reused ? 200 : 201).json({
        ok: true,
        reused: result.reused,
        message: result.reused
          ? "Material requirement updated successfully."
          : "Material requirement raised successfully.",
        materialRequirement: {
          id: mr.id,
          docNo: mr.docNo,
          status: mr.status,
          sourceType: mr.sourceType,
          salesOrderId: mr.salesOrderId,
          workOrderId: mr.workOrderId,
          lines: (mr.lines ?? []).map((l) => ({
            rmItemId: l.rmItemId,
            itemName: l.rmItem?.itemName ?? "",
            unit: l.unitSnapshot ?? l.rmItem?.unit ?? "",
            requiredQty: Number(l.requiredQty),
            availableQty: Number(l.availableQtySnapshot),
            shortageQty: Number(l.shortageQty),
          })),
        },
      });
    } catch (e) {
      if (e?.code === "DUPLICATE_MATERIAL_REQUIREMENT") {
        return res.status(409).json({
          code: e.code,
          message: e.message,
          existingMaterialRequirement: e.existingMaterialRequirement ?? null,
        });
      }
      if (e?.code === "REOPEN_CONFIRM_REQUIRED") {
        return res.status(409).json({
          code: e.code,
          message: e.message,
          existingMaterialRequirement: e.existingMaterialRequirement ?? null,
        });
      }
      return next(e);
    }
  },
);

salesOrderRouter.put(
  "/:id/status",
  requireAuth,
  requireRole(SO_WRITE_ROLES),
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
          const company = await getCompanyStateDetails();
          const companyStateCode = company?.companyStateRef?.stateCode ?? null;
          await freezeSalesOrderCommercialSnapshots(tx, soId, { companyStateCode });
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
      const enriched = await prisma.$transaction(async (tx) => enrichSalesOrderWithCommercialAddress(tx, out));
      return res.json(enriched);
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
  requireRole(SO_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          customerId: z.number().int().positive(),
          customerPoReference: z.string().optional().nullable(),
          remarks: z.string().optional().nullable(),
          items: z.array(z.object({ itemId: z.number().int().positive() })).min(1),
        })
        .parse(req.body);

      const poRef =
        body.customerPoReference == null || typeof body.customerPoReference !== "string"
          ? ""
          : body.customerPoReference.trim();
      if (!poRef) {
        return res.status(400).json({
          error: "CUSTOMER_PO_REQUIRED",
          message: "Customer PO reference is required for No Qty SO.",
        });
      }

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

        const items = await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, itemType: true } });
        const ok = new Set(items.filter((i) => i.itemType === "FG").map((i) => i.id));
        for (const it of itemIds) {
          if (!ok.has(it)) {
            const err = new Error("Only FG items are allowed in No Qty SO.");
            err.statusCode = 400;
            throw err;
          }
        }

        const rateAsOf = normalizeUtcDateOnly(new Date()) ?? new Date();
        /** @type {Array<{ itemId: number; qty: Prisma.Decimal; rate: Prisma.Decimal; gstRate: Prisma.Decimal | null; rateEffectiveFrom: Date }>} */
        const lineSnapshots = [];
        for (const x of body.items) {
          const contract = await findApplicableRateContractLine(tx, {
            customerId: body.customerId,
            itemId: x.itemId,
            asOf: rateAsOf,
          });
          if (!contract) {
            const err = new Error(
              `No approved rate contract for customer item ${x.itemId} as of today. Add a rate contract first.`,
            );
            err.statusCode = 400;
            throw err;
          }
          const r = Number(contract.rate);
          if (!Number.isFinite(r) || r <= 0) {
            const err = new Error("Rate contract has an invalid rate.");
            err.statusCode = 400;
            throw err;
          }
          const g =
            contract.gstRate != null && String(contract.gstRate).trim() !== "" ? Number(contract.gstRate) : null;
          lineSnapshots.push({
            itemId: x.itemId,
            qty: new Prisma.Decimal(0),
            rate: new Prisma.Decimal(String(r)),
            gstRate: g != null && Number.isFinite(g) ? new Prisma.Decimal(String(g)) : null,
            rateEffectiveFrom: contract.effectiveFrom,
          });
        }

        const createdSo = await tx.salesOrder.create({
          data: {
            docNo: await allocateDocNo(tx, { docType: DocType.SALES_ORDER, date: new Date() }),
            customerId: body.customerId,
            shipToAddressId: null,
            quotationId: null,
            poId: null,
            customerPoReference: poRef,
            remarks: body.remarks?.trim() || null,
            orderType: "NO_QTY",
            internalStatus: "OPEN",
            lines: {
              create: lineSnapshots.map((snap) => ({
                itemId: snap.itemId,
                qty: snap.qty,
                customerPoQty: 0,
                bufferPercent: 0,
                rate: snap.rate,
                gstRate: snap.gstRate,
                rateEffectiveFrom: snap.rateEffectiveFrom,
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
            module: "ADMIN",
            actionLabel: "CREATE",
            ref: { type: "SO", id: String(createdSo.id), no: `SO-${createdSo.id}` },
            snapshot: { orderType: "NO_QTY", customerId: createdSo.customerId, lineCount: createdSo.lines?.length ?? null },
            status: { from: null, to: createdSo.internalStatus },
          },
        });
        return { ...createdSo, currentCycleId: c1.id };
      });

      const [out] = await enrichSalesOrdersWithProcessStage(prisma, [enrichSalesOrderWithDispatchStats(so)]);
      const enriched = await prisma.$transaction(async (tx) => enrichSalesOrderWithCommercialAddress(tx, out));
      return res.status(201).json(enriched);
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
  requireRole(SO_WRITE_ROLES),
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
  requireRole(SO_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) {
        const err = new Error("Invalid sales order id.");
        err.statusCode = 400;
        throw err;
      }
      const body = z.object({ reason: z.string().optional().nullable() }).parse(req.body ?? {});

      const { snapshotLines } = await prisma.$transaction(async (tx) => {
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
        if (so.internalStatus === "MANUALLY_CLOSED" || so.internalStatus === "CLOSED") {
          return { snapshotLines: [] };
        }

        await assertNoQtyManualCloseEligible(tx, soId);

        const { lines } = await createNoQtyCloseSnapshot(tx, {
          salesOrderId: soId,
          userId: req.user?.userId ?? null,
          reason: body.reason?.trim() || null,
        });

        const updated = await tx.salesOrder.update({
          where: { id: soId },
          data: { internalStatus: "MANUALLY_CLOSED", currentCycleId: null },
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
        return { snapshotLines: lines };
      });

      const row = await prisma.salesOrder.findUnique({ where: { id: soId }, include: soInclude });
      const [out] = await enrichSalesOrdersWithProcessStage(prisma, [enrichSalesOrderWithDispatchStats(row)]);

      const itemIds = [...new Set((snapshotLines || []).map((l) => Number(l.itemId)).filter((x) => x > 0))];
      const items =
        itemIds.length > 0
          ? await prisma.item.findMany({
              where: { id: { in: itemIds } },
              select: { id: true, itemName: true },
            })
          : [];
      const itemById = new Map(items.map((it) => [it.id, it]));
      let totalClosedShortage = 0;
      const linesOut = (snapshotLines || []).map((ln) => {
        const q = Number(ln.closedShortageQty);
        totalClosedShortage += Number.isFinite(q) ? q : 0;
        const it = itemById.get(Number(ln.itemId));
        return {
          itemId: ln.itemId,
          itemName: it?.itemName ?? `Item #${ln.itemId}`,
          closedShortageQty: ln.closedShortageQty,
        };
      });

      return res.json({
        ...out,
        closedShortageSummary: {
          totalClosedShortage: Math.round(totalClosedShortage * 1000) / 1000,
          lines: linesOut,
        },
      });
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
  requireRole(["ADMIN"], "Only Admin can reopen a closed No Qty sales order."),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) {
        const err = new Error("Invalid sales order id.");
        err.statusCode = 400;
        throw err;
      }

      const body = z
        .object({
          adminPassword: z.string().min(1),
          mode: z.enum(["CONTINUE_SHORTAGE", "IGNORE_SHORTAGE"]),
        })
        .parse(req.body ?? {});

      await assertAnyAdminPassword(prisma, { password: body.adminPassword });

      const reopenTx = await prisma.$transaction(async (tx) => {
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
        if (so.internalStatus !== "MANUALLY_CLOSED" && so.internalStatus !== "CLOSED") {
          const err = new Error("Only closed No Qty sales orders can be reopened.");
          err.statusCode = 409;
          throw err;
        }

        const snap = await getLatestActiveNoQtyCloseSnapshot(tx, soId);
        if (!snap || snap.status !== SNAPSHOT_STATUS.ACTIVE) {
          const err = new Error("No active close snapshot found for this sales order.");
          err.statusCode = 409;
          throw err;
        }

        await markSnapshotReopened(tx, {
          salesOrderId: soId,
          mode: body.mode,
          userId: req.user?.userId ?? null,
        });

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
          message: `Sales Order ${docLabel} reopened (${body.mode})`,
          metadata: { ...salesOrderActivityMeta(updated), reopenMode: body.mode },
        });

        const lines = await tx.noQtySoClosedShortageLine.findMany({ where: { snapshotId: snap.id } });
        let restoredShortageQty = 0;
        for (const ln of lines) restoredShortageQty += Number(ln.closedShortageQty ?? 0);
        restoredShortageQty = Math.round(restoredShortageQty * 1000) / 1000;

        return { updated, restoredShortageQty, snapLines: lines };
      });

      const { shortfallByItem } = await loadEffectiveNoQtyCarryForwardShortfallByItem(prisma, {
        salesOrderId: soId,
        currentCycleId:
          reopenTx.updated.currentCycleId != null ? Number(reopenTx.updated.currentCycleId) : null,
      });
      const activeCarryForwardQty = sumRawShortfall(shortfallByItem);

      const [out] = await enrichSalesOrdersWithProcessStage(prisma, [
        enrichSalesOrderWithDispatchStats(reopenTx.updated),
      ]);

      const modeLabel =
        body.mode === REOPEN_MODE.IGNORE_SHORTAGE
          ? "Active carry-forward cleared. Historical closed shortage is retained for reporting."
          : "Closed shortage restored as carry-forward demand. Stock will follow current inventory only.";

      return res.json({
        ...out,
        reopenMode: body.mode,
        restoredShortageQty:
          body.mode === REOPEN_MODE.CONTINUE_SHORTAGE ? reopenTx.restoredShortageQty : 0,
        activeCarryForwardQty,
        message: modeLabel,
      });
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * NO_QTY: reopen preview (UI helper — no mutations).
 * GET /api/sales-orders/:id/reopen-preview
 */
salesOrderRouter.get(
  "/:id/reopen-preview",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can preview reopen for a No Qty sales order."),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) {
        const err = new Error("Invalid sales order id.");
        err.statusCode = 400;
        throw err;
      }

      const so = await prisma.salesOrder.findUnique({
        where: { id: soId },
        select: {
          id: true,
          orderType: true,
          internalStatus: true,
          currentCycleId: true,
          lines: { select: { itemId: true } },
        },
      });
      if (!so) return res.status(404).json({ error: { message: "Sales order not found." } });
      if (so.orderType !== "NO_QTY") {
        return res.status(409).json({ error: { message: "Preview applies only to NO_QTY sales orders." } });
      }

      const snap = await getLatestNoQtyCloseSnapshot(prisma, soId);
      const closedLines = (snap?.lines || []).map((ln) => ({
        itemId: ln.itemId,
        closedShortageQty: Number(ln.closedShortageQty ?? 0),
        cycleIdAtClose: ln.cycleIdAtClose,
        cycleNoAtClose: ln.cycleNoAtClose,
      }));

      const itemIds = [...new Set(closedLines.map((l) => Number(l.itemId)).filter((x) => x > 0))];
      /** @type {{ itemId: number; usableQty: number }[]} */
      const usableByItem = [];
      for (const itemId of itemIds) {
        // eslint-disable-next-line no-await-in-loop
        const usableQty = await getUsableItemStockQty(itemId, prisma);
        usableByItem.push({ itemId, usableQty: Math.round(usableQty * 1000) / 1000 });
      }

      const curCid = so.currentCycleId != null ? Number(so.currentCycleId) : null;
      const pendByItem =
        curCid != null && Number.isFinite(curCid) && curCid > 0
          ? await loadNoQtyPendingQcDispositionQtyByItem(prisma, soId, curCid)
          : new Map();
      const pendingQcDispositionByItem = [...pendByItem.entries()].map(([itemId, qty]) => ({
        itemId,
        pendingQty: Math.round(Number(qty) * 1000) / 1000,
      }));

      return res.json({
        salesOrderId: soId,
        closedShortageLines: closedLines,
        currentUsableByItem: usableByItem,
        pendingQcDispositionByItem,
        stockMayHaveChangedWarning:
          String(so.internalStatus) === "MANUALLY_CLOSED" || String(so.internalStatus) === "CLOSED",
      });
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
  requireRole(NO_QTY_FLOW_STATE_READ_ROLES),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) {
        const err = new Error("Invalid sales order id.");
        err.statusCode = 400;
        throw err;
      }

      const flow = await resolveNoQtyWorkflowState(prisma, {
        salesOrderId: soId,
        cycleId: parseStrictPositiveIntId(req.query?.cycleId),
        userRole: req.user?.role,
      });
      return res.json(flow);

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
          createNextRsEligible: false,
          nextRsAlreadyCreatedDocNo: null,
          treatFgAsOptionalStoreStock: false,
          nextRollingRequirementSheetId: null,
          nextRollingRequirementSheetCycleId: null,
        });
      }

      const cycleIdFromQuery = parseStrictPositiveIntId(req.query?.cycleId);
      const cycleIdFromPointer = parseStrictPositiveIntId(head.currentCycleId);
      /** Prefer validated query cycle, else SO pointer — must belong to this SO (never trust raw ids alone). */
      const tryCycleIds = [];
      if (cycleIdFromQuery != null) tryCycleIds.push(cycleIdFromQuery);
      if (cycleIdFromPointer != null && !tryCycleIds.includes(cycleIdFromPointer)) tryCycleIds.push(cycleIdFromPointer);
      let cycleId = null;
      for (const cid of tryCycleIds) {
        // eslint-disable-next-line no-await-in-loop -- tiny list (≤2); keeps flow-state one round-trip
        const row = await prisma.salesOrderCycle.findFirst({
          where: { id: cid, salesOrderId: soId },
          select: { id: true },
        });
        if (row?.id != null) {
          cycleId = Number(row.id);
          break;
        }
      }

      if (!cycleId) {
        const createNextRs = await computeNoQtyCreateNextRsEligibilityResolved(prisma, soId);
        return res.json({
          salesOrderId: soId,
          cycleId: null,
          isCompleted:
            head.internalStatus === "COMPLETED" ||
            head.internalStatus === "MANUALLY_CLOSED" ||
            head.internalStatus === "CLOSED",
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
          createNextRsEligible: createNextRs.eligible,
          nextRsAlreadyCreatedDocNo: createNextRs.existingNextRsDocNo,
          treatFgAsOptionalStoreStock: false,
          nextRollingRequirementSheetId: null,
          nextRollingRequirementSheetCycleId: null,
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

      const isCompleted =
        head.internalStatus === "COMPLETED" ||
        head.internalStatus === "MANUALLY_CLOSED" ||
        head.internalStatus === "CLOSED";

      // NO_QTY: stock-covered shortcut to Dispatch only when locked RS has no manufacturing remainder
      // (suggestedWoQtySnapshot > 0 means WO/production path must come first).
      const NO_QTY_EPS = 1e-6;
      let noQtyDispatchableNow = false;
      if (head.orderType === "NO_QTY" && requirementLocked && cycleId != null) {
        const sheet = await prisma.requirementSheet.findFirst({
          where: { salesOrderId: soId, cycleId, status: "LOCKED" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: { lines: true },
        });
        if (sheet && (sheet.lines || []).length) {
          const needsManufacturing = (sheet.lines || []).some((ln) => Number(ln.suggestedWoQtySnapshot ?? 0) > NO_QTY_EPS);
          if (needsManufacturing) {
            noQtyDispatchableNow = false;
          } else {
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
              // Stock-covered only: no suggested WO remainder; usable exists for a capped line → Dispatch-ready.
              if (usable > NO_QTY_EPS) {
                noQtyDispatchableNow = true;
                break;
              }
            }
          }
          }
        }
      }

      const NO_QTY_FLOW_EPS = 1e-6;

      const [prodRowsForQc, dispRowsForNet] = await Promise.all([
        prisma.productionEntry.findMany({
          where: {
            workflowStatus: "APPROVED",
            workOrderLine: { workOrder: { salesOrderId: soId, cycleId } },
          },
          include: { qcEntries: { where: QC_ENTRY_ACTIVE_WHERE } },
        }),
        prisma.dispatch.findMany({
          where: { soId, reversalOfId: null },
          select: { itemId: true, dispatchedQty: true, cycleId: true, workflowStatus: true },
        }),
      ]);

      let qcPendingForCycle = false;
      for (const pe of prodRowsForQc || []) {
        const producedQty = Number(pe.producedQty);
        const ac = sumActiveQcAcceptedQty(pe.qcEntries);
        const rj = sumActiveQcRejectedQty(pe.qcEntries);
        const pend = getProductionBatchQcPendingQty(producedQty, ac, rj);
        if (pend > NO_QTY_FLOW_EPS && ac <= NO_QTY_FLOW_EPS && rj <= NO_QTY_FLOW_EPS) {
          qcPendingForCycle = true;
          break;
        }
      }

      const qcInputs = [{ id: soId, currentCycleId: cycleId }];
      const [qcAcceptedMap, recheckDispMap, postCycleMap] = await Promise.all([
        loadNoQtyCycleQcAcceptedMap(prisma, qcInputs),
        loadNoQtyDispositionUsableForDispatchPoolMap(prisma, qcInputs),
        loadNoQtyPostCycleApprovalMapForInputs(prisma, qcInputs),
      ]);
      const wantCycle = normalizePositiveCycleId(cycleId);
      const cycleDispRows =
        wantCycle == null
          ? []
          : (dispRowsForNet || []).filter((d) => normalizePositiveCycleId(d.cycleId) === wantCycle);
      const netByItemRaw = netDispatchedByItemId(cycleDispRows, DISPATCH_ALLOC_MODE.OPERATIONAL);
      const mergedNetDispatched = new Map();
      for (const [k, v] of netByItemRaw.entries()) {
        const nk = Number(k);
        if (!Number.isFinite(nk)) continue;
        mergedNetDispatched.set(nk, (mergedNetDispatched.get(nk) ?? 0) + Number(v));
      }

      let hasQcAcceptedUndispatched = false;
      if (wantCycle != null) {
        for (const [key, qcAccRaw] of qcAcceptedMap.entries()) {
          const parts = String(key).split(":");
          if (parts.length !== 3) continue;
          const kSo = Number(parts[0]);
          const kCyc = Number(parts[1]);
          const itemId = Number(parts[2]);
          if (kSo !== soId || kCyc !== wantCycle) continue;
          const qcAcc = Number(qcAccRaw);
          const rec = Number(recheckDispMap.get(key) ?? 0);
          const post = Number(postCycleMap.get(key) ?? 0);
          const pool = qcAcc + rec + post;
          const net = mergedNetDispatched.get(itemId) ?? 0;
          if (pool - net > NO_QTY_FLOW_EPS) {
            hasQcAcceptedUndispatched = true;
            break;
          }
        }
      }

      let nextAction = (() => {
        if (salesBillExists) return "SALES_BILL";
        if (dispatchExists) return "SALES_BILL";
        // Dispatch accepted qty even when rework / remaining batch QC is still pending (parallel paths).
        if (hasQcAcceptedUndispatched) return "STORE";
        if (qcPendingForCycle) return "QA";
        if (noQtyDispatchableNow && requirementLocked) return "STORE";
        if (workOrderExists && !productionExists) return "PRODUCTION";
        if (workOrderExists && productionExists) return "STORE";
        if (workOrderExists) return "PRODUCTION";
        if (requirementLocked) return noQtyDispatchableNow ? "STORE" : "WORK_ORDER";
        return "REQUIREMENT";
      })();

      // Safeguard: if a work order exists, we must never send the user back to "WORK_ORDER".
      if (workOrderExists && nextAction === "WORK_ORDER") {
        nextAction = "PRODUCTION";
      }

      const stepFromAction = {
        REQUIREMENT: 1,
        WORK_ORDER: 2,
        PRODUCTION: 3,
        QC: 4,
        DISPATCH: 5,
        SALES_BILL: 6,
      };
      const activeStep = stepFromAction[nextAction] ?? 1;

      const createNextRs = await computeNoQtyCreateNextRsEligibilityResolved(prisma, soId);

      const cycleUi = await prisma.salesOrderCycle.findFirst({
        where: { id: cycleId, salesOrderId: soId },
        select: { noQtyTreatFgAsOptionalStoreStock: true },
      });
      const treatFgAsOptionalStoreStock = Boolean(cycleUi?.noQtyTreatFgAsOptionalStoreStock);

      const rolling = await findNoQtyNextRollingRequirementSheetTarget(prisma, soId, cycleId);

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
        qcPendingForCycle,
        hasQcDispatchPending: hasQcAcceptedUndispatched,
        treatFgAsOptionalStoreStock,
        nextRollingRequirementSheetId: rolling.sheetId,
        nextRollingRequirementSheetCycleId: rolling.cycleId,
        dispatchExists,
        salesBillExists,
        nextAction,
        activeStep,
        createNextRsEligible: createNextRs.eligible,
        nextRsAlreadyCreatedDocNo: createNextRs.existingNextRsDocNo,
      });
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * Admin / support only: manual override of dashboard optional-dispatch pressure. Operators use automatic
 * intent from POST /api/dispatch/dispatches (prepare) and lock/delete flows.
 *
 * POST /api/sales-orders/:id/no-qty-cycle/:cycleId/optional-store-stock-intent
 * Body: { "treatAsOptionalStoreStock": boolean }
 */
salesOrderRouter.post(
  "/:id/no-qty-cycle/:cycleId/optional-store-stock-intent",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      const cyclePk = Number(req.params.cycleId);
      if (!Number.isFinite(soId) || soId <= 0 || !Number.isFinite(cyclePk) || cyclePk <= 0) {
        return res.status(400).json({ error: { message: "Invalid sales order or cycle id." } });
      }
      const schema = z.object({ treatAsOptionalStoreStock: z.boolean() });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: { message: "Body must include treatAsOptionalStoreStock (boolean)." } });
      }

      const so = await prisma.salesOrder.findUnique({
        where: { id: soId },
        select: { orderType: true },
      });
      if (!so || so.orderType !== "NO_QTY") {
        return res.status(400).json({ error: { message: "Only NO_QTY sales orders support this intent." } });
      }

      const cyc = await prisma.salesOrderCycle.findFirst({
        where: { id: cyclePk, salesOrderId: soId },
        select: { id: true },
      });
      if (!cyc) {
        return res.status(404).json({ error: { message: "Cycle not found for this order." } });
      }

      await prisma.salesOrderCycle.update({
        where: { id: cyclePk },
        data: { noQtyTreatFgAsOptionalStoreStock: parsed.data.treatAsOptionalStoreStock },
      });

      await logActivity({
        user: req.user,
        module: ACTIVITY_MODULES.SALES_ORDER,
        entityType: ACTIVITY_ENTITY_TYPES.SALES_ORDER,
        entityId: soId,
        action: ACTIVITY_ACTIONS.UPDATED,
        message: `NO_QTY optional store stock intent: cycle ${cyclePk} → ${parsed.data.treatAsOptionalStoreStock}`,
        metadata: { cycleId: cyclePk, treatAsOptionalStoreStock: parsed.data.treatAsOptionalStoreStock },
      });

      return res.json({ ok: true, treatAsOptionalStoreStock: parsed.data.treatAsOptionalStoreStock });
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * NO_QTY only: Before opening/planning the *next* requirement sheet, close the active cycle and
 * create the next SalesOrderCycle when {@link computeNoQtyCreateNextRsEligibility} passes (demand-driven / rolling; no billing).
 * Idempotent when not eligible. Backend-owned cycle pointer — callers must not rely on URL cycleId.
 *
 * POST /api/sales-orders/:id/no-qty-cycle/prepare-next-requirement-sheet
 */
salesOrderRouter.post(
  "/:id/no-qty-cycle/prepare-next-requirement-sheet",
  requireAuth,
  requireRole(NEXT_RS_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      if (!Number.isFinite(soId) || soId <= 0) {
        return res.status(400).json({ error: { message: "Invalid sales order id." } });
      }
      const result = await prisma.$transaction((tx) =>
        advanceNoQtyCycleForNextRequirementSheetIfEligible(tx, soId, req.user?.userId ?? null),
      );
      return res.json(result);
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
  requireRole(SO_WRITE_ROLES),
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
            module: "ADMIN",
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
  requireRole(SO_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const soId = Number(req.params.id);
      const body = z
        .object({
          customerPoReference: z.string().nullable().optional(),
          remarks: z.string().nullable().optional(),
          shipToAddressId: z.number().int().positive().optional().nullable(),
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

        if (body.shipToAddressId !== undefined) {
          const customerId = so.customerId;
          if (!customerId) {
            const err = new Error("Customer is required before setting Ship To address.");
            err.statusCode = 400;
            throw err;
          }
          if (body.shipToAddressId == null) {
            await tx.salesOrder.update({ where: { id: soId }, data: { shipToAddressId: null } });
          } else {
            const addr = await tx.customerDeliveryAddress.findFirst({
              where: { id: body.shipToAddressId, customerId: customerId, isActive: true },
              select: { id: true },
            });
            if (!addr) {
              const err = new Error("Invalid Ship To address for selected customer.");
              err.statusCode = 400;
              throw err;
            }
            await tx.salesOrder.update({ where: { id: soId }, data: { shipToAddressId: addr.id } });
          }
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
        return enrichSalesOrderWithCommercialAddress(tx, saved);
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
  requireRole(SO_WRITE_ROLES),
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
  requireRole(SO_WRITE_ROLES),
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
            module: "ADMIN",
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

/** Regular SO: dropdown list — approved quotations (snapshot copy; independent of existing SO link). */
salesOrderRouter.get(
  "/regular-copy-sources/quotations",
  requireAuth,
  requireRole(SO_READ_ROLES),
  async (_req, res, next) => {
    try {
      const rows = await prisma.quotation.findMany({
        where: { workflowStatus: "APPROVED", lines: { some: {} } },
        orderBy: { id: "desc" },
        take: 300,
        include: {
          enquiry: { include: { customer: { select: { id: true, name: true } } } },
          salesOrder: { select: { id: true, docNo: true } },
        },
      });
      return res.json(
        rows.map((q) => ({
          id: q.id,
          quotationNo: q.quotationNo,
          customerName: q.enquiry?.customer?.name ?? "—",
          existingSalesOrderId: q.salesOrder?.id ?? null,
          existingSalesOrderDocNo: q.salesOrder?.docNo ?? null,
        })),
      );
    } catch (e) {
      return next(e);
    }
  },
);

/** Regular SO: dropdown list — NORMAL sales orders as templates. */
salesOrderRouter.get(
  "/regular-copy-sources/sales-orders",
  requireAuth,
  requireRole(SO_READ_ROLES),
  async (_req, res, next) => {
    try {
      const rows = await prisma.salesOrder.findMany({
        where: { orderType: "NORMAL" },
        orderBy: { id: "desc" },
        take: 300,
        include: {
          customer: { select: { id: true, name: true } },
          _count: { select: { lines: true } },
        },
      });
      return res.json(
        rows.map((s) => ({
          id: s.id,
          docNo: s.docNo,
          customerName: s.customer?.name ?? "—",
          internalStatus: s.internalStatus,
          lineCount: s._count?.lines ?? 0,
        })),
      );
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * Prefill payload for "Create from previous" (Regular SO).
 * GET /api/sales-orders/copy-preview?sourceType=QUOTATION|SO&id=n
 */
salesOrderRouter.get(
  "/copy-preview",
  requireAuth,
  requireRole(SO_READ_ROLES),
  async (req, res, next) => {
    try {
      const sourceType = String(req.query.sourceType ?? "").toUpperCase();
      const id = Number(req.query.id);
      if (!(sourceType === "QUOTATION" || sourceType === "SO")) {
        const err = new Error("sourceType must be QUOTATION or SO.");
        err.statusCode = 400;
        throw err;
      }
      if (!Number.isFinite(id) || id <= 0) {
        const err = new Error("Invalid id.");
        err.statusCode = 400;
        throw err;
      }

      if (sourceType === "QUOTATION") {
        const q = await prisma.quotation.findUnique({
          where: { id },
          include: {
            lines: { include: { item: { select: { itemName: true } } } },
            enquiry: { include: { customer: true } },
            salesOrder: { select: { id: true, docNo: true } },
          },
        });
        if (!q) {
          const err = new Error("Quotation not found");
          err.statusCode = 404;
          throw err;
        }
        if (q.workflowStatus !== "APPROVED") {
          const err = new Error("Only approved quotations can be used as a template.");
          err.statusCode = 409;
          throw err;
        }
        if (!q.lines.length) {
          const err = new Error("Quotation has no lines.");
          err.statusCode = 400;
          throw err;
        }
        return res.json({
          sourceType: "QUOTATION",
          sourceId: q.id,
          quotationNo: q.quotationNo,
          terms: q.terms ?? null,
          workflowStatus: q.workflowStatus,
          existingSalesOrder: q.salesOrder ? { id: q.salesOrder.id, docNo: q.salesOrder.docNo } : null,
          enquiry: {
            customerId: q.enquiry.customerId,
            customer: { id: q.enquiry.customer.id, name: q.enquiry.customer.name },
          },
          lines: q.lines.map((l) => ({
            itemId: l.itemId,
            itemName: l.item?.itemName ?? `Item #${l.itemId}`,
            qty: String(l.qty),
            rate: String(l.rate),
            lineTotal: String(l.lineTotal),
            discountPct: String(l.discountPct),
            gstPct: String(l.gstPct),
            isFree: Boolean(l.isFree),
          })),
        });
      }

      const src = await prisma.salesOrder.findUnique({
        where: { id },
        include: {
          customer: true,
          lines: {
            include: {
              item: { select: { itemName: true } },
              quotationLine: { select: { rate: true, gstPct: true } },
            },
          },
        },
      });
      if (!src) {
        const err = new Error("Sales order not found");
        err.statusCode = 404;
        throw err;
      }
      if (src.orderType !== "NORMAL") {
        const err = new Error("Only Regular sales orders can be used as a template.");
        err.statusCode = 409;
        throw err;
      }
      if (!src.lines.length) {
        const err = new Error("Sales order has no lines.");
        err.statusCode = 400;
        throw err;
      }

      return res.json({
        sourceType: "SO",
        sourceId: src.id,
        quotationNo: src.docNo ?? `SO-${src.id}`,
        terms: null,
        workflowStatus: "APPROVED",
        existingSalesOrder: null,
        remarksPreview: src.remarks ?? null,
        enquiry: {
          customerId: src.customerId ?? 0,
          customer: src.customer ? { id: src.customer.id, name: src.customer.name } : { id: 0, name: "—" },
        },
        lines: src.lines.map((l) => {
          const rateSrc =
            l.quotationLine != null ? Number(l.quotationLine.rate) : Number(l.rate != null ? l.rate : 0);
          const gstSrc =
            l.quotationLine != null
              ? Number(l.quotationLine.gstPct)
              : l.gstRate != null
                ? Number(l.gstRate)
                : 18;
          return {
            itemId: l.itemId,
            itemName: l.item?.itemName ?? `Item #${l.itemId}`,
            qty: String(l.customerPoQty != null && String(l.customerPoQty).trim() !== "" ? l.customerPoQty : l.qty),
            rate: String(rateSrc),
            lineTotal: "",
            discountPct: "0",
            gstPct: String(gstSrc),
            isFree: Boolean(l.isFree),
            bufferPercentSnapshot: String(Number(l.bufferPercent ?? 0)),
          };
        }),
      });
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * Regular SO: create new approved SO from quotation or NORMAL SO snapshot (does not alter source rows).
 * POST /api/sales-orders/from-previous
 */
salesOrderRouter.post(
  "/from-previous",
  requireAuth,
  requireRole(SO_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          sourceType: z.enum(["QUOTATION", "SO"]),
          sourceId: z.number().int().positive(),
          customerPoReference: z.string().min(1, "Customer PO reference is required."),
          remarks: z.string().optional().nullable(),
          shipToAddressId: z.number().int().positive().optional().nullable(),
          lines: z
            .array(
              z.object({
                itemId: z.number().int(),
                customerPoQty: z.number().positive(),
                bufferPercent: z.number().min(0),
              }),
            )
            .min(1),
        })
        .parse(req.body);

      const so = await prisma.$transaction(async (tx) => {
        const maxBufRow = await tx.appSetting.findUnique({
          where: { id: 1 },
          select: { maxRegularSoBufferPercent: true },
        });
        const maxBuf = clampMaxRegularSoBufferPercent(maxBufRow?.maxRegularSoBufferPercent);

        if (body.sourceType === "QUOTATION") {
          const q = await tx.quotation.findUnique({
            where: { id: body.sourceId },
            include: { lines: true, enquiry: true },
          });
          if (!q) {
            const err = new Error("Quotation not found");
            err.statusCode = 404;
            throw err;
          }
          if (q.workflowStatus !== "APPROVED") {
            const err = new Error("Only approved quotations can be used as a template.");
            err.statusCode = 409;
            throw err;
          }
          if (!q.lines.length) {
            const err = new Error("Quotation has no lines");
            err.statusCode = 400;
            throw err;
          }
          if (body.lines.length !== q.lines.length) {
            const err = new Error("Line count must match the template quotation.");
            err.statusCode = 400;
            throw err;
          }
          for (let i = 0; i < q.lines.length; i += 1) {
            if (Number(q.lines[i].itemId) !== Number(body.lines[i].itemId)) {
              const err = new Error("Line itemId order must match the template quotation.");
              err.statusCode = 400;
              throw err;
            }
          }

          const overrideLines = body.lines.map((x) => ({
            itemId: x.itemId,
            customerPoQty: x.customerPoQty,
            bufferPercent: x.bufferPercent,
          }));

          const lineCreates = q.lines.map((l, i) => {
            const n = normalizeSalesOrderDraftLineQuantities(overrideLines[i], "NORMAL", maxBuf);
            return {
              itemId: l.itemId,
              qty: new Prisma.Decimal(String(n.plannedQty)),
              customerPoQty: new Prisma.Decimal(String(n.customerPoQty)),
              bufferPercent: new Prisma.Decimal(String(n.bufferPercent)),
              rate: new Prisma.Decimal(String(Number(l.rate))),
              gstRate:
                l.gstPct != null && String(l.gstPct).trim() !== ""
                  ? new Prisma.Decimal(String(Number(l.gstPct)))
                  : null,
              rateEffectiveFrom: null,
              quotationLineId: null,
              isFree: Boolean(l.isFree),
            };
          });

          const termsPart = q.terms?.trim() ? `Quotation terms (snapshot):\n${q.terms.trim()}` : "";
          const userRemarks = body.remarks?.trim() ? body.remarks.trim() : "";
          const mergedRemarks = [termsPart, userRemarks].filter(Boolean).join("\n\n") || null;

          const createdSo = await tx.salesOrder.create({
            data: {
              docNo: await allocateDocNo(tx, { docType: DocType.SALES_ORDER, date: new Date() }),
              customerId: q.enquiry.customerId,
              shipToAddressId: body.shipToAddressId ?? null,
              quotationId: null,
              customerPoReference: body.customerPoReference.trim(),
              remarks: mergedRemarks,
              orderType: "NORMAL",
              internalStatus: "APPROVED",
              sourceType: "QUOTATION",
              sourceId: q.id,
              lines: { create: lineCreates },
            },
            include: soInclude,
          });

          if (createdSo.shipToAddressId != null) {
            const ok = await tx.customerDeliveryAddress.findFirst({
              where: { id: createdSo.shipToAddressId, customerId: createdSo.customerId, isActive: true },
              select: { id: true },
            });
            if (!ok) {
              const err = new Error("Invalid Ship To address for selected customer.");
              err.statusCode = 400;
              throw err;
            }
          } else {
            await ensureShipToAutoPick(tx, createdSo.id);
          }

          const company = await getCompanyStateDetails();
          const companyStateCode = company?.companyStateRef?.stateCode ?? null;
          await freezeSalesOrderCommercialSnapshots(tx, createdSo.id, { companyStateCode });

          const docLabel = displaySalesOrderNo(createdSo.id, createdSo.docNo);
          await auditLog.write(tx, {
            action: auditLog.AuditAction.CREATE,
            entityType: auditLog.AuditEntityType.SALES_ORDER,
            entityId: String(createdSo.id),
            actorUserId: req.user.userId,
            actorRole: req.user.role,
            summary: "Sales Order created from previous quotation (snapshot)",
            payload: {
              module: "ADMIN",
              actionLabel: "CREATE",
              ref: { type: "SO", id: String(createdSo.id), no: docLabel },
              snapshot: {
                sourceType: "QUOTATION",
                sourceId: q.id,
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
            message: "Sales Order created from previous quotation (snapshot)",
            metadata: salesOrderActivityMeta(createdSo),
          });

          const row = await tx.salesOrder.findUnique({ where: { id: createdSo.id }, include: soInclude });
          return row ?? createdSo;
        }

        const src = await tx.salesOrder.findUnique({
          where: { id: body.sourceId },
          include: {
            lines: {
              include: { quotationLine: { select: { rate: true, gstPct: true } } },
            },
          },
        });
        if (!src) {
          const err = new Error("Sales order not found");
          err.statusCode = 404;
          throw err;
        }
        if (src.orderType !== "NORMAL") {
          const err = new Error("Only Regular sales orders can be used as a template.");
          err.statusCode = 409;
          throw err;
        }
        if (!src.lines.length) {
          const err = new Error("Template sales order has no lines.");
          err.statusCode = 400;
          throw err;
        }
        if (body.lines.length !== src.lines.length) {
          const err = new Error("Line count must match the template sales order.");
          err.statusCode = 400;
          throw err;
        }
        for (let i = 0; i < src.lines.length; i += 1) {
          if (Number(src.lines[i].itemId) !== Number(body.lines[i].itemId)) {
            const err = new Error("Line itemId order must match the template sales order.");
            err.statusCode = 400;
            throw err;
          }
        }

        const overrideLines = body.lines.map((x) => ({
          itemId: x.itemId,
          customerPoQty: x.customerPoQty,
          bufferPercent: x.bufferPercent,
        }));

        const lineCreates = src.lines.map((l, i) => {
          const n = normalizeSalesOrderDraftLineQuantities(overrideLines[i], "NORMAL", maxBuf);
          const rateNum =
            l.quotationLine != null ? Number(l.quotationLine.rate) : Number(l.rate != null ? l.rate : 0);
          const gstNum =
            l.quotationLine != null
              ? Number(l.quotationLine.gstPct)
              : l.gstRate != null
                ? Number(l.gstRate)
                : null;
          return {
            itemId: l.itemId,
            qty: new Prisma.Decimal(String(n.plannedQty)),
            customerPoQty: new Prisma.Decimal(String(n.customerPoQty)),
            bufferPercent: new Prisma.Decimal(String(n.bufferPercent)),
            rate: new Prisma.Decimal(String(rateNum)),
            gstRate: gstNum != null && Number.isFinite(gstNum) ? new Prisma.Decimal(String(gstNum)) : null,
            rateEffectiveFrom: null,
            quotationLineId: null,
            isFree: Boolean(l.isFree),
          };
        });

        const srcLabel = displaySalesOrderNo(src.id, src.docNo);
        const linkRemark = `Created from previous sales order ${srcLabel} (snapshot).`;
        const userRemarks = body.remarks?.trim() ? body.remarks.trim() : "";
        const mergedRemarks = [linkRemark, userRemarks].filter(Boolean).join("\n\n");

        const createdSo = await tx.salesOrder.create({
          data: {
            docNo: await allocateDocNo(tx, { docType: DocType.SALES_ORDER, date: new Date() }),
            customerId: src.customerId,
            quotationId: null,
            customerPoReference: body.customerPoReference.trim(),
            remarks: mergedRemarks,
            orderType: "NORMAL",
            internalStatus: "APPROVED",
            sourceType: "SO",
            sourceId: src.id,
            lines: { create: lineCreates },
          },
          include: soInclude,
        });

        const docLabel = displaySalesOrderNo(createdSo.id, createdSo.docNo);
        await auditLog.write(tx, {
          action: auditLog.AuditAction.CREATE,
          entityType: auditLog.AuditEntityType.SALES_ORDER,
          entityId: String(createdSo.id),
          actorUserId: req.user.userId,
          actorRole: req.user.role,
          summary: "Sales Order created from previous sales order (snapshot)",
          payload: {
            module: "ADMIN",
            actionLabel: "CREATE",
            ref: { type: "SO", id: String(createdSo.id), no: docLabel },
            snapshot: {
              sourceType: "SO",
              sourceId: src.id,
              templateDocNo: src.docNo ?? null,
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
          message: "Sales Order created from previous sales order (snapshot)",
          metadata: salesOrderActivityMeta(createdSo),
        });

        return createdSo;
      });

      const [out] = await enrichSalesOrdersWithProcessStage(prisma, [enrichSalesOrderWithDispatchStats(so)]);
      const enriched = await prisma.$transaction(async (tx) => enrichSalesOrderWithCommercialAddress(tx, out));
      return res.status(201).json(enriched);
    } catch (e) {
      return next(e);
    }
  },
);

salesOrderRouter.get(
  "/:id",
  requireAuth,
  requireRole(SO_DETAIL_READ_ROLES),
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
      const enriched = await prisma.$transaction(async (tx) => enrichSalesOrderWithCommercialAddress(tx, out));
      return res.json(enriched);
    } catch (e) {
      return next(e);
    }
  },
);

salesOrderRouter.patch(
  "/:id/lines",
  requireAuth,
  requireRole(SO_WRITE_ROLES),
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
