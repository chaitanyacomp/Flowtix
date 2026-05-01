const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { listCustomerPosForTracking, getCustomerPoTrackingDetail } = require("../services/customerPoTrackingService");

const CUSTOMER_PO_TRACKING_ACCESS_DENIED =
  "Access denied. This screen is available to admin, sales, store, production, and QC roles.";

const trackingRoles = requireRole(
  ["ADMIN", "SALES", "STORE", "PRODUCTION", "QC"],
  CUSTOMER_PO_TRACKING_ACCESS_DENIED,
);

const customerPoTrackingRouter = express.Router();

/**
 * GET /api/customer-po-tracking
 * Customer-first listing: rows are **sales orders** (NORMAL + REPLACEMENT; NO_QTY excluded) for the customer,
 * with optional Customer PO metadata when linked. Query param `poKey` / detail route key = **salesOrderId**
 * (legacy: customer PO id still resolves when that PO is linked to an SO).
 */
customerPoTrackingRouter.get("/", requireAuth, trackingRoles, async (req, res, next) => {
  try {
    const q = z
      .object({
        customerId: z.string().optional(),
        poSearch: z.string().optional(),
        status: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.string().optional(),
      })
      .passthrough()
      .parse(req.query);

    const payload = await listCustomerPosForTracking(prisma, q);
    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/customer-po-tracking/:poKey
 * Full tracking for one **sales order** (`poKey` = salesOrderId), or legacy customer PO id when linked to an SO.
 */
customerPoTrackingRouter.get("/:poKey", requireAuth, trackingRoles, async (req, res, next) => {
  try {
    const poKey = Number(req.params.poKey);
    const payload = await getCustomerPoTrackingDetail(prisma, poKey);
    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

module.exports = { customerPoTrackingRouter, CUSTOMER_PO_TRACKING_ACCESS_DENIED };

