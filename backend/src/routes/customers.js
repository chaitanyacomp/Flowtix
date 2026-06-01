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
  mapCustomerRow,
  customerInclude,
  loadActiveStateById,
  assertGstinUnique,
  validateRegisteredGstin,
  validateDeliveryAddresses,
  syncDeliveryAddresses,
  getCustomerById,
} = require("../services/customerMasterService");

const customerRouter = express.Router();

const CUSTOMER_DUPLICATE_NAME = "A customer with this name already exists.";
const CUSTOMER_SAVE_FAILED = "Could not save customer. Please check entered details.";
const CUSTOMER_NOT_FOUND = "Customer not found.";
const CUSTOMER_READ_ACCESS_DENIED =
  "Access denied. Only administrators can view customers.";
const customerReadRoles = requireRole(["ADMIN"], CUSTOMER_READ_ACCESS_DENIED);

const deliveryAddressSchema = z.object({
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

const customerBodySchema = z.object({
  name: z.string().min(1).optional(),
  contact: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  gst: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  stateId: z.number().int().positive().optional().nullable(),
  isActive: z.boolean().optional(),
  deliveryAddresses: z.array(deliveryAddressSchema).optional(),
});

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

function trimNullableText(value) {
  if (value == null) return null;
  const t = String(value).trim();
  return t === "" ? null : t;
}

async function buildCustomerWritePayload(data, customerIdForExclude, opts = {}) {
  const gstRaw = data.gstin !== undefined ? data.gstin : data.gst;
  const registered = await validateRegisteredGstin(gstRaw, data.stateId ?? null);

  const deliveryAddresses = opts.includeDeliveryAddresses
    ? await validateDeliveryAddresses(data.deliveryAddresses ?? [], customerIdForExclude ?? null)
    : [];

  const excludeDeliveryAddressIds = opts.includeDeliveryAddresses
    ? deliveryAddresses.map((a) => a.id).filter(Boolean)
    : [];
  await assertGstinUnique(registered.gst, {
    excludeCustomerId: customerIdForExclude ?? null,
    excludeDeliveryAddressIds,
  });

  let stateId = registered.stateId;
  let stateText = registered.state;
  if (!stateId && data.stateId != null) {
    const manualState = await loadActiveStateById(data.stateId);
    if (!manualState) {
      const err = new Error("Invalid state. Choose a valid state.");
      err.statusCode = 400;
      throw err;
    }
    stateId = manualState.id;
    stateText = manualState.stateName;
  }

  return {
    registered,
    stateId,
    stateText,
    deliveryAddresses,
  };
}

customerRouter.get("/", requireAuth, customerReadRoles, async (req, res, next) => {
  try {
    const rows = await prisma.customer.findMany({
      orderBy: { id: "desc" },
      include: {
        stateRef: { select: { id: true, stateName: true, stateCode: true } },
        deliveryAddresses: {
          where: { isActive: true },
          orderBy: [{ isDefault: "desc" }, { id: "asc" }],
          take: 1,
          select: { id: true, label: true, isDefault: true },
        },
        _count: { select: { deliveryAddresses: true } },
      },
    });
    return res.json(
      rows.map((r) => ({
        ...mapCustomerRow({ ...r, deliveryAddresses: r.deliveryAddresses }),
        deliveryAddressCount: r._count.deliveryAddresses,
        defaultDeliveryLabel: r.deliveryAddresses[0]?.label ?? null,
      })),
    );
  } catch (e) {
    return next(e);
  }
});

customerRouter.get("/:id", requireAuth, customerReadRoles, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: { message: "Invalid customer id" } });
    }
    const row = await getCustomerById(id);
    if (!row) {
      return res.status(404).json({ error: { message: CUSTOMER_NOT_FOUND } });
    }
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

customerRouter.post("/", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const data = customerBodySchema.parse(req.body);
    data.name = normalizeMasterNameDisplay(data.name ?? "");
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

    const { registered, stateId, stateText, deliveryAddresses } = await buildCustomerWritePayload(data, null, {
      includeDeliveryAddresses: true,
    });

    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            name: data.name,
            contact: trimNullableText(data.contact),
            email: trimNullableText(data.email),
            address: trimNullableText(data.address),
            gst: registered.gst,
            state: stateText,
            stateId,
            isActive: data.isActive !== false,
          },
        });
        if (deliveryAddresses.length) {
          await syncDeliveryAddresses(tx, customer.id, deliveryAddresses);
        }
        return tx.customer.findUnique({
          where: { id: customer.id },
          include: customerInclude,
        });
      });
    } catch (prismaErr) {
      // eslint-disable-next-line no-console
      console.error("[customers] create failed:", prismaErr);
      if (prismaErr instanceof Prisma.PrismaClientKnownRequestError && prismaErr.code === "P2002") {
        return res.status(409).json({
          error: { message: CUSTOMER_DUPLICATE_NAME, code: "DUPLICATE" },
        });
      }
      return res.status(400).json({
        error: { message: CUSTOMER_SAVE_FAILED, code: "SAVE_FAILED" },
      });
    }
    return res.status(201).json(mapCustomerRow(created));
  } catch (e) {
    return next(e);
  }
});

customerRouter.put("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = customerBodySchema.parse(req.body);
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

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: { message: CUSTOMER_NOT_FOUND } });
    }

    const gstRaw =
      data.gstin !== undefined || data.gst !== undefined
        ? data.gstin !== undefined
          ? data.gstin
          : data.gst
        : existing.gst;
    const stateIdInput = data.stateId !== undefined ? data.stateId : existing.stateId;
    const { registered, stateId, stateText, deliveryAddresses } = await buildCustomerWritePayload(
      { ...data, gstin: gstRaw, stateId: stateIdInput, deliveryAddresses: data.deliveryAddresses },
      id,
      { includeDeliveryAddresses: data.deliveryAddresses !== undefined },
    );

    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        await tx.customer.update({
          where: { id },
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.contact !== undefined ? { contact: trimNullableText(data.contact) } : {}),
            ...(data.email !== undefined ? { email: trimNullableText(data.email) } : {}),
            ...(data.address !== undefined ? { address: trimNullableText(data.address) } : {}),
            ...(data.gst !== undefined || data.gstin !== undefined ? { gst: registered.gst } : {}),
            ...(data.stateId !== undefined || data.gst !== undefined || data.gstin !== undefined
              ? { stateId, state: stateText }
              : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive !== false } : {}),
          },
        });
        if (data.deliveryAddresses !== undefined) {
          await syncDeliveryAddresses(tx, id, deliveryAddresses);
        }
        return tx.customer.findUnique({ where: { id }, include: customerInclude });
      });
    } catch (prismaErr) {
      // eslint-disable-next-line no-console
      console.error("[customers] update failed:", prismaErr);
      if (prismaErr instanceof Prisma.PrismaClientKnownRequestError) {
        if (prismaErr.code === "P2025") {
          return res.status(404).json({ error: { message: CUSTOMER_NOT_FOUND } });
        }
        if (prismaErr.code === "P2002") {
          return res.status(409).json({ error: { message: CUSTOMER_DUPLICATE_NAME } });
        }
      }
      return res.status(400).json({ error: { message: CUSTOMER_SAVE_FAILED } });
    }
    return res.json(mapCustomerRow(updated));
  } catch (e) {
    return next(e);
  }
});

const CUSTOMER_IN_USE_MESSAGE = "Customer cannot be deleted because it is used in transactions.";

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
