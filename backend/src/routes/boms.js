const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { assertAdminPassword } = require("../services/adminPasswordAuth");
const { enrichBomWithPlanning } = require("../services/bomWeightPlanning");
const { allocateDocNo } = require("../services/docNoService");
const { DocType } = require("../prismaClientPackage");
const {
  BomStatus,
  BomType,
  bomLooksLocked,
  bomIsDraft,
  latestApprovedBomFindArgs,
} = require("../services/bomStatus");
const {
  assertBomHeaderItem,
  assertBomLinesValid,
  enrichBomRowWithComponents,
  enrichLinesWithComponentMeta,
  loadApprovedChildBomByFgIds,
  summarizeComponentLines,
} = require("../services/bomComponentService");

const bomRouter = express.Router();

const BOM_EDIT_FORBIDDEN = "Access denied. Only administrators can edit BOMs.";
const BOM_DELETE_FORBIDDEN = "Access denied. Only administrators can delete BOMs.";
const BOM_CREATE_FORBIDDEN = "Access denied. Only administrators can create BOMs.";
const BOM_IN_USE_MESSAGE =
  "This BOM is already used in operational transactions. Mark it inactive instead.";
const ADMIN_PW_MESSAGE = "Admin password is required to edit or delete approved BOM.";
const APPROVED_EDIT_MESSAGE =
  "Approved BOM cannot be edited directly. Use Edit to create a new draft revision.";

const bomInclude = {
  fgItem: true,
  fgWeightUnit: true,
  lines: { include: { rmItem: true }, orderBy: { id: "asc" } },
};

const bomTypeSchema = z.enum(["STANDARD", "APPROXIMATE", "CUSTOMER_SPECIFIC"]);

const headerSchema = z.object({
  fgWeight: z.number().positive().optional().nullable(),
  fgWeightUnitId: z.number().int().positive().optional().nullable(),
  outputQty: z.number().positive().optional().default(1),
  processLossPercent: z.number().min(0).max(100).optional().default(0),
  qcLossPercent: z.number().min(0).max(100).optional().default(0),
  suggestedFgPlanningBufferPercent: z.number().min(0).max(10).optional().nullable(),
  bomType: bomTypeSchema.optional().default("STANDARD"),
  effectiveFrom: z
    .union([z.string(), z.date()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null || v === "") return null;
      const d = v instanceof Date ? v : new Date(String(v));
      return Number.isFinite(d.getTime()) ? d : null;
    }),
  remarks: z.string().trim().max(500).optional().nullable(),
});

const lineSchema = z.object({
  rmItemId: z.number().int(),
  baseQty: z.number().positive(),
  notes: z.string().trim().max(500).optional().nullable(),
  wastagePercent: z.number().nonnegative().optional(),
  processLossPercent: z.number().nonnegative().optional(),
  qcAllowancePercent: z.number().nonnegative().optional(),
});

function normalizeBomHeaderInput(h) {
  const fgWeight = h.fgWeight != null && h.fgWeight !== "" ? Number(h.fgWeight) : null;
  const fgWeightUnitId =
    h.fgWeightUnitId != null && h.fgWeightUnitId !== "" ? Number(h.fgWeightUnitId) : null;
  const effectiveFrom = h.effectiveFrom instanceof Date ? h.effectiveFrom : null;
  return {
    fgWeight: fgWeight != null && Number.isFinite(fgWeight) && fgWeight > 0 ? String(fgWeight) : null,
    fgWeightUnitId: fgWeightUnitId != null && Number.isFinite(fgWeightUnitId) ? fgWeightUnitId : null,
    outputQty: String(Math.max(0.001, Number(h.outputQty ?? 1))),
    processLossPercent: String(Math.max(0, Math.min(100, Number(h.processLossPercent ?? 0)))),
    qcLossPercent: String(Math.max(0, Math.min(100, Number(h.qcLossPercent ?? 0)))),
    suggestedFgPlanningBufferPercent:
      h.suggestedFgPlanningBufferPercent != null && h.suggestedFgPlanningBufferPercent !== ""
        ? String(Math.max(0, Math.min(10, Number(h.suggestedFgPlanningBufferPercent))))
        : null,
    bomType: h.bomType ?? BomType.STANDARD,
    effectiveFrom,
    remarks: h.remarks ? String(h.remarks).trim() : null,
  };
}

