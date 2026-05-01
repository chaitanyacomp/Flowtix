const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");

const { prisma } = require("../utils/prisma");
const { signAccessToken } = require("../utils/jwt");
const { requireAuth } = require("../middleware/auth");
const auditLog = require("../services/auditLog");

const authRouter = express.Router();

/** Safe for audit logs: no passwords, no full tokens. */
function maskEmailForAudit(email) {
  const e = String(email ?? "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at <= 1 || at >= e.length - 1) return "[unavailable]";
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const maskedLocal = local.length <= 2 ? "***" : `${local[0]}***`;
  return `${maskedLocal}@${domain}`;
}

function sessionAuditMeta(req) {
  const rawIp = req.ip || req.socket?.remoteAddress || "";
  const ip = typeof rawIp === "string" ? rawIp.slice(0, 45) : "";
  const ua = (req.get("user-agent") || "").slice(0, 256);
  return { ipAddress: ip || undefined, userAgent: ua || undefined };
}

/**
 * Never throws to callers — auth responses must not depend on audit durability.
 * @param {Parameters<typeof auditLog.write>[1]} input
 */
async function trySessionAudit(input) {
  try {
    await auditLog.write(prisma, input);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("session audit write failed:", err?.message || err);
  }
}

authRouter.post("/login", async (req, res, next) => {
  const meta = sessionAuditMeta(req);
  try {
    const bodySchema = z.object({
      email: z.string().min(1),
      password: z.string().min(1),
    });
    const parsed = bodySchema.parse(req.body);
    const email = parsed.email.trim().toLowerCase();
    const password = parsed.password;
    const emailOk = z.string().email().safeParse(email);
    if (!emailOk.success) {
      await trySessionAudit({
        action: auditLog.AuditAction.LOGIN_FAILED,
        entityType: auditLog.AuditEntityType.USER_SESSION,
        summary: "Sign-in failed (invalid email format)",
        payload: { identifierMasked: maskEmailForAudit(parsed.email) },
        ...meta,
      });
      return res.status(400).json({ error: { message: "Invalid email format" } });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await trySessionAudit({
        action: auditLog.AuditAction.LOGIN_FAILED,
        entityType: auditLog.AuditEntityType.USER_SESSION,
        summary: "Sign-in failed (unknown account)",
        payload: { identifierMasked: maskEmailForAudit(email), code: "USER_NOT_FOUND" },
        ...meta,
      });
      return res.status(401).json({ error: { message: "Invalid email or password" } });
    }
    if (!user.isActive) {
      await trySessionAudit({
        action: auditLog.AuditAction.LOGIN_FAILED,
        entityType: auditLog.AuditEntityType.USER_SESSION,
        summary: "Sign-in failed (account disabled)",
        payload: { identifierMasked: maskEmailForAudit(email), code: "ACCOUNT_DISABLED" },
        actorUserId: user.id,
        actorRole: user.role,
        ...meta,
      });
      return res.status(401).json({ error: { message: "Account is disabled" } });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await trySessionAudit({
        action: auditLog.AuditAction.LOGIN_FAILED,
        entityType: auditLog.AuditEntityType.USER_SESSION,
        summary: "Sign-in failed (invalid credentials)",
        payload: { identifierMasked: maskEmailForAudit(email), code: "INVALID_CREDENTIALS" },
        actorUserId: user.id,
        actorRole: user.role,
        ...meta,
      });
      return res.status(401).json({ error: { message: "Invalid email or password" } });
    }

    const token = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    await trySessionAudit({
      action: auditLog.AuditAction.LOGIN,
      entityType: auditLog.AuditEntityType.USER_SESSION,
      summary: `Signed in (user #${user.id})`,
      payload: { userId: user.id },
      actorUserId: user.id,
      actorRole: user.role,
      ...meta,
    });

    return res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return res.status(400).json({ error: { message: "Invalid request body" } });
    }
    return next(err);
  }
});

/**
 * Records explicit logout for audit (JWT is stateless; client should clear token after this).
 */
authRouter.post("/logout", requireAuth, async (req, res) => {
  const meta = sessionAuditMeta(req);
  await trySessionAudit({
    action: auditLog.AuditAction.LOGOUT,
    entityType: auditLog.AuditEntityType.USER_SESSION,
    summary: `Signed out (user #${req.user.userId})`,
    payload: { userId: req.user.userId },
    actorUserId: req.user.userId,
    actorRole: req.user.role,
    ...meta,
  });
  return res.status(204).send();
});

module.exports = { authRouter };
