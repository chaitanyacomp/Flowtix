const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { listExportHistory } = require("../services/exportHistoryService");
const { parseStrictIsoDateBoundUtc, INVALID_MESSAGE } = require("../services/strictIsoDate");

const exportHistoryRouter = express.Router();

const EXPORT_HISTORY_ACCESS_DENIED = "Access denied. Only administrators and purchase staff can view export history.";
const exportHistoryRoles = requireRole(["ADMIN", "PURCHASE"], EXPORT_HISTORY_ACCESS_DENIED);

exportHistoryRouter.get("/", requireAuth, exportHistoryRoles, async (req, res, next) => {
  try {
    const query = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        customer: z.string().optional(),
        q: z.string().optional(),
      })
      .parse(req.query);

    const fromRaw = query.from ? String(query.from).trim() : "";
    const toRaw = query.to ? String(query.to).trim() : "";
    const from = fromRaw ? parseStrictIsoDateBoundUtc(fromRaw, "start") : null;
    const to = toRaw ? parseStrictIsoDateBoundUtc(toRaw, "end") : null;
    if (fromRaw && !from) {
      const err = new Error(INVALID_MESSAGE);
      err.statusCode = 400;
      throw err;
    }
    if (toRaw && !to) {
      const err = new Error(INVALID_MESSAGE);
      err.statusCode = 400;
      throw err;
    }
    if (from && to && from.getTime() > to.getTime()) {
      const err = new Error("from date must be on or before to date.");
      err.statusCode = 400;
      throw err;
    }

    const records = await listExportHistory({
      from,
      to,
      customerName: query.customer ? String(query.customer) : "",
      q: query.q ? String(query.q) : "",
    });
    return res.json({ records });
  } catch (e) {
    return next(e);
  }
});

module.exports = { exportHistoryRouter };

