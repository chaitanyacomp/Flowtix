const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const crypto = require("crypto");
const { requireAuth, requireRole } = require("../middleware/auth");
const { prisma } = require("../utils/prisma");
const {
  buildPreviewPayload,
  createPreviewSession,
  applyFromPreviewToken,
  MAX_XML_BYTES,
} = require("../services/tallyMasterImport/tallyMasterImportService");
const { decodeXmlFromBuffer } = require("../services/tallyMasterImport/parseTallyMastersXml");
const { Prisma } = require("../prismaClientPackage");

const tallyMasterImportRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_XML_BYTES, files: 1 },
});

const importOptionsSchema = z
  .object({
    defaultItemType: z.enum(["RM", "FG"]),
    fallbackStateId: z.number().int().positive().optional().nullable(),
    duplicateAction: z.enum(["SKIP", "UPDATE_EMPTY_FIELDS_ONLY"]).default("SKIP"),
    itemTypeFgKeywords: z.array(z.string().min(1).max(64)).max(64).optional(),
    itemTypeRmKeywords: z.array(z.string().min(1).max(64)).max(64).optional(),
  })
  .strict();

function newCorrelationId() {
  return crypto.randomUUID();
}

/**
 * Map apply/preview failures to actionable JSON (never a bare generic toast when we know the cause).
 */
function formatTallyImportHttpError(err, correlationId) {
  const code =
    (err && typeof err.code === "string" && err.code) ||
    (err instanceof Prisma.PrismaClientValidationError ? "TALLY_IMPORT_SCHEMA" : null) ||
    (err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null) ||
    "TALLY_IMPORT_FAILED";

  let message = err instanceof Error ? err.message : String(err || "Import failed.");
  let field = err?.field || null;
  let ledgerName = err?.ledgerName || err?.tallyName || null;
  let reason = err?.reason || null;

  if (err instanceof Prisma.PrismaClientValidationError || (err && err.code === "P2022")) {
    message =
      "Tally master import failed: database schema/Prisma client is missing Tally identity fields (tallyName / tallyGuid / tallyImportedAt). Apply migration 20260721180000_tally_master_identity, then run npx prisma generate, and retry Preview.";
    field = field || "Tally identity";
    reason = reason || "Schema mismatch";
  }

  // eslint-disable-next-line no-console
  console.error(`[tally-import][${correlationId}]`, { code, message, field, ledgerName, err });

  return {
    status: err?.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 400,
    body: {
      error: {
        message,
        code,
        field,
        ledgerName,
        reason,
        correlationId,
      },
    },
  };
}

tallyMasterImportRouter.post(
  "/tally-import/preview",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can import Tally masters."),
  upload.single("file"),
  async (req, res, next) => {
    const correlationId = newCorrelationId();
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          error: { message: "XML file is required (field name: file).", code: "FILE_REQUIRED", correlationId },
        });
      }
      let optionsRaw = {};
      const optField = req.body?.options ?? req.body?.optionsJson;
      if (typeof optField === "string" && optField.trim()) {
        try {
          optionsRaw = JSON.parse(optField);
        } catch {
          return res.status(400).json({
            error: { message: "Invalid options JSON.", code: "OPTIONS_INVALID", correlationId },
          });
        }
      } else if (req.body && typeof req.body === "object" && req.body.defaultItemType) {
        optionsRaw = {
          defaultItemType: req.body.defaultItemType,
          fallbackStateId: req.body.fallbackStateId,
          duplicateAction: req.body.duplicateAction,
        };
      }
      const options = importOptionsSchema.parse(optionsRaw);
      const xmlString = decodeXmlFromBuffer(req.file.buffer);
      const payload = await buildPreviewPayload(prisma, xmlString, options);
      if (!payload.ok) {
        return res.status(400).json({
          error: { message: payload.error || "Invalid XML.", code: "XML_PARSE", correlationId },
        });
      }
      const previewToken = createPreviewSession(xmlString, options);
      return res.json({
        previewToken,
        correlationId,
        warnings: payload.warnings,
        infoNotes: payload.infoNotes ?? [],
        blockingErrors: payload.blockingErrors ?? [],
        blockingErrorCount: payload.blockingErrorCount ?? 0,
        identityBackfillEligible: payload.identityBackfillEligible !== false,
        parsedMasterCounts: payload.parsedMasterCounts ?? null,
        summary: payload.summary,
        customers: payload.customers,
        suppliers: payload.suppliers,
        items: payload.items,
        units: payload.units,
        parseStats: payload.parseStats,
        runtime: payload.runtime ?? null,
        ...(payload.partyDiagnostics ? { partyDiagnostics: payload.partyDiagnostics } : {}),
      });
    } catch (e) {
      if (e instanceof z.ZodError) return next(e);
      const mapped = formatTallyImportHttpError(e, correlationId);
      return res.status(mapped.status).json(mapped.body);
    }
  },
);

const applyBodySchema = z
  .object({
    previewToken: z.string().min(10),
    confirm: z.literal(true),
    /** Per stock-item tally name → RM | FG (optional; defaults to preview row mapped type). */
    itemTypeOverrides: z
      .record(z.string(), z.enum(["RM", "FG"]))
      .optional()
      .refine((o) => o == null || Object.keys(o).length <= 50_000, { message: "Too many itemTypeOverrides keys." }),
  })
  .strict();

tallyMasterImportRouter.post(
  "/tally-import/apply",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can import Tally masters."),
  async (req, res, next) => {
    const correlationId = newCorrelationId();
    try {
      const body = applyBodySchema.parse(req.body ?? {});
      const result = await applyFromPreviewToken(prisma, body.previewToken, body.itemTypeOverrides ?? undefined);
      return res.json({ ...result, correlationId });
    } catch (e) {
      if (e instanceof z.ZodError) return next(e);
      const mapped = formatTallyImportHttpError(e, correlationId);
      return res.status(mapped.status).json(mapped.body);
    }
  },
);

tallyMasterImportRouter.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: {
          message: `XML file too large (max ${Math.round(MAX_XML_BYTES / (1024 * 1024))} MB).`,
          code: "FILE_TOO_LARGE",
        },
      });
    }
    return res.status(400).json({ error: { message: err.message, code: "UPLOAD_ERROR" } });
  }
  return next(err);
});

module.exports = { tallyMasterImportRouter };
