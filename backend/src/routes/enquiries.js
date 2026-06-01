const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const enquiryRouter = express.Router();

const ENQUIRY_DUPLICATE_ITEM_MESSAGE =
  "The same item cannot be added more than once in one enquiry.";

const lineSchema = z.object({
  itemId: z.number().int(),
  qty: z.number().optional(),
});

/**
 * @param {Array<{ itemId: number }>} lines
 */
function assertEnquiryLinesUniqueItems(lines) {
  const ids = lines.map((l) => l.itemId);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) {
      const err = new Error(ENQUIRY_DUPLICATE_ITEM_MESSAGE);
      err.statusCode = 400;
      throw err;
    }
    seen.add(id);
  }
}

const includeEnquiry = {
  customer: true,
  lines: { include: { item: true } },
  feasibility: true,
  quotation: { include: { lines: { include: { item: true } } } },
};

enquiryRouter.get("/", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const rows = await prisma.enquiry.findMany({
      where: {
        // Active pre-quotation funnel only (plus QUOTED optionally for tracking).
        status: { in: ["OPEN", "DRAFT", "PENDING", "FEASIBLE", "QUOTED"] },
      },
      orderBy: { id: "desc" },
      include: includeEnquiry,
    });

    // Repair/sync: when a linked quotation is APPROVED, enquiry must be QUOTED.
    // This ensures the Enquiries page reflects approval even if the quotation was approved before the sync rule existed.
    const needsSync = rows.filter(
      (e) => e.quotation?.workflowStatus === "APPROVED" && e.status !== "QUOTED",
    );
    if (needsSync.length) {
      await prisma.$transaction(
        needsSync.map((e) =>
          prisma.enquiry.update({
            where: { id: e.id },
            data: { status: "QUOTED" },
          }),
        ),
      );
      for (const e of needsSync) {
        console.log("Enquiry updated to QUOTED:", e.id);
      }
      // Update in-memory rows so the response matches DB immediately.
      for (const e of rows) {
        if (e.quotation?.workflowStatus === "APPROVED") e.status = "QUOTED";
      }
    }
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

enquiryRouter.get("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.enquiry.findUnique({
      where: { id },
      include: includeEnquiry,
    });
    if (!row) {
      const err = new Error("Enquiry not found");
      err.statusCode = 404;
      throw err;
    }
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

enquiryRouter.post("/", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const isValidNoQtyLineQty = (v) => v === undefined || v === null || (Number.isFinite(Number(v)) && Number(v) >= 0);
    const schema = z.object({
      customerId: z.number().int(),
      lines: z.array(lineSchema).min(1),
      flowType: z.enum(["REGULAR", "NO_QTY"]).optional(),
      remarks: z.string().optional(),
    });
    const body = schema.parse(req.body);
    const flowType = body.flowType ?? "REGULAR";
    assertEnquiryLinesUniqueItems(body.lines);
    if (flowType === "REGULAR") {
      for (const l of body.lines) {
        const q = Number(l.qty);
        if (!Number.isFinite(q) || q <= 0) {
          const err = new Error("Quantity must be greater than zero for each enquiry line (Regular enquiry).");
          err.statusCode = 400;
          throw err;
        }
      }
    } else {
      // NO_QTY: qty is informational at enquiry stage; allow omitted/blank/0.
      for (const l of body.lines) {
        if (!isValidNoQtyLineQty(l.qty)) {
          const err = new Error("Quantity must be a non-negative number when provided (No Qty enquiry).");
          err.statusCode = 400;
          throw err;
        }
      }
    }
    const created = await prisma.enquiry.create({
      data: {
        customerId: body.customerId,
        status: "OPEN",
        flowType,
        remarks: body.remarks?.trim() || null,
        lines: {
          create: body.lines.map((l) => ({
            itemId: l.itemId,
            qty: String(flowType === "NO_QTY" ? Number(l.qty ?? 0) : Number(l.qty)),
          })),
        },
      },
      include: includeEnquiry,
    });
    return res.status(201).json(created);
  } catch (e) {
    return next(e);
  }
});