function normalizeBomLineInput(l, header) {
  const processLossPercent = Number(header.processLossPercent ?? 0);
  const qcAllowancePercent = Number(header.qcLossPercent ?? 0);
  return {
    rmItemId: l.rmItemId,
    baseQty: l.baseQty,
    processLossPercent,
    qcAllowancePercent,
    notes: l.notes ? String(l.notes).trim() : null,
    wastagePercent: processLossPercent,
  };
}

function ensureUniqueRm(lines) {
  const seen = new Set();
  for (const l of lines) {
    if (seen.has(l.rmItemId)) return false;
    seen.add(l.rmItemId);
  }
  return true;
}

async function mapBomResponse(row, tx = prisma) {
  const planning = enrichBomWithPlanning(row);
  const withComponents = await enrichBomRowWithComponents(tx, planning);
  return {
    ...withComponents,
    revisionLabel: `R${withComponents.revisionNo ?? 1}`,
  };
}

async function mapBomListResponse(rows) {
  const allSfgIds = [];
  for (const row of rows) {
    for (const ln of row.lines ?? []) {
      if (ln.rmItem?.itemType === "SFG") allSfgIds.push(ln.rmItemId);
    }
  }
  const childBomByFgId = await loadApprovedChildBomByFgIds(prisma, allSfgIds);
  return rows.map((row) => {
    const planning = enrichBomWithPlanning(row);
    const lines = enrichLinesWithComponentMeta(planning.lines, childBomByFgId);
    const componentSummary = summarizeComponentLines(lines);
    return {
      ...planning,
      lines,
      componentSummary,
      revisionLabel: `R${planning.revisionNo ?? 1}`,
    };
  });
}

async function assertLockedBomAdminPassword(req, pwd) {
  const password = String(pwd ?? "").trim();
  if (!password) {
    const err = new Error("ADMIN_PASSWORD_REQUIRED");
    err.code = "ADMIN_PASSWORD_REQUIRED";
    err.statusCode = 403;
    throw err;
  }
  try {
    await assertAdminPassword(prisma, { userId: req.user.userId, password });
  } catch (e) {
    const err = new Error(e?.message === "Invalid admin password" ? "Invalid admin password" : "ADMIN_PASSWORD_REQUIRED");
    err.code = "ADMIN_PASSWORD_REQUIRED";
    err.statusCode = e?.statusCode === 401 ? 401 : 403;
    throw err;
  }
}


async function assertNoDraftForFg(tx, fgItemId, excludeId = null) {
  const draft = await tx.bom.findFirst({
    where: {
      fgItemId,
      status: BomStatus.DRAFT,
      ...(excludeId != null ? { id: { not: excludeId } } : {}),
    },
  });
  if (draft) {
    const err = new Error("A draft BOM revision already exists for this FG. Edit the draft or approve it first.");
    err.statusCode = 409;
    throw err;
  }
}

async function nextRevisionNo(tx, fgItemId) {
  const maxRow = await tx.bom.aggregate({
    where: { fgItemId },
    _max: { revisionNo: true },
  });
  return (maxRow._max.revisionNo ?? 0) + 1;
}

async function replaceBomLines(tx, bomId, bodyLines, header) {
  await tx.bomLine.deleteMany({ where: { bomId } });
  await tx.bomLine.createMany({
    data: bodyLines.map((raw) => {
      const l = normalizeBomLineInput(raw, header);
      return {
        bomId,
        rmItemId: l.rmItemId,
        baseQty: String(l.baseQty),
        wastagePercent: String(l.wastagePercent),
        processLossPercent: String(l.processLossPercent),
        qcAllowancePercent: String(l.qcAllowancePercent),
        notes: l.notes,
      };
    }),
  });
}

function assertEffectiveFromForApproval(header) {
  if (!header.effectiveFrom) {
    const err = new Error("Effective From is required.");
    err.statusCode = 400;
    throw err;
  }
}

