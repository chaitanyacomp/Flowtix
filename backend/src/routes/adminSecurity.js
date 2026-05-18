const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { assertAdminPassword } = require("../services/adminPasswordAuth");

const adminSecurityRouter = express.Router();

adminSecurityRouter.post("/verify-password", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const body = z.object({ password: z.string().min(1) }).parse(req.body ?? {});
    try {
      await assertAdminPassword(prisma, { userId: req.user.userId, password: body.password });
      return res.json({ success: true });
    } catch {
      return res.json({ success: false });
    }
  } catch (e) {
    if (e?.name === "ZodError") return res.status(400).json({ success: false });
    return next(e);
  }
});

module.exports = { adminSecurityRouter };