enquiryRouter.put("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const isValidNoQtyLineQty = (v) => v === undefined || v === null || (Number.isFinite(Number(v)) && Number(v) >= 0);
    const schema = z.object({
      customerId: z.number().int().optional(),
      lines: z.array(lineSchema).min(1).optional(),
      flowType: z.enum(["REGULAR", "NO_QTY"]).optional(),
      remarks: z.string().optional().nullable(),
    });
    const body = schema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const enq = await tx.enquiry.findUnique({ where: { id }, include: { quotation: true } });
      if (!enq) {
        const err = new Error("Enquiry not found");
        err.statusCode = 404;
        throw err;
      }
      if (enq.quotation) {
        if (body.flowType !== undefined && body.flowType !== enq.flowType) {
          const err = new Error("Flow type cannot be changed after quotation creation.");
          err.statusCode = 400;
          throw err;
        }
        const err = new Error("Cannot edit enquiry after quotation is created");
        err.statusCode = 400;
        throw err;
      }
      if (!["OPEN", "DRAFT", "PENDING", "FEASIBLE", "NOT_FEASIBLE"].includes(enq.status)) {
        const err = new Error("Enquiry cannot be edited in current status");
        err.statusCode = 400;
        throw err;
      }

      const effectiveFlowType = body.flowType ?? enq.flowType ?? "REGULAR";
      if (body.lines != null) {
        if (effectiveFlowType === "REGULAR") {
          for (const l of body.lines) {
            const q = Number(l.qty);
            if (!Number.isFinite(q) || q <= 0) {
              const err = new Error("Quantity must be greater than zero for each enquiry line (Regular enquiry).");
              err.statusCode = 400;
              throw err;
            }
          }
        } else {
          for (const l of body.lines) {
            if (!isValidNoQtyLineQty(l.qty)) {
              const err = new Error("Quantity must be a non-negative number when provided (No Qty enquiry).");
              err.statusCode = 400;
              throw err;
            }
          }
        }
      }

      if (body.lines != null) {
        assertEnquiryLinesUniqueItems(body.lines);
        await tx.enquiryLine.deleteMany({ where: { enquiryId: id } });
        await tx.enquiryLine.createMany({
          data: body.lines.map((l) => ({
            enquiryId: id,
            itemId: l.itemId,
            qty: String(effectiveFlowType === "NO_QTY" ? Number(l.qty ?? 0) : Number(l.qty)),
          })),
        });
      }

      return tx.enquiry.update({
        where: { id },
        data: {
          customerId: body.customerId ?? undefined,
          flowType: body.flowType ?? undefined,
          remarks: body.remarks === undefined ? undefined : body.remarks?.trim() || null,
        },
        include: includeEnquiry,
      });
    });
    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

enquiryRouter.delete("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const enq = await prisma.enquiry.findUnique({ where: { id }, include: { quotation: true } });
    if (!enq) {
      const err = new Error("Enquiry not found");
      err.statusCode = 404;
      throw err;
    }
    if (enq.quotation) {
      const err = new Error("Delete quotation first");
      err.statusCode = 400;
      throw err;
    }
    await prisma.enquiry.delete({ where: { id } });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

async function applyFeasibility(req, res, next) {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      outcome: z.enum(["feasible", "not_feasible"]),
      remarks: z.string().optional(),
    });
    const body = schema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const enquiry = await tx.enquiry.findUnique({ where: { id } });
      if (!enquiry) {
        const err = new Error("Enquiry not found");
        err.statusCode = 404;
        throw err;
      }
      if (!["OPEN", "DRAFT", "PENDING", "FEASIBLE", "NOT_FEASIBLE"].includes(enquiry.status)) {
        const err = new Error("Feasibility locked after quotation");
        err.statusCode = 400;
        throw err;
      }

      const feasible = body.outcome === "feasible";
      await tx.feasibility.upsert({
        where: { enquiryId: id },
        create: {
          enquiryId: id,
          status: feasible ? "COMPLETED" : "REJECTED",
          remarks: body.remarks ?? null,
        },
        update: {
          status: feasible ? "COMPLETED" : "REJECTED",
          remarks: body.remarks ?? null,
        },
      });

      const nextStatus = feasible ? "FEASIBLE" : "NOT_FEASIBLE";
      const updated = await tx.enquiry.update({
        where: { id },
        data: { status: nextStatus },
        include: includeEnquiry,
      });
      return updated;
    });

    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

enquiryRouter.post("/:id/feasibility", requireAuth, requireRole(["ADMIN"]), applyFeasibility);
enquiryRouter.put("/:id/feasibility", requireAuth, requireRole(["ADMIN"]), applyFeasibility);

module.exports = { enquiryRouter };
