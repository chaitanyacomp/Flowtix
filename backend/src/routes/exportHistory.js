const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { listExportHistory } = require("../services/exportHistoryService");

const exportHistoryRouter = express.Router();

const EXPORT_HISTORY_ACCESS_DENIED = "Access denied. Only administrators and sales staff can view export history.";
const exportHistoryRoles = requireRole(["ADMIN", "SALES"], EXPORT_HISTORY_ACCESS_DENIED);

function parseYmdStartUtc(ymd) {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const t = Date.parse(`${ymd}T00:00:00.000Z`);
  return Number.isNaN(t) ? null : new Date(t);
}

function parseYmdEndUtc(ymd) {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const t = Date.parse(`${ymd}T23:59:59.999Z`);
  return Number.isNaN(t) ? null : new Date(t);
}

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

    const from = query.from ? parseYmdStartUtc(String(query.from).trim()) : null;
    const to = query.to ? parseYmdEndUtc(String(query.to).trim()) : null;
    if (query.from && !from) {
      const err = new Error("Invalid from date; use YYYY-MM-DD.");
      err.statusCode = 400;
      throw err;
    }
    if (query.to && !to) {
      const err = new Error("Invalid to date; use YYYY-MM-DD.");
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

