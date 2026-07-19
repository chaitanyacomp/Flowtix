const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const adminUserService = require("../services/adminUserService");

const adminUsersRouter = express.Router();

const ROLE_ENUM = z.enum(["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "QA"]);

function requestAuditMeta(req) {
  const rawIp = req.ip || req.socket?.remoteAddress || "";
  const ip = typeof rawIp === "string" ? rawIp.slice(0, 45) : "";
  const ua = (req.get("user-agent") || "").slice(0, 256);
  return { ipAddress: ip || undefined, userAgent: ua || undefined };
}

function parseUserId(param) {
  const id = Number(param);
  if (!Number.isInteger(id) || id < 1) return null;
  return id;
}

adminUsersRouter.get(
  "/users",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can manage users."),
  async (req, res, next) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const roleRaw = typeof req.query.role === "string" ? req.query.role.trim().toUpperCase() : "";
      const role = roleRaw || undefined;

      let active;
      if (req.query.active === "true" || req.query.active === "1") active = true;
      else if (req.query.active === "false" || req.query.active === "0") active = false;

      const users = await adminUserService.listUsers({ q, role, active });
      return res.json({ users });
    } catch (e) {
      return next(e);
    }
  },
);

adminUsersRouter.post(
  "/users",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can manage users."),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          email: z.string().email(),
          name: z.string().min(1).max(200),
          role: ROLE_ENUM,
          password: z.string().min(6).max(200),
          isActive: z.boolean().optional(),
        })
        .strict()
        .parse(req.body ?? {});

      const meta = requestAuditMeta(req);
      const user = await adminUserService.createUser({
        ...body,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        ...meta,
      });
      return res.status(201).json({ user });
    } catch (e) {
      return next(e);
    }
  },
);

adminUsersRouter.patch(
  "/users/:id",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can manage users."),
  async (req, res, next) => {
    try {
      const userId = parseUserId(req.params.id);
      if (userId == null) {
        return res.status(400).json({ error: { message: "Invalid user id.", code: "INVALID_ID" } });
      }

      const body = z
        .object({
          name: z.string().min(1).max(200).optional(),
          role: ROLE_ENUM.optional(),
          isActive: z.boolean().optional(),
        })
        .strict()
        .parse(req.body ?? {});

      const meta = requestAuditMeta(req);
      const user = await adminUserService.updateUser({
        userId,
        patch: body,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        ...meta,
      });
      return res.json({ user });
    } catch (e) {
      return next(e);
    }
  },
);

adminUsersRouter.post(
  "/users/:id/reset-password",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can manage users."),
  async (req, res, next) => {
    try {
      const userId = parseUserId(req.params.id);
      if (userId == null) {
        return res.status(400).json({ error: { message: "Invalid user id.", code: "INVALID_ID" } });
      }

      const body = z
        .object({
          password: z.string().min(6).max(200),
        })
        .strict()
        .parse(req.body ?? {});

      const meta = requestAuditMeta(req);
      const result = await adminUserService.resetPassword({
        userId,
        password: body.password,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        ...meta,
      });
      return res.json(result);
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { adminUsersRouter };
