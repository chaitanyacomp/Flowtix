const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { prisma } = require("../utils/prisma");
const {
  buildPreviewPayload,
  createPreviewSession,
  applyFromPreviewToken,
  MAX_XML_BYTES,
} = require("../services/tallyMasterImport/tallyMasterImportService");
const { decodeXmlFromBuffer } = require("../services/tallyMasterImport/parseTallyMastersXml");

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

tallyMasterImportRouter.post(
  "/tally-import/preview",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can import Tally masters."),
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: { message: "XML file is required (field name: file).", code: "FILE_REQUIRED" } });
      }
      let optionsRaw = {};
      const optField = req.body?.options ?? req.body?.optionsJson;
      if (typeof optField === "string" && optField.trim()) {
        try {
          optionsRaw = JSON.parse(optField);
        } catch {
          return res.status(400).json({ error: { message: "Invalid options JSON.", code: "OPTIONS_INVALID" } });
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
        return res.status(400).json({ error: { message: payload.error || "Invalid XML.", code: "XML_PARSE" } });
      }
      const previewToken = createPreviewSession(xmlString, options);
      return res.json({
        previewToken,
        warnings: payload.warnings,
        summary: payload.summary,
        customers: payload.customers,
        suppliers: payload.suppliers,
        items: payload.items,
        units: payload.units,
        parseStats: payload.parseStats,
      });
    } catch (e) {
      return next(e);
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
    try {
      const body = applyBodySchema.parse(req.body ?? {});
      const result = await applyFromPreviewToken(prisma, body.previewToken, body.itemTypeOverrides ?? undefined);
      return res.json(result);
    } catch (e) {
      return next(e);
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
