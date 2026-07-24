const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const crypto = require("crypto");
const { requireAuth, requireRole } = require("../middleware/auth");
const { prisma } = require("../utils/prisma");
const {
  buildPreviewPayload,
  createPreviewSession,
  rebuildPreviewFromToken,
  applyFromPreviewToken,
  MAX_XML_BYTES,
  IMPORT_BATCH_SIZE,
  fingerprintXmlText,
  TALLY_APPLY_JSON_LIMIT,
} = require("../services/tallyMasterImport/tallyMasterImportService");
const { prepareAndParseTallyXmlInWorker } = require("../services/tallyMasterImport/tallyXmlParseWorkerHost");
const {
  beginOperation,
  updateOperation,
  endOperation,
  getOperation,
} = require("../services/tallyMasterImport/tallyImportOperationGuard");
const { Prisma } = require("../prismaClientPackage");

const tallyMasterImportRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_XML_BYTES, files: 1 },
});

const mappingChoiceSchema = z.enum(["RM", "FG", "SFG", "CONSUMABLE", "PACKING", "SCRAP", "EXCLUDE", "SEMI_FINISHED"]);

const importOptionsSchema = z
  .object({
    defaultItemType: z.enum(["RM", "FG"]),
    fallbackStateId: z.number().int().positive().optional().nullable(),
    duplicateAction: z.enum(["SKIP", "UPDATE_EMPTY_FIELDS_ONLY"]).default("SKIP"),
    itemTypeFgKeywords: z.array(z.string().min(1).max(64)).max(64).optional(),
    itemTypeRmKeywords: z.array(z.string().min(1).max(64)).max(64).optional(),
    groupTypeOverrides: z.record(z.string(), mappingChoiceSchema).optional(),
    unitMapOverrides: z.record(z.string(), z.string().nullable()).optional(),
    sourceFilename: z.string().max(255).optional().nullable(),
    clientOperationId: z.string().min(8).max(128).optional().nullable(),
  })
  .strict();

function newCorrelationId() {
  return crypto.randomUUID();
}

