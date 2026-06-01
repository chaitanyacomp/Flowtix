const express = require("express");
const { z } = require("zod");
const { Prisma } = require("../prismaClientPackage");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  normalizeMasterNameDisplay,
  normalizeMasterNameKey,
} = require("../services/masterNameNormalize");
const {
  mapSupplierRow,
  supplierInclude,
  loadActiveStateById,
  assertGstinUnique,
  validateRegisteredGstin,
  validateSupplierLocations,
  syncSupplierLocations,
  getSupplierById,
} = require("../services/supplierMasterService");

const supplierRouter = express.Router();

const SUPPLIER_DELETE_BLOCKED = "Supplier is used in transactions and cannot be deleted.";
const DUPLICATE_SUPPLIER_NAME = "A supplier with this name already exists.";
const SUPPLIER_SAVE_FAILED = "Could not save supplier. Please check entered details.";
const SUPPLIER_NOT_FOUND = "Supplier not found.";
const SUPPLIER_READ_ACCESS_DENIED =
  "Access denied. Only Admin, Store, and Accounts roles can view suppliers.";
const supplierReadRoles = requireRole(["ADMIN", "STORE", "PURCHASE"], SUPPLIER_READ_ACCESS_DENIED);

const locationSchema = z.object({
  id: z.number().int().positive().optional(),
  label: z.string().min(1),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  stateId: z.number().int().positive().optional().nullable(),
  gst: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const supplierBodySchema = z.object({
  name: z.string().min(1).optional(),
  contact: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  gst: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  stateId: z.number().int().positive().optional().nullable(),
  isActive: z.boolean().optional(),
  locations: z.array(locationSchema).optional(),
});

async function supplierNameTakenByOther(displayName, excludeId) {
  const key = normalizeMasterNameKey(displayName);
  if (!key) return false;
  const others = await prisma.supplier.findMany({
    where: excludeId != null ? { NOT: { id: excludeId } } : {},
    select: { id: true, name: true },
  });
  return others.some((s) => normalizeMasterNameKey(s.name) === key);
}

async function supplierHasBlockingReferences(supplierId) {
  const rmPoCount = await prisma.rmPurchaseOrder.count({ where: { supplierId } });
  return rmPoCount > 0;
}

function trimNullableText(value) {
  if (value == null) return null;
  const t = String(value).trim();
  return t === "" ? null : t;
}

async function buildSupplierWritePayload(data, supplierIdForExclude, opts = {}) {
  const gstRaw = data.gstin !== undefined ? data.gstin : data.gst;
  const registered = await validateRegisteredGstin(gstRaw, data.stateId ?? null);

  const locations = opts.includeLocations
    ? await validateSupplierLocations(data.locations ?? [], supplierIdForExclude ?? null)
    : [];

  const excludeLocationIds = opts.includeLocations ? locations.map((a) => a.id).filter(Boolean) : [];
  await assertGstinUnique(registered.gst, {
    excludeSupplierId: supplierIdForExclude ?? null,
    excludeLocationIds,
  });

  let stateId = registered.stateId;
  let stateText = registered.state;
  let stateCode = registered.stateCode;
  if (!stateId && data.stateId != null) {
    const manualState = await loadActiveStateById(data.stateId);
    if (!manualState) {
      const err = new Error("Invalid state. Choose a valid state.");
      err.statusCode = 400;
      throw err;
    }
    stateId = manualState.id;
    stateText = manualState.stateName;
    stateCode = manualState.stateCode;
  }

  return {
    registered,
    stateId,
    stateText,
    stateCode,
    locations,
  };
}

supplierRouter.get("/", requireAuth, supplierReadRoles, async (req, res, next) => {
  try {
    const rows = await prisma.supplier.findMany({
      orderBy: { id: "desc" },
      include: {
        stateRef: { select: { id: true, stateName: true, stateCode: true } },
        locations: {
          where: { isActive: true },
          orderBy: [{ isDefault: "desc" }, { id: "asc" }],
          take: 1,
          select: { id: true, label: true, isDefault: true },
        },
        _count: { select: { locations: true } },
      },
    });
    return res.json(
      rows.map((r) => ({
        ...mapSupplierRow({ ...r, locations: r.locations }),
        locationCount: r._count.locations,
        defaultLocationLabel: r.locations[0]?.label ?? null,
      })),
    );
  } catch (e) {
    return next(e);
  }
});

supplierRouter.get("/:id", requireAuth, supplierReadRoles, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: { message: "Invalid supplier id" } });
    }
    const row = await getSupplierById(id);
    if (!row) {
      return res.status(404).json({ error: { message: SUPPLIER_NOT_FOUND } });
    }
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

