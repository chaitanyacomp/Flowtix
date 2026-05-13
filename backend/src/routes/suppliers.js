const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  normalizeMasterNameDisplay,
  normalizeMasterNameKey,
} = require("../services/masterNameNormalize");
const { normalizeGstinOnSave } = require("../services/gstinNormalize");

const SUPPLIER_DELETE_BLOCKED = "Supplier is used in transactions and cannot be deleted.";
const DUPLICATE_SUPPLIER_NAME = "A supplier with this name already exists.";
const SUPPLIER_READ_ACCESS_DENIED = "Access denied. Only Admin and Store roles can view suppliers.";
const supplierReadRoles = requireRole(["ADMIN", "STORE", "ACCOUNTS"], SUPPLIER_READ_ACCESS_DENIED);

const supplierRouter = express.Router();

/** Returns true if another supplier has the same normalized name (case-insensitive, spaces collapsed). */
async function supplierNameTakenByOther(displayName, excludeId) {
  const target = normalizeMasterNameKey(displayName);
  if (!target) return false;
  const others = await prisma.supplier.findMany({
    where: excludeId != null ? { NOT: { id: excludeId } } : {},
    select: { id: true, name: true },
  });
  return others.some((s) => normalizeMasterNameKey(s.name) === target);
}

async function supplierHasBlockingReferences(supplierId) {
  const rmPoCount = await prisma.rmPurchaseOrder.count({ where: { supplierId } });
  return rmPoCount > 0;
}

supplierRouter.get("/", requireAuth, supplierReadRoles, async (req, res, next) => {
  try {
    const rows = await prisma.supplier.findMany({
      orderBy: { id: "desc" },
      include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } },
    });
    return res.json(
      rows.map((r) => ({
        ...r,
        gstin: r.gst ?? null,
        stateId: r.stateId ?? null,
        stateName: r.stateRef?.stateName ?? null,
        stateCode: r.stateRef?.stateCode ?? null,
      })),
    );
  } catch (e) {
    return next(e);
  }
});

supplierRouter.post("/", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      contact: z.string().optional(),
      email: z.string().email().optional(),
      address: z.string().optional().nullable(),
      gst: z.string().optional().nullable(),
      gstin: z.string().optional().nullable(),
      stateId: z.number().int().positive(),
    });
    const data = schema.parse(req.body);
    data.name = normalizeMasterNameDisplay(data.name);
    if (!data.name) {
      const err = new Error("Name is required");
      err.statusCode = 400;
      throw err;
    }
    if (await supplierNameTakenByOther(data.name, null)) {
      const err = new Error(DUPLICATE_SUPPLIER_NAME);
      err.statusCode = 409;
      throw err;
    }
    const gstRaw = data.gstin !== undefined ? data.gstin : data.gst;
    const gstNorm = normalizeGstinOnSave(gstRaw);

    const state = await prisma.state.findUnique({
      where: { id: data.stateId },
      select: { id: true, stateName: true, stateCode: true, isActive: true },
    });
    if (!state || !state.isActive) {
      const err = new Error("Invalid state. Choose a valid state.");
      err.statusCode = 400;
      throw err;
    }
    if (data.address != null) {
      const t = String(data.address).trim();
      data.address = t === "" ? null : t;
    }
    const created = await prisma.supplier.create({
      data: {
        name: data.name,
        contact: data.contact,
        email: data.email,
        address: data.address,
        gst: gstNorm,
        state: state.stateName,
        stateName: state.stateName,
        stateCode: state.stateCode,
        stateId: state.id,
      },
      include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } },
    });
    return res.status(201).json({
      ...created,
      gstin: created.gst ?? null,
      stateId: created.stateId ?? null,
      stateName: created.stateName ?? created.stateRef?.stateName ?? null,
      stateCode: created.stateCode ?? created.stateRef?.stateCode ?? null,
    });
  } catch (e) {
    return next(e);
  }
});

supplierRouter.put("/:id", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      name: z.string().min(1).optional(),
      contact: z.string().optional().nullable(),
      email: z.string().email().optional().nullable(),
      address: z.string().optional().nullable(),
      gst: z.string().optional().nullable(),
      gstin: z.string().optional().nullable(),
      stateId: z.number().int().positive().optional().nullable(),
    });
    const data = schema.parse(req.body);
    if (data.name !== undefined) {
      data.name = normalizeMasterNameDisplay(data.name);
      if (!data.name) {
        const err = new Error("Name is required");
        err.statusCode = 400;
        throw err;
      }
      if (await supplierNameTakenByOther(data.name, id)) {
        const err = new Error(DUPLICATE_SUPPLIER_NAME);
        err.statusCode = 409;
        throw err;
      }
    }
    const gstRaw = data.gstin !== undefined ? data.gstin : data.gst;
    const gstNorm = gstRaw !== undefined ? normalizeGstinOnSave(gstRaw) : undefined;

    let statePatch = {};
    if (data.stateId !== undefined) {
      if (data.stateId == null) {
        // Keep backward compatibility: allow clearing link; also clear legacy text fields.
        statePatch = { stateId: null, state: null, stateName: null, stateCode: null };
      } else {
        const state = await prisma.state.findUnique({
          where: { id: data.stateId },
          select: { id: true, stateName: true, stateCode: true, isActive: true },
        });
        if (!state || !state.isActive) {
          const err = new Error("Invalid state. Choose a valid state.");
          err.statusCode = 400;
          throw err;
        }
        statePatch = { stateId: state.id, state: state.stateName, stateName: state.stateName, stateCode: state.stateCode };
      }
    }
    if (data.address !== undefined && data.address != null) {
      const t = String(data.address).trim();
      data.address = t === "" ? null : t;
    }
    const updated = await prisma.supplier.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.contact !== undefined ? { contact: data.contact } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(gstNorm !== undefined ? { gst: gstNorm } : {}),
        ...statePatch,
      },
      include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } },
    });
    return res.json({
      ...updated,
      gstin: updated.gst ?? null,
      stateId: updated.stateId ?? null,
      stateName: updated.stateName ?? updated.stateRef?.stateName ?? null,
      stateCode: updated.stateCode ?? updated.stateRef?.stateCode ?? null,
    });
  } catch (e) {
    return next(e);
  }
});

supplierRouter.delete("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) {
      const err = new Error("Supplier not found");
      err.statusCode = 404;
      throw err;
    }

    if (await supplierHasBlockingReferences(id)) {
      const err = new Error(SUPPLIER_DELETE_BLOCKED);
      err.statusCode = 409;
      throw err;
    }

    try {
      await prisma.supplier.delete({ where: { id } });
    } catch (delErr) {
      if (delErr && delErr.code === "P2003") {
        const err = new Error(SUPPLIER_DELETE_BLOCKED);
        err.statusCode = 409;
        throw err;
      }
      throw delErr;
    }

    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

module.exports = { supplierRouter };
