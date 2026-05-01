const express = require("express");
const { z } = require("zod");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  normalizeMasterNameDisplay,
  normalizeMasterNameKey,
} = require("../services/masterNameNormalize");
const { normalizeGstinOnSave } = require("../services/gstinNormalize");

const customerRouter = express.Router();

const CUSTOMER_DUPLICATE_NAME = "A customer with this name already exists.";
const CUSTOMER_SAVE_FAILED =
  "Could not save customer. Please check entered details.";
const CUSTOMER_NOT_FOUND = "Customer not found.";
const CUSTOMER_READ_ACCESS_DENIED = "Access denied. Only Admin and Sales roles can view customers.";
const customerReadRoles = requireRole(["ADMIN", "SALES"], CUSTOMER_READ_ACCESS_DENIED);

/** @param {string} displayName @param {number | null} excludeId */
async function customerNameTakenByOther(displayName, excludeId) {
  const key = normalizeMasterNameKey(displayName);
  if (!key) return false;
  const others = await prisma.customer.findMany({
    where: excludeId != null ? { NOT: { id: excludeId } } : {},
    select: { id: true, name: true },
  });
  return others.some((c) => normalizeMasterNameKey(c.name) === key);
}

customerRouter.get("/", requireAuth, customerReadRoles, async (req, res, next) => {
  try {
    const rows = await prisma.customer.findMany({
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

customerRouter.post("/", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      contact: z.string().optional(),
      email: z.string().email().optional(),
      address: z.string().optional().nullable(),
      gst: z.string().optional().nullable(),
      state: z.string().optional().nullable(),
      stateId: z.number().int().positive().optional().nullable(),
    });
    const data = schema.parse(req.body);
    data.name = normalizeMasterNameDisplay(data.name);
    if (!data.name) {
      const err = new Error("Name is required");
      err.statusCode = 400;
      throw err;
    }
    if (await customerNameTakenByOther(data.name, null)) {
      const err = new Error(CUSTOMER_DUPLICATE_NAME);
      err.statusCode = 400;
      throw err;
    }
    if (data.gst !== undefined) data.gst = normalizeGstinOnSave(data.gst);
    if (data.state != null) {
      const t = String(data.state).trim();
      data.state = t === "" ? null : t.slice(0, 128);
    }
    if (data.address != null) {
      const t = String(data.address).trim();
      data.address = t === "" ? null : t;
    }
    let created;
    try {
      created = await prisma.customer.create({
        data: {
          name: data.name,
          contact: data.contact,
          email: data.email,
          address: data.address,
          gst: data.gst,
          state: data.state,
          stateId: data.stateId ?? null,
        },
        include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } },
      });
    } catch (prismaErr) {
      // eslint-disable-next-line no-console
      console.error("[customers] create failed:", prismaErr);
      if (prismaErr instanceof Prisma.PrismaClientKnownRequestError) {
        if (prismaErr.code === "P2002") {
          return res.status(409).json({
            error: { message: CUSTOMER_DUPLICATE_NAME, code: "DUPLICATE" },
          });
        }
      }
      return res.status(400).json({
        error: { message: CUSTOMER_SAVE_FAILED, code: "SAVE_FAILED" },
      });
    }
    return res.status(201).json({
      ...created,
      gstin: created.gst ?? null,
      stateId: created.stateId ?? null,
      stateName: created.stateRef?.stateName ?? null,
      stateCode: created.stateRef?.stateCode ?? null,
    });
  } catch (e) {
    return next(e);
  }
});

customerRouter.put("/:id", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      name: z.string().min(1).optional(),
      contact: z.string().optional().nullable(),
      email: z.string().email().optional().nullable(),
      address: z.string().optional().nullable(),
      gst: z.string().optional().nullable(),
      state: z.string().optional().nullable(),
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
      if (await customerNameTakenByOther(data.name, id)) {
        const err = new Error(CUSTOMER_DUPLICATE_NAME);
        err.statusCode = 400;
        throw err;
      }
    }
    if (data.gst !== undefined) data.gst = normalizeGstinOnSave(data.gst);
    if (data.state !== undefined && data.state != null) {
      const t = String(data.state).trim();
      data.state = t === "" ? null : t.slice(0, 128);
    }
    if (data.address !== undefined && data.address != null) {
      const t = String(data.address).trim();
      data.address = t === "" ? null : t;
    }
    let updated;
    try {
      updated = await prisma.customer.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.contact !== undefined ? { contact: data.contact } : {}),
          ...(data.email !== undefined ? { email: data.email } : {}),
          ...(data.address !== undefined ? { address: data.address } : {}),
          ...(data.gst !== undefined ? { gst: data.gst } : {}),
          ...(data.state !== undefined ? { state: data.state } : {}),
          ...(data.stateId !== undefined ? { stateId: data.stateId } : {}),
        },
        include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } },
      });
    } catch (prismaErr) {
      // eslint-disable-next-line no-console
      console.error("[customers] update failed:", prismaErr);
      if (prismaErr instanceof Prisma.PrismaClientKnownRequestError) {
        if (prismaErr.code === "P2025") {
          return res.status(404).json({
            error: { message: CUSTOMER_NOT_FOUND, code: "NOT_FOUND" },
          });
        }
        if (prismaErr.code === "P2002") {
          return res.status(409).json({
            error: { message: CUSTOMER_DUPLICATE_NAME, code: "DUPLICATE" },
          });
        }
      }
      return res.status(400).json({
        error: { message: CUSTOMER_SAVE_FAILED, code: "SAVE_FAILED" },
      });
    }
    return res.json({
      ...updated,
      gstin: updated.gst ?? null,
      stateId: updated.stateId ?? null,
      stateName: updated.stateRef?.stateName ?? null,
      stateCode: updated.stateRef?.stateCode ?? null,
    });
  } catch (e) {
    return next(e);
  }
});

const CUSTOMER_IN_USE_MESSAGE =
  "Customer cannot be deleted because it is used in transactions.";

customerRouter.delete("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: { message: "Invalid customer id" } });
    }

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: { message: "Customer not found" } });
    }

    const [enquiryCount, poCount, salesOrderCount] = await Promise.all([
      prisma.enquiry.count({ where: { customerId: id } }),
      prisma.customerPO.count({ where: { customerId: id } }),
      prisma.salesOrder.count({ where: { customerId: id } }),
    ]);

    if (enquiryCount > 0 || poCount > 0 || salesOrderCount > 0) {
      return res.status(409).json({
        error: { message: CUSTOMER_IN_USE_MESSAGE },
      });
    }

    await prisma.customer.delete({ where: { id } });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

module.exports = { customerRouter };