supplierRouter.post("/", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const data = supplierBodySchema.parse(req.body);
    data.name = normalizeMasterNameDisplay(data.name ?? "");
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

    const { registered, stateId, stateText, stateCode, locations } = await buildSupplierWritePayload(data, null, {
      includeLocations: true,
    });

    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.create({
          data: {
            name: data.name,
            contact: trimNullableText(data.contact),
            email: trimNullableText(data.email),
            address: trimNullableText(data.address),
            gst: registered.gst,
            state: stateText,
            stateName: stateText,
            stateCode,
            stateId,
            isActive: data.isActive !== false,
          },
        });
        if (locations.length) {
          await syncSupplierLocations(tx, supplier.id, locations);
        }
        return tx.supplier.findUnique({
          where: { id: supplier.id },
          include: supplierInclude,
        });
      });
    } catch (prismaErr) {
      // eslint-disable-next-line no-console
      console.error("[suppliers] create failed:", prismaErr);
      if (prismaErr instanceof Prisma.PrismaClientKnownRequestError && prismaErr.code === "P2002") {
        return res.status(409).json({
          error: { message: DUPLICATE_SUPPLIER_NAME, code: "DUPLICATE" },
        });
      }
      return res.status(400).json({
        error: { message: SUPPLIER_SAVE_FAILED, code: "SAVE_FAILED" },
      });
    }
    return res.status(201).json(mapSupplierRow(created));
  } catch (e) {
    return next(e);
  }
});

supplierRouter.put("/:id", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = supplierBodySchema.parse(req.body);
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

    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: { message: SUPPLIER_NOT_FOUND } });
    }

    const gstRaw =
      data.gstin !== undefined || data.gst !== undefined
        ? data.gstin !== undefined
          ? data.gstin
          : data.gst
        : existing.gst;
    const stateIdInput = data.stateId !== undefined ? data.stateId : existing.stateId;
    const { registered, stateId, stateText, stateCode, locations } = await buildSupplierWritePayload(
      { ...data, gstin: gstRaw, stateId: stateIdInput, locations: data.locations },
      id,
      { includeLocations: data.locations !== undefined },
    );

    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        await tx.supplier.update({
          where: { id },
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.contact !== undefined ? { contact: trimNullableText(data.contact) } : {}),
            ...(data.email !== undefined ? { email: trimNullableText(data.email) } : {}),
            ...(data.address !== undefined ? { address: trimNullableText(data.address) } : {}),
            ...(data.gst !== undefined || data.gstin !== undefined ? { gst: registered.gst } : {}),
            ...(data.stateId !== undefined || data.gst !== undefined || data.gstin !== undefined
              ? { stateId, state: stateText, stateName: stateText, stateCode }
              : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive !== false } : {}),
          },
        });
        if (data.locations !== undefined) {
          await syncSupplierLocations(tx, id, locations);
        }
        return tx.supplier.findUnique({ where: { id }, include: supplierInclude });
      });
    } catch (prismaErr) {
      // eslint-disable-next-line no-console
      console.error("[suppliers] update failed:", prismaErr);
      if (prismaErr instanceof Prisma.PrismaClientKnownRequestError) {
        if (prismaErr.code === "P2025") {
          return res.status(404).json({ error: { message: SUPPLIER_NOT_FOUND } });
        }
        if (prismaErr.code === "P2002") {
          return res.status(409).json({ error: { message: DUPLICATE_SUPPLIER_NAME } });
        }
      }
      return res.status(400).json({ error: { message: SUPPLIER_SAVE_FAILED } });
    }
    return res.json(mapSupplierRow(updated));
  } catch (e) {
    return next(e);
  }
});

supplierRouter.delete("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: { message: "Invalid supplier id" } });
    }

    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: { message: SUPPLIER_NOT_FOUND } });
    }

    if (await supplierHasBlockingReferences(id)) {
      return res.status(409).json({ error: { message: SUPPLIER_DELETE_BLOCKED } });
    }

    try {
      await prisma.supplier.delete({ where: { id } });
    } catch (delErr) {
      if (delErr && delErr.code === "P2003") {
        return res.status(409).json({ error: { message: SUPPLIER_DELETE_BLOCKED } });
      }
      throw delErr;
    }

    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

module.exports = { supplierRouter };
