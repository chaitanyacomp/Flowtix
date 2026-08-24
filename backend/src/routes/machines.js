const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  MACHINE_TYPES,
  listMachines,
  getMachineById,
  createMachine,
  updateMachine,
} = require("../services/machineService");

const machinesRouter = express.Router();

const machineTypeSchema = z.enum(MACHINE_TYPES);

const createBodySchema = z.object({
  machineCode: z.string().min(1).max(32),
  machineName: z.string().min(1).max(120),
  machineType: machineTypeSchema,
  make: z.string().max(120).optional().nullable(),
  model: z.string().max(120).optional().nullable(),
  serialNumber: z.string().max(120).optional().nullable(),
  departmentLocation: z.string().max(120).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
});

const updateBodySchema = z.object({
  machineCode: z.string().min(1).max(32).optional(),
  machineName: z.string().min(1).max(120).optional(),
  machineType: machineTypeSchema.optional(),
  make: z.string().max(120).optional().nullable(),
  model: z.string().max(120).optional().nullable(),
  serialNumber: z.string().max(120).optional().nullable(),
  departmentLocation: z.string().max(120).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

/** Production master — readable by ops roles that use machines (Shift Production includes PRODUCTION_MANAGER). */
const READ_ROLES = ["ADMIN", "PRODUCTION", "PRODUCTION_MANAGER", "STORE"];
/** Maintain like other production masters (ADMIN); PRODUCTION may also maintain. */
const WRITE_ROLES = ["ADMIN", "PRODUCTION"];

machinesRouter.get("/", requireAuth, requireRole(READ_ROLES), async (req, res, next) => {
  try {
    const includeInactive =
      String(req.query.includeInactive ?? "") === "1" || req.query.includeInactive === "true";
    const rows = await listMachines(prisma, { includeInactive });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

machinesRouter.get("/:id", requireAuth, requireRole(READ_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await getMachineById(prisma, id);
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

machinesRouter.post("/", requireAuth, requireRole(WRITE_ROLES), async (req, res, next) => {
  try {
    const body = createBodySchema.parse(req.body ?? {});
    const row = await createMachine(prisma, body);
    return res.status(201).json(row);
  } catch (e) {
    return next(e);
  }
});

machinesRouter.patch("/:id", requireAuth, requireRole(WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = updateBodySchema.parse(req.body ?? {});
    const row = await updateMachine(prisma, id, body);
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

const materialStateBodySchema = z.object({
  materialState: z.enum(["RETAINED", "CLEARED", "UNKNOWN"]),
  profileFingerprint: z.string().max(64).optional().nullable(),
  profileJson: z.any().optional().nullable(),
  sourceWorkOrderId: z.number().int().positive().optional().nullable(),
  sourceRunAllocationId: z.number().int().positive().optional().nullable(),
});

machinesRouter.get(
  "/:id/material-state",
  requireAuth,
  requireRole(READ_ROLES),
  async (req, res, next) => {
    try {
      const { loadMachineMaterialState } = require("../services/machineMaterialStateService");
      const id = Number(req.params.id);
      const state = await loadMachineMaterialState(prisma, id);
      return res.json(state);
    } catch (e) {
      return next(e);
    }
  },
);

machinesRouter.post(
  "/:id/material-state/confirm",
  requireAuth,
  requireRole(WRITE_ROLES),
  async (req, res, next) => {
    try {
      const { confirmMachineMaterialState } = require("../services/machineMaterialStateService");
      const id = Number(req.params.id);
      const body = materialStateBodySchema.parse(req.body ?? {});
      const row = await confirmMachineMaterialState(prisma, {
        machineId: id,
        materialState: body.materialState,
        profileFingerprint: body.profileFingerprint ?? null,
        profileJson: body.profileJson ?? null,
        sourceWorkOrderId: body.sourceWorkOrderId ?? null,
        sourceRunAllocationId: body.sourceRunAllocationId ?? null,
        confirmedByUserId: req.user?.userId ?? null,
      });
      return res.json(row);
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { machinesRouter, READ_ROLES, WRITE_ROLES };