bomRouter.get("/", requireAuth, requireRole(["ADMIN", "STORE", "PRODUCTION", "PURCHASE", "QA"]), async (req, res, next) => {
  try {
    const rows = await prisma.bom.findMany({
      orderBy: [{ docNo: "asc" }, { revisionNo: "desc" }],
      include: bomInclude,
    });
    return res.json(await mapBomListResponse(rows));
  } catch (e) {
    return next(e);
  }
});

bomRouter.get("/fg/:fgItemId", requireAuth, requireRole(["ADMIN", "STORE", "PRODUCTION", "PURCHASE", "QA"]), async (req, res, next) => {
  try {
    const fgItemId = Number(req.params.fgItemId);
    const row = await prisma.bom.findFirst({
      ...latestApprovedBomFindArgs(fgItemId),
      include: bomInclude,
    });
    if (!row) return res.status(404).json({ error: { message: "BOM not found" } });
    return res.json(await mapBomResponse(row));
  } catch (e) {
    return next(e);
  }
});

const updateBomSchema = headerSchema.extend({
  lines: z.array(lineSchema).min(1),
  adminPassword: z.string().optional(),
});

const createBomSchema = headerSchema.extend({
  fgItemId: z.number().int(),
  lines: z.array(lineSchema).min(1),
});

const reviseBomSchema = z.object({
  adminPassword: z.string().min(1),
});

bomRouter.put("/:id", requireAuth, requireRole(["ADMIN"], BOM_EDIT_FORBIDDEN), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = updateBomSchema.parse(req.body);
    const existing = await prisma.bom.findUnique({ where: { id } });
    if (!existing) {
      const err = new Error("BOM not found");
      err.statusCode = 404;
      throw err;
    }

    if (bomLooksLocked(existing)) {
      const err = new Error(APPROVED_EDIT_MESSAGE);
      err.statusCode = 400;
      throw err;
    }

    if (!bomIsDraft(existing)) {
      const err = new Error("Only draft BOM revisions can be edited.");
      err.statusCode = 400;
      throw err;
    }

    if (!ensureUniqueRm(body.lines)) {
      const err = new Error("Duplicate component item in BOM lines");
      err.statusCode = 400;
      throw err;
    }

    const header = normalizeBomHeaderInput(body);
    if (!header.effectiveFrom) {
      const err = new Error("Effective From is required.");
      err.statusCode = 400;
      throw err;
    }
    const updated = await prisma.$transaction(async (tx) => {
      await assertBomLinesValid(tx, existing.fgItemId, body.lines);
      await replaceBomLines(tx, id, body.lines, header);
      await tx.bom.update({
        where: { id },
        data: {
          ...header,
          normalizationMode: "PER_PIECE",
          status: BomStatus.DRAFT,
          isLocked: false,
          lockedAt: null,
        },
      });
      return tx.bom.findUnique({ where: { id }, include: bomInclude });
    });
    return res.json(await mapBomResponse(updated));
  } catch (e) {
    return next(e);
  }
});

