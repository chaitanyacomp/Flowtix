const express = require("express");
const { requireAuth } = require("../middleware/auth");

const searchRouter = express.Router();

/**
 * GET /api/search?q=...
 * Global search is not implemented yet; this route exists so the app can boot
 * and authenticated clients receive a stable JSON shape instead of a missing router.
 */
searchRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    return res.json({ q, results: [] });
  } catch (e) {
    return next(e);
  }
});

module.exports = { searchRouter };