function readClientOperationId(req, bodyField) {
  const header = req.get("x-tally-import-operation-id") || req.get("X-Tally-Import-Operation-Id");
  if (header && String(header).trim()) return String(header).trim().slice(0, 128);
  if (bodyField && String(bodyField).trim()) return String(bodyField).trim().slice(0, 128);
  return null;
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

tallyMasterImportRouter.get(
  "/tally-import/operations/:operationId",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can import Tally masters."),
  (req, res) => {
    const op = getOperation(req.params.operationId);
    if (!op) {
      return res.status(404).json({
        error: { message: "Operation not found or expired.", code: "OPERATION_NOT_FOUND" },
      });
    }
    return res.json({
      operationId: op.operationId,
      kind: op.kind,
      status: op.status,
      phase: op.phase,
      percent: op.percent,
      message: op.message,
      filename: op.filename,
      recordsDetected: op.recordsDetected,
      recordsProcessed: op.recordsProcessed,
      stockItemsProcessed: op.stockItemsProcessed,
      stockItemsTotal: op.stockItemsTotal,
      bytesDecoded: op.bytesDecoded,
      bytesTotal: op.bytesTotal,
      sanitizedInvalidRefCount: op.sanitizedInvalidRefCount,
      batchIndex: op.batchIndex,
      batchTotal: op.batchTotal,
      startedAt: op.startedAt,
      updatedAt: op.updatedAt,
      error: op.error,
      batchSize: IMPORT_BATCH_SIZE,
    });
  },
);

tallyMasterImportRouter.post(
  "/tally-import/preview",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can import Tally masters."),
  upload.single("file"),
  async (req, res, next) => {
    const correlationId = newCorrelationId();
    let operationId = null;
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
      const options = importOptionsSchema.parse({
        ...optionsRaw,
        sourceFilename: optionsRaw.sourceFilename || req.file.originalname || null,
      });

      operationId =
        readClientOperationId(req, options.clientOperationId) ||
        readClientOperationId(req, req.body?.clientOperationId) ||
        correlationId;
      beginOperation(operationId, "preview", req.file.originalname || null);

      updateOperation(operationId, {
        phase: "decoding",
        percent: 5,
        message: "Receiving upload and starting background XML analysis…",
        bytesTotal: req.file.buffer.length,
      });

      const prepared = await prepareAndParseTallyXmlInWorker(req.file.buffer, {
        onProgress: (p) => {
          updateOperation(operationId, {
            phase: p.phase || "analysing",
            percent: p.percent != null ? p.percent : null,
            message: p.message || "Analysing…",
            recordsDetected: p.recordsDetected ?? p.stockItemsTotal ?? null,
            recordsProcessed: p.recordsProcessed ?? p.stockItemsProcessed ?? null,
            stockItemsProcessed: p.stockItemsProcessed ?? null,
            stockItemsTotal: p.stockItemsTotal ?? null,
            bytesDecoded: p.bytesDecoded ?? null,
            bytesTotal: p.bytesTotal ?? null,
            sanitizedInvalidRefCount: p.sanitizedInvalidRefCount ?? null,
          });
        },
      });
      // Drop multer buffer reference ASAP (worker already copied bytes).
      try {
        req.file.buffer = Buffer.alloc(0);
      } catch {
        /* ignore */
      }

      const decodeMeta = prepared.decodeMeta;
      const xmlText = prepared.text;

      updateOperation(operationId, {
        phase: "preparing_preview",
        percent: 88,
        message: "Building preview rows and mapping tables…",
        recordsDetected: prepared.parsed?.parseStats?.stockItemsParsed ?? null,
        recordsProcessed: prepared.parsed?.parseStats?.stockItemsParsed ?? null,
        stockItemsProcessed: prepared.parsed?.parseStats?.stockItemsParsed ?? null,
        stockItemsTotal: prepared.parsed?.parseStats?.stockItemsParsed ?? null,
      });

      const payload = await buildPreviewPayload(prisma, xmlText, options, decodeMeta, {
        preParsed: prepared.parsed,
        onProgress: (p) => {
          updateOperation(operationId, {
            phase: p.phase || "preparing_preview",
            percent: p.percent != null ? p.percent : 90,
            message: p.message || "Preparing preview…",
            recordsDetected: p.recordsDetected ?? null,
            recordsProcessed: p.recordsProcessed ?? null,
            stockItemsProcessed: p.stockItemsProcessed ?? null,
            stockItemsTotal: p.stockItemsTotal ?? null,
          });
        },
      });
      if (!payload.ok) {
        endOperation(operationId, "failed", payload.error || "Invalid XML.");
        return res.status(400).json({
          error: { message: payload.error || "Invalid XML.", code: "XML_PARSE", correlationId, operationId },
        });
      }

      updateOperation(operationId, {
        phase: "preparing_preview",
        percent: 98,
        message: "Preparing preview rows…",
        recordsDetected: payload.parseStats?.stockItemsParsed ?? payload.stockPreview?.totalStockItems ?? null,
        recordsProcessed: payload.parseStats?.stockItemsParsed ?? null,
      });

      const previewToken = createPreviewSession(xmlText, options, decodeMeta, {
        ownerUserId: req.user?.id ?? null,
        sourceFilename: options.sourceFilename || req.file.originalname || null,
        sourceFingerprint: fingerprintXmlText(xmlText),
        mappingSummary: {
          stockItemsParsed: payload.parseStats?.stockItemsParsed ?? null,
          importable: payload.stockPreview?.importable ?? null,
          excluded: payload.stockPreview?.excluded ?? null,
          groupMappingCount: Array.isArray(payload.groupMapping) ? payload.groupMapping.length : 0,
          unitMappingCount: Array.isArray(payload.unitMapping) ? payload.unitMapping.length : 0,
        },
      });
      endOperation(operationId, "completed");
      return res.json({
        previewToken,
        correlationId,
        operationId,
        warnings: payload.warnings,
        infoNotes: payload.infoNotes ?? [],
        blockingErrors: payload.blockingErrors ?? [],
        blockingErrorCount: payload.blockingErrorCount ?? 0,
        confirmBlockingErrors: payload.confirmBlockingErrors ?? [],
        confirmBlockingErrorCount: payload.confirmBlockingErrorCount ?? 0,
        identityBackfillEligible: payload.identityBackfillEligible !== false,
        parsedMasterCounts: payload.parsedMasterCounts ?? null,
        summary: payload.summary,
        customers: payload.customers,
        suppliers: payload.suppliers,
        items: payload.items,
        units: payload.units,
        groupMapping: payload.groupMapping ?? [],
        unitMapping: payload.unitMapping ?? [],
        warningSummary: payload.warningSummary ?? null,
        stockPreview: payload.stockPreview ?? null,
        parseStats: payload.parseStats,
        decode: decodeMeta,
        maxUploadBytes: MAX_XML_BYTES,
        runtime: payload.runtime ?? null,
        ...(payload.partyDiagnostics ? { partyDiagnostics: payload.partyDiagnostics } : {}),
      });
    } catch (e) {
      if (operationId) endOperation(operationId, "failed", e instanceof Error ? e.message : String(e));
      if (e instanceof z.ZodError) return next(e);
      const mapped = formatTallyImportHttpError(e, correlationId);
      return res.status(mapped.status).json(mapped.body);
    }
  },
);

const recalculateBodySchema = z
  .object({
    previewToken: z.string().min(10).max(128),
    groupTypeOverrides: z.record(z.string().max(256), mappingChoiceSchema).default({}),
    unitMapOverrides: z.record(z.string().max(128), z.string().max(64).nullable()).default({}),
  })
  .strict();