bomRouter.post("/:id/revise", requireAuth, requireRole(["ADMIN"], BOM_EDIT_FORBIDDEN), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = reviseBomSchema.parse(req.body);
    const source = await prisma.bom.findUnique({ where: { id }, include: bomInclude });
    if (!source) {
      const err = new Error("BOM not found");
      err.statusCode = 404;
      throw err;
    }
    if (!bomLooksLocked(source)) {
      const err = new Error("Only approved BOMs can be revised. Edit the draft directly.");
      err.statusCode = 400;
      throw err;
    }

    await assertLockedBomAdminPassword(req, body.adminPassword);

    const created = await prisma.$transaction(async (tx) => {
      await assertNoDraftForFg(tx, source.fgItemId);
      const revisionNo = await nextRevisionNo(tx, source.fgItemId);
      const header = normalizeBomHeaderInput({
        fgWeight: source.fgWeight != null ? Number(source.fgWeight) : null,
        fgWeightUnitId: source.fgWeightUnitId,
        outputQty: Number(source.outputQty ?? 1),
        processLossPercent: Number(source.processLossPercent ?? 0),
        qcLossPercent: Number(source.qcLossPercent ?? 0),
        suggestedFgPlanningBufferPercent:
          source.suggestedFgPlanningBufferPercent != null
            ? Number(source.suggestedFgPlanningBufferPercent)
            : null,
        bomType: source.bomType,
        effectiveFrom: source.effectiveFrom,
        remarks: source.remarks,
      });

      const row = await tx.bom.create({
        data: {
          fgItemId: source.fgItemId,
          docNo: source.docNo,
          revisionNo,
          normalizationMode: "PER_PIECE",
          status: BomStatus.DRAFT,
          isLocked: false,
          lockedAt: null,
          approvedAt: null,
          ...header,
          lines: {
            create: (source.lines ?? []).map((ln) => {
              const l = normalizeBomLineInput(
                {
                  rmItemId: ln.rmItemId,
                  baseQty: Number(ln.baseQty),
                  notes: ln.notes,
                },
                header,
              );
              return {
                rmItemId: l.rmItemId,
                baseQty: String(l.baseQty),
                wastagePercent: String(l.wastagePercent),
                processLossPercent: String(l.processLossPercent),
                qcAllowancePercent: String(l.qcAllowancePercent),
                notes: l.notes,
              };
            }),
          },
        },
        include: bomInclude,
      });
      return row;
    });

    return res.status(201).json(await mapBomResponse(created));
  } catch (e) {
    if (e?.code === "ADMIN_PASSWORD_REQUIRED") {
      return res.status(e.statusCode === 401 ? 401 : 403).json({
        error: "ADMIN_PASSWORD_REQUIRED",
        message: e.statusCode === 401 ? "Invalid admin password" : ADMIN_PW_MESSAGE,
      });
    }
    return next(e);
  }
});

bomRouter.post("/:id/approve", requireAuth, requireRole(["ADMIN"], BOM_EDIT_FORBIDDEN), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.bom.findUnique({ where: { id }, include: bomInclude });
    if (!existing) {
      const err = new Error("BOM not found");
      err.statusCode = 404;
      throw err;
    }
    if (existing.status === BomStatus.APPROVED) {
      return res.json(await mapBomResponse(existing));
    }
    if (existing.status === BomStatus.INACTIVE) {
      const err = new Error("Inactive BOM cannot be approved. Create a new draft revision first.");
      err.statusCode = 400;
      throw err;
    }
    if (!bomIsDraft(existing)) {
      const err = new Error("Only draft BOM revisions can be approved.");
      err.statusCode = 400;
      throw err;
    }
    if (!existing.lines?.length) {
      const err = new Error("Add at least one component line before approval.");
      err.statusCode = 400;
      throw err;
    }

    const header = normalizeBomHeaderInput({
      fgWeight: existing.fgWeight != null ? Number(existing.fgWeight) : null,
      fgWeightUnitId: existing.fgWeightUnitId,
      outputQty: Number(existing.outputQty ?? 1),
      processLossPercent: Number(existing.processLossPercent ?? 0),
      qcLossPercent: Number(existing.qcLossPercent ?? 0),
      bomType: existing.bomType,
      effectiveFrom: existing.effectiveFrom,
      remarks: existing.remarks,
    });
    assertEffectiveFromForApproval(header);

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      await tx.bom.updateMany({
        where: {
          fgItemId: existing.fgItemId,
          status: BomStatus.APPROVED,
          id: { not: id },
        },
        data: {
          status: BomStatus.INACTIVE,
          isLocked: false,
          lockedAt: null,
        },
      });
      return tx.bom.update({
        where: { id },
        data: {
          status: BomStatus.APPROVED,
          isLocked: true,
          lockedAt: now,
          approvedAt: now,
          effectiveFrom: header.effectiveFrom,
        },
        include: bomInclude,
      });
    });
    const mapped = await mapBomResponse(updated);
    const approvalWarnings = mapped.componentSummary?.sfgWarnings ?? [];
    return res.json({
      ...mapped,
      approvalWarnings,
    });
  } catch (e) {
    return next(e);
  }
});

