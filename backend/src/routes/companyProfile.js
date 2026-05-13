const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  LOGO_MAX_BYTES,
  SIGNATURE_MAX_BYTES,
  LOGO_ALLOWED_MIME,
  SIGNATURE_ALLOWED_MIME,
  getCompanyProfile,
  updateCompanyProfile,
  setCompanyLogo,
  clearCompanyLogo,
  setCompanySignature,
  clearCompanySignature,
  getCompanyLogoFile,
  getCompanySignatureFile,
} = require("../services/companyProfile");

const companyProfileRouter = express.Router();

/* ----------------------------- Upload guards ---------------------------- */

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (LOGO_ALLOWED_MIME.has(String(file.mimetype || "").toLowerCase())) {
      return cb(null, true);
    }
    const err = new Error("Unsupported logo format. Use PNG, JPG, or SVG.");
    err.statusCode = 415;
    return cb(err);
  },
});

const signatureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SIGNATURE_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (SIGNATURE_ALLOWED_MIME.has(String(file.mimetype || "").toLowerCase())) {
      return cb(null, true);
    }
    const err = new Error("Unsupported signature format. Use PNG or JPG.");
    err.statusCode = 415;
    return cb(err);
  },
});

function multerErrorMessage(err) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") return "File too large.";
    if (err.code === "LIMIT_UNEXPECTED_FILE") return "Unexpected upload field.";
  }
  return err && err.message ? err.message : "Upload failed.";
}

/* -------------------------------- Schemas ------------------------------- */

const profilePutSchema = z
  .object({
    companyName: z.union([z.string(), z.null()]).optional(),
    companyAddressLine1: z.union([z.string(), z.null()]).optional(),
    companyAddressLine2: z.union([z.string(), z.null()]).optional(),
    companyCity: z.union([z.string(), z.null()]).optional(),
    companyPincode: z.union([z.string(), z.null()]).optional(),
    companyState: z.union([z.string(), z.null()]).optional(),
    companyStateId: z.union([z.number().int().positive(), z.null()]).optional(),
    companyGstin: z.union([z.string(), z.null()]).optional(),
    companyPan: z.union([z.string(), z.null()]).optional(),
    companyMobile: z.union([z.string(), z.null()]).optional(),
    companyPhone: z.union([z.string(), z.null()]).optional(),
    companyEmail: z.union([z.string(), z.null()]).optional(),
    companyWebsite: z.union([z.string(), z.null()]).optional(),
    companySignatoryName: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

/* --------------------------------- Routes ------------------------------- */

/**
 * GET /api/company-profile — read the company profile shape used by the
 * Settings UI and document-preview helpers. Any authenticated user may read
 * (so PDFs / previews work for non-admin roles); writes are admin-only.
 */
companyProfileRouter.get("/", requireAuth, async (_req, res, next) => {
  try {
    const profile = await getCompanyProfile();
    return res.json(profile);
  } catch (e) {
    return next(e);
  }
});

companyProfileRouter.put("/", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const body = profilePutSchema.parse(req.body);
    const saved = await updateCompanyProfile(body);
    return res.json(saved);
  } catch (e) {
    return next(e);
  }
});

/* ----- Logo upload / clear ----- */

companyProfileRouter.post(
  "/logo",
  requireAuth,
  requireRole(["ADMIN"]),
  (req, res, next) => {
    logoUpload.single("file")(req, res, (err) => {
      if (err) {
        const status = err.statusCode || 400;
        return res.status(status).json({ error: { message: multerErrorMessage(err) } });
      }
      return next();
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ error: { message: "Logo file is required (field name: file)." } });
      }
      const saved = await setCompanyLogo(req.file);
      return res.json(saved);
    } catch (e) {
      if (e instanceof Error && e.message) {
        return res.status(400).json({ error: { message: e.message } });
      }
      return next(e);
    }
  },
);

companyProfileRouter.delete("/logo", requireAuth, requireRole(["ADMIN"]), async (_req, res, next) => {
  try {
    const saved = await clearCompanyLogo();
    return res.json(saved);
  } catch (e) {
    return next(e);
  }
});

/* ----- Signature upload / clear ----- */

companyProfileRouter.post(
  "/signature",
  requireAuth,
  requireRole(["ADMIN"]),
  (req, res, next) => {
    signatureUpload.single("file")(req, res, (err) => {
      if (err) {
        const status = err.statusCode || 400;
        return res.status(status).json({ error: { message: multerErrorMessage(err) } });
      }
      return next();
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ error: { message: "Signature file is required (field name: file)." } });
      }
      const saved = await setCompanySignature(req.file);
      return res.json(saved);
    } catch (e) {
      if (e instanceof Error && e.message) {
        return res.status(400).json({ error: { message: e.message } });
      }
      return next(e);
    }
  },
);

companyProfileRouter.delete(
  "/signature",
  requireAuth,
  requireRole(["ADMIN"]),
  async (_req, res, next) => {
    try {
      const saved = await clearCompanySignature();
      return res.json(saved);
    } catch (e) {
      return next(e);
    }
  },
);

/* ----- Asset streaming (for in-app preview + IMG tags) ----- */

function streamFile(res, file) {
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Cache-Control", "private, max-age=60");
  const stream = fs.createReadStream(file.absolutePath);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  stream.pipe(res);
}

companyProfileRouter.get("/logo/file", requireAuth, async (_req, res, next) => {
  try {
    const file = await getCompanyLogoFile();
    if (!file) return res.status(404).json({ error: { message: "No logo uploaded." } });
    return streamFile(res, file);
  } catch (e) {
    return next(e);
  }
});

companyProfileRouter.get("/signature/file", requireAuth, async (_req, res, next) => {
  try {
    const file = await getCompanySignatureFile();
    if (!file) return res.status(404).json({ error: { message: "No signature uploaded." } });
    return streamFile(res, file);
  } catch (e) {
    return next(e);
  }
});

module.exports = { companyProfileRouter };