tallyMasterImportRouter.post(
  "/tally-import/preview/recalculate",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can import Tally masters."),
  async (req, res, next) => {
    const correlationId = newCorrelationId();
    try {
      const body = recalculateBodySchema.parse(req.body ?? {});
      const payload = await rebuildPreviewFromToken(
        prisma,
        body.previewToken,
        {
          groupTypeOverrides: body.groupTypeOverrides,
          unitMapOverrides: body.unitMapOverrides,
        },
        req.user?.id ?? null,
      );
      if (!payload.ok) {
        return res.status(400).json({
          error: { message: payload.error || "Could not recalculate preview.", code: "XML_PARSE", correlationId },
        });
      }
      return res.json({
        correlationId,
        warnings: payload.warnings,
        infoNotes: payload.infoNotes ?? [],
        blockingErrors: payload.blockingErrors ?? [],
        blockingErrorCount: payload.blockingErrorCount ?? 0,
        confirmBlockingErrors: payload.confirmBlockingErrors ?? [],
        confirmBlockingErrorCount: payload.confirmBlockingErrorCount ?? 0,
        parsedMasterCounts: payload.parsedMasterCounts ?? null,
        summary: payload.summary,
        customers: payload.customers,
        suppliers: payload.suppliers,
        items: payload.items,
        units: payload.units,
        groupMapping: payload.groupMapping ?? [],
        unitMapping: payload.unitMapping ?? [],
        warningSummary: payload.warningSummary ?? null,
        stockPreview: payload.stockPreview ?? null,
        parseStats: payload.parseStats,
        decode: payload.decode ?? null,
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
    previewToken: z.string().min(10).max(128),
    confirm: z.literal(true),
    confirmConflicts: z.boolean().optional(),
    clientOperationId: z.string().min(8).max(128).optional().nullable(),
    duplicateAction: z.enum(["SKIP", "UPDATE_EMPTY_FIELDS_ONLY"]).optional(),
    // Mapping decisions only — never resend preview rows / XML / diagnostics.
    groupTypeOverrides: z
      .record(z.string().max(256), mappingChoiceSchema)
      .optional()
      .refine((o) => o == null || Object.keys(o).length <= 2_000, { message: "Too many groupTypeOverrides keys." }),
    unitMapOverrides: z
      .record(z.string().max(128), z.string().max(64).nullable())
      .optional()
      .refine((o) => o == null || Object.keys(o).length <= 2_000, { message: "Too many unitMapOverrides keys." }),
    // Optional sparse per-item overrides (max 500). Prefer group mappings for stock imports.
    itemTypeOverrides: z
      .record(z.string().max(256), z.enum(["RM", "FG", "SFG", "CONSUMABLE", "EXCLUDE", "PACKING", "SCRAP"]))
      .optional()
      .refine((o) => o == null || Object.keys(o).length <= 500, {
        message: "Too many itemTypeOverrides — use group mappings (max 500 sparse overrides).",
      }),
  })
  .strict();

tallyMasterImportRouter.post(
  "/tally-import/apply",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can import Tally masters."),
  async (req, res, next) => {
    const correlationId = newCorrelationId();
    let operationId = null;
    try {
      const body = applyBodySchema.parse(req.body ?? {});
      operationId = readClientOperationId(req, body.clientOperationId) || correlationId;
      beginOperation(operationId, "apply", null);
      updateOperation(operationId, {
        phase: "importing",
        percent: 5,
        message: "Starting import…",
      });

      const result = await applyFromPreviewToken(prisma, body.previewToken, {
        // Prefer Stage-2 group/unit mappings; sparse item overrides only when provided and small.
        itemTypeOverrides: body.itemTypeOverrides ?? undefined,
        groupTypeOverrides: body.groupTypeOverrides ?? undefined,
        unitMapOverrides: body.unitMapOverrides ?? undefined,
        confirmConflicts: body.confirmConflicts === true,
        duplicateAction: body.duplicateAction ?? undefined,
        actorUser: req.user || null,
        onProgress: (p) => {
          updateOperation(operationId, {
            phase: "importing",
            percent: p.percent != null ? p.percent : null,
            message: p.message || "Importing…",
            batchIndex: p.batchIndex ?? null,
            batchTotal: p.batchTotal ?? null,
            recordsProcessed: p.itemsProcessed ?? null,
            recordsDetected: p.itemsTotal ?? null,
          });
        },
      });
      endOperation(operationId, "completed");
      return res.json({ ...result, correlationId, operationId });
    } catch (e) {
      if (operationId) endOperation(operationId, "failed", e instanceof Error ? e.message : String(e));
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
          message: `XML file too large (max ${Math.round(MAX_XML_BYTES / (1024 * 1024))} MB). Stock Items exports ~65 MB are supported on this endpoint only.`,
          code: "FILE_TOO_LARGE",
        },
      });
    }
    return res.status(400).json({ error: { message: err.message, code: "UPLOAD_ERROR" } });
  }
  // body-parser PayloadTooLargeError on Confirm Import (should be rare after slim payload).
  if (err && (err.type === "entity.too.large" || err.status === 413 || err.statusCode === 413)) {
    return res.status(413).json({
      error: {
        message: "The import confirmation request was too large. No stock items were imported.",
        code: "CONFIRM_PAYLOAD_TOO_LARGE",
        limit: TALLY_APPLY_JSON_LIMIT,
      },
    });
  }
  return next(err);
});

module.exports = { tallyMasterImportRouter };