bomRouter.post("/:id/deactivate", requireAuth, requireRole(["ADMIN"], BOM_EDIT_FORBIDDEN), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.bom.findUnique({ where: { id } });
    if (!existing) {
      const err = new Error("BOM not found");
      err.statusCode = 404;
      throw err;
    }
    const updated = await prisma.bom.update({
      where: { id },
      data: { status: BomStatus.INACTIVE, isLocked: false },
      include: bomInclude,
    });
    return res.json(await mapBomResponse(updated));
  } catch (e) {
    return next(e);
  }
});

bomRouter.delete("/:id", requireAuth, requireRole(["ADMIN"], BOM_DELETE_FORBIDDEN), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bodyParsed = z
      .object({ adminPassword: z.string().optional() })
      .safeParse(req.body && typeof req.body === "object" ? req.body : {});
    const adminPassword = bodyParsed.success ? bodyParsed.data.adminPassword : undefined;

    const bom = await prisma.bom.findUnique({ where: { id } });
    if (!bom) {
      const err = new Error("BOM not found");
      err.statusCode = 404;
      throw err;
    }

    if (!bomIsDraft(bom)) {
      const err = new Error(BOM_IN_USE_MESSAGE);
      err.statusCode = 400;
      err.code = "BOM_IN_USE";
      throw err;
    }

    await prisma.bom.delete({ where: { id } });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

bomRouter.post("/", requireAuth, requireRole(["ADMIN"], BOM_CREATE_FORBIDDEN), async (req, res, next) => {
  try {
    const body = createBomSchema.parse(req.body);
    if (!ensureUniqueRm(body.lines)) {
      const err = new Error("Each raw material can only appear once on a BOM.");
      err.statusCode = 400;
      throw err;
    }

    const header = normalizeBomHeaderInput(body);
    if (!header.effectiveFrom) {
      const err = new Error("Effective From is required.");
      err.statusCode = 400;
      throw err;
    }
    const created = await prisma.$transaction(async (tx) => {
      await assertBomHeaderItem(tx, body.fgItemId);
      const blockingBom = await tx.bom.findFirst({
        where: {
          fgItemId: body.fgItemId,
          status: { in: [BomStatus.DRAFT, BomStatus.APPROVED] },
        },
        orderBy: [{ status: "asc" }, { revisionNo: "desc" }, { id: "desc" }],
        select: { id: true, status: true, revisionNo: true },
      });
      if (blockingBom) {
        console.warn(
          JSON.stringify({
            fgItemId: body.fgItemId,
            foundBomId: blockingBom.id,
            foundStatus: blockingBom.status,
            blockingReason:
              blockingBom.status === BomStatus.DRAFT
                ? "ACTIVE_DRAFT_EXISTS"
                : "ACTIVE_APPROVED_EXISTS",
          }),
        );
        const err = new Error(
          "An active BOM already exists for this item. Edit the draft or use Edit on approved BOM to create a new revision.",
        );
        err.statusCode = 409;
        throw err;
      }
      await assertBomLinesValid(tx, body.fgItemId, body.lines);
      const docNo = await allocateDocNo(tx, { docType: DocType.BOM, date: new Date() });
      const revisionNo = await nextRevisionNo(tx, body.fgItemId);
      const row = await tx.bom.create({
        data: {
          fgItemId: body.fgItemId,
          docNo,
          normalizationMode: "PER_PIECE",
          status: BomStatus.DRAFT,
          revisionNo,
          isLocked: false,
          lockedAt: null,
          approvedAt: null,
          ...header,
          lines: {
            create: body.lines.map((raw) => {
              const l = normalizeBomLineInput(raw, header);
              return {
                rmItemId: l.rmItemId,
                baseQty: String(l.baseQty),
                wastagePercent: String(l.wastagePercent),
                processLossPercent: String(l.processLossPercent),
                qcAllowancePercent: String(l.qcAllowancePercent),
                notes: l.notes,
              };
            }),
          },
        },
        include: bomInclude,
      });
      return row;
    });
    return res.status(201).json(await mapBomResponse(created));
  } catch (e) {
    if (e?.code === "P2002") {
      return res.status(409).json({
        error: "BOM_EXISTS",
        message: "BOM already exists for this item.",
      });
    }
    return next(e);
  }
});

module.exports = { bomRouter };
