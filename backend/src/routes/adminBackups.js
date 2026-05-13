const express = require("express");
const fs = require("fs");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { prisma } = require("../utils/prisma");
const { assertAdminPassword } = require("../services/adminPasswordAuth");
const { createManualBackup, toPublicBackup, getBackupForAdminOrThrow, deleteBackupById } = require("../services/databaseBackupService");
const { restoreFromBackup } = require("../services/databaseRestoreService");

const adminBackupsRouter = express.Router();

const createBodySchema = z
  .object({
    remarks: z.string().max(4000).optional(),
  })
  .strict();

const restoreBodySchema = z
  .object({
    adminPassword: z.string().min(1),
    confirmPhrase: z.string().min(1),
  })
  .strict();

adminBackupsRouter.get(
  "/backups",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can view backups."),
  async (req, res, next) => {
    try {
      const rows = await prisma.dbBackup.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { createdBy: { select: { id: true, name: true, email: true } } },
      });
      return res.json({ backups: rows.map(toPublicBackup) });
    } catch (e) {
      return next(e);
    }
  },
);

adminBackupsRouter.post(
  "/backups",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can create backups."),
  async (req, res, next) => {
    try {
      const body = createBodySchema.parse(req.body ?? {});
      const row = await createManualBackup({
        userId: req.user.userId,
        remarks: body.remarks,
      });
      return res.status(201).json({ backup: toPublicBackup(row) });
    } catch (e) {
      return next(e);
    }
  },
);

adminBackupsRouter.get(
  "/backups/:id/download",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can download backups."),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: { message: "Invalid backup id.", code: "INVALID_ID" } });
      }
      const row = await getBackupForAdminOrThrow(id);
      if (row.status !== "CREATED") {
        return res.status(400).json({ error: { message: "Only completed backups can be downloaded.", code: "NOT_DOWNLOADABLE" } });
      }
      try {
        await fs.promises.access(row.filePath, fs.constants.R_OK);
      } catch {
        return res.status(404).json({ error: { message: "Backup file is missing on disk.", code: "BACKUP_FILE_MISSING" } });
      }
      const asciiName = row.fileName.replace(/[^\x20-\x7E]/g, "_");
      res.setHeader("Content-Type", "application/sql; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${asciiName}"`);
      const stream = fs.createReadStream(row.filePath);
      stream.on("error", (err) => next(err));
      return stream.pipe(res);
    } catch (e) {
      return next(e);
    }
  },
);

adminBackupsRouter.delete(
  "/backups/:id",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can delete backups."),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: { message: "Invalid backup id.", code: "INVALID_ID" } });
      }
      await deleteBackupById(id);
      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  },
);

adminBackupsRouter.post(
  "/backups/:id/restore",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can restore backups."),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: { message: "Invalid backup id.", code: "INVALID_ID" } });
      }
      const body = restoreBodySchema.parse(req.body ?? {});
      if (body.confirmPhrase.trim().toUpperCase() !== "RESTORE") {
        return res.status(400).json({
          error: { message: 'Confirmation phrase must be RESTORE (all caps). No changes were made.', code: "CONFIRM_REQUIRED" },
        });
      }
      await assertAdminPassword(prisma, { userId: req.user.userId, password: body.adminPassword }).catch((e) => {
        if (e && e.statusCode === 401) {
          e.message = "The admin password entered is incorrect.";
        }
        throw e;
      });
      const result = await restoreFromBackup({ backupId: id, actingUserId: req.user.userId });
      return res.json(result);
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { adminBackupsRouter };
