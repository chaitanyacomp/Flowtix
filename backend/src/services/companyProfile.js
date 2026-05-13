/**
 * Company Profile — centralized branding source for all ERP documents.
 *
 * Persists into the existing `AppSetting` singleton (id = 1). Aggregates the
 * legacy state/GSTIN fields with the new branding fields so the frontend has a
 * single read/write surface. State + GSTIN writes delegate back into the
 * existing `appSettings` service so Tally export and GST math continue to read
 * the same source of truth (no duplication, no drift).
 *
 * This service is presentational only — it never participates in GST math,
 * Tally XML, document numbering, or any other calculation.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { prisma } = require("../utils/prisma");
const { ensureAppSettings, setCompanyGstDetails } = require("./appSettings");

/* --------------------------- Disk storage layout ------------------------- */

/** Default branding storage root (mirrors the backup-storage pattern). */
function getDefaultBrandingStorageRoot() {
  const backendRoot = path.resolve(__dirname, "..", "..");
  return path.resolve(backendRoot, "..", "ERP_DATA", "branding");
}

/** @returns {string} Absolute path to the branding storage root. */
function getBrandingStorageRoot() {
  const raw = process.env.BRANDING_STORAGE_DIR;
  if (raw && String(raw).trim()) return path.resolve(String(raw).trim());
  return getDefaultBrandingStorageRoot();
}

function ensureBrandingDir() {
  const root = getBrandingStorageRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** @param {string} relPath Path stored on the AppSetting row. */
function resolveBrandingAbsolutePath(relPath) {
  if (!relPath) return null;
  const root = getBrandingStorageRoot();
  // Guard against path traversal.
  const safeRel = String(relPath).replace(/^[/\\]+/, "").replace(/\.\.+/g, "");
  const abs = path.resolve(root, safeRel);
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  return abs;
}

/* ----------------------------- Upload policy ----------------------------- */

const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const SIGNATURE_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

const LOGO_ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/svg+xml"]);
const SIGNATURE_ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/jpg"]);

const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/svg+xml": "svg",
};

/**
 * Quick magic-bytes / safety check. Returns the trusted mime, or null when
 * the buffer doesn't actually match the declared mime (or contains unsafe
 * SVG content).
 *
 * @param {Buffer} buf
 * @param {string} declaredMime
 * @returns {string | null}
 */
function detectImageMime(buf, declaredMime) {
  if (!buf || buf.length < 4) return null;
  const head = buf.slice(0, 8);
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return "image/png";
  }
  // JPG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image/jpeg";
  }
  // SVG: text-based, must start with <?xml or <svg (after optional BOM/whitespace)
  if (declaredMime === "image/svg+xml") {
    const text = buf.toString("utf8", 0, Math.min(buf.length, 1024)).trimStart();
    if (text.startsWith("<?xml") || text.startsWith("<svg") || text.startsWith("<!--")) {
      // Reject obvious script content; this is a deliberately conservative check.
      const sample = buf.toString("utf8", 0, Math.min(buf.length, 4096)).toLowerCase();
      if (sample.includes("<script") || sample.includes("onload=") || sample.includes("onerror=")) {
        return null;
      }
      return "image/svg+xml";
    }
  }
  return null;
}

/* ------------------------------ Read / write ----------------------------- */

const PROFILE_SELECT = {
  companyState: true,
  companyStateId: true,
  companyGstin: true,
  companyStateRef: { select: { id: true, stateName: true, stateCode: true } },
  companyName: true,
  companyAddressLine1: true,
  companyAddressLine2: true,
  companyCity: true,
  companyPincode: true,
  companyPan: true,
  companyMobile: true,
  companyPhone: true,
  companyEmail: true,
  companyWebsite: true,
  companyLogoPath: true,
  companyLogoMime: true,
  companySignatoryName: true,
  companySignaturePath: true,
  companySignatureMime: true,
};

function shapeProfile(row) {
  if (!row) {
    return {
      companyName: null,
      companyAddressLine1: null,
      companyAddressLine2: null,
      companyCity: null,
      companyState: null,
      companyStateId: null,
      companyStateName: null,
      companyStateCode: null,
      companyPincode: null,
      companyGstin: null,
      companyPan: null,
      companyMobile: null,
      companyPhone: null,
      companyEmail: null,
      companyWebsite: null,
      companySignatoryName: null,
      hasLogo: false,
      hasSignature: false,
      logoMime: null,
      signatureMime: null,
    };
  }
  return {
    companyName: row.companyName ?? null,
    companyAddressLine1: row.companyAddressLine1 ?? null,
    companyAddressLine2: row.companyAddressLine2 ?? null,
    companyCity: row.companyCity ?? null,
    companyState: row.companyState ?? null,
    companyStateId: row.companyStateId ?? null,
    companyStateName: row.companyStateRef?.stateName ?? null,
    companyStateCode: row.companyStateRef?.stateCode ?? null,
    companyPincode: row.companyPincode ?? null,
    companyGstin: row.companyGstin ?? null,
    companyPan: row.companyPan ?? null,
    companyMobile: row.companyMobile ?? null,
    companyPhone: row.companyPhone ?? null,
    companyEmail: row.companyEmail ?? null,
    companyWebsite: row.companyWebsite ?? null,
    companySignatoryName: row.companySignatoryName ?? null,
    hasLogo: Boolean(row.companyLogoPath),
    hasSignature: Boolean(row.companySignaturePath),
    logoMime: row.companyLogoMime ?? null,
    signatureMime: row.companySignatureMime ?? null,
  };
}

/** Public read used by both the API and downstream PDF generators. */
async function getCompanyProfile() {
  await ensureAppSettings();
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: PROFILE_SELECT,
  });
  return shapeProfile(row);
}

/**
 * Internal helper for PDF generators: returns the shaped profile + resolved
 * absolute paths to logo/signature files (when present and readable on disk).
 */
async function getCompanyProfileForDocuments() {
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: PROFILE_SELECT,
  });
  if (!row) return { ...shapeProfile(null), logoAbsolutePath: null, signatureAbsolutePath: null };

  const logoAbs = row.companyLogoPath ? resolveBrandingAbsolutePath(row.companyLogoPath) : null;
  const signAbs = row.companySignaturePath ? resolveBrandingAbsolutePath(row.companySignaturePath) : null;

  return {
    ...shapeProfile(row),
    logoAbsolutePath: logoAbs && fs.existsSync(logoAbs) ? logoAbs : null,
    signatureAbsolutePath: signAbs && fs.existsSync(signAbs) ? signAbs : null,
  };
}

function trimOrNull(v, max) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = String(v).trim();
  if (!t) return null;
  return max ? t.slice(0, max) : t;
}

function normalizeUpper(v, max) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = String(v).trim().toUpperCase();
  if (!t) return null;
  return max ? t.slice(0, max) : t;
}

/**
 * Update the textual fields of the company profile. State + GSTIN are
 * delegated to `setCompanyGstDetails` so Tally / GST consumers see the same
 * canonical write path.
 *
 * @param {object} patch — any subset of the profile keys.
 */
async function updateCompanyProfile(patch) {
  await ensureAppSettings();

  // Split the patch: branding/text fields go straight to AppSetting; GST/state
  // fields go through the legacy setter so we don't duplicate validation.
  const gstPatch = {};
  if (Object.prototype.hasOwnProperty.call(patch, "companyState")) {
    gstPatch.companyState = patch.companyState;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "companyStateId")) {
    gstPatch.companyStateId = patch.companyStateId;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "companyGstin")) {
    gstPatch.companyGstin = patch.companyGstin;
  }
  if (Object.keys(gstPatch).length) {
    await setCompanyGstDetails(gstPatch);
  }

  const next = {};
  const map = [
    ["companyName", 160],
    ["companyAddressLine1", 160],
    ["companyAddressLine2", 160],
    ["companyCity", 96],
    ["companyPincode", 12],
    ["companyMobile", 32],
    ["companyPhone", 32],
    ["companyEmail", 160],
    ["companyWebsite", 160],
    ["companySignatoryName", 160],
  ];
  for (const [key, max] of map) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      next[key] = trimOrNull(patch[key], max);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "companyPan")) {
    next.companyPan = normalizeUpper(patch.companyPan, 10);
  }

  if (Object.keys(next).length) {
    await prisma.appSetting.update({ where: { id: 1 }, data: next });
  }
  return getCompanyProfile();
}

/* ------------------------------ Logo & sign ------------------------------ */

/**
 * Validate + persist a logo image. Replaces any prior logo and removes its
 * file from disk.
 *
 * @param {{ buffer: Buffer, mimetype: string, size: number, originalname?: string }} file
 */
async function setCompanyLogo(file) {
  if (!file || !file.buffer) throw new Error("Logo file is required.");
  if (file.size > LOGO_MAX_BYTES) {
    throw new Error("Logo file is too large (max 2 MB).");
  }
  const declared = String(file.mimetype || "").toLowerCase();
  if (!LOGO_ALLOWED_MIME.has(declared)) {
    throw new Error("Unsupported logo format. Use PNG, JPG, or SVG.");
  }
  const detected = detectImageMime(file.buffer, declared);
  if (!detected || !LOGO_ALLOWED_MIME.has(detected)) {
    throw new Error("Logo file content does not match its declared format.");
  }
  return saveBrandingAsset("logo", file.buffer, detected, {
    pathField: "companyLogoPath",
    mimeField: "companyLogoMime",
  });
}

async function clearCompanyLogo() {
  return removeBrandingAsset({ pathField: "companyLogoPath", mimeField: "companyLogoMime" });
}

/**
 * @param {{ buffer: Buffer, mimetype: string, size: number, originalname?: string }} file
 */
async function setCompanySignature(file) {
  if (!file || !file.buffer) throw new Error("Signature file is required.");
  if (file.size > SIGNATURE_MAX_BYTES) {
    throw new Error("Signature file is too large (max 1 MB).");
  }
  const declared = String(file.mimetype || "").toLowerCase();
  if (!SIGNATURE_ALLOWED_MIME.has(declared)) {
    throw new Error("Unsupported signature format. Use PNG or JPG.");
  }
  const detected = detectImageMime(file.buffer, declared);
  if (!detected || !SIGNATURE_ALLOWED_MIME.has(detected)) {
    throw new Error("Signature file content does not match its declared format.");
  }
  return saveBrandingAsset("signature", file.buffer, detected, {
    pathField: "companySignaturePath",
    mimeField: "companySignatureMime",
  });
}

async function clearCompanySignature() {
  return removeBrandingAsset({
    pathField: "companySignaturePath",
    mimeField: "companySignatureMime",
  });
}

/* ----- low-level helpers (shared by logo + signature, kept generic) ----- */

async function saveBrandingAsset(kind, buffer, mime, fieldMap) {
  await ensureAppSettings();
  ensureBrandingDir();

  const ext = MIME_TO_EXT[mime] || "bin";
  const stamp = Date.now();
  const rand = crypto.randomBytes(4).toString("hex");
  const fileName = `${kind}-${stamp}-${rand}.${ext}`;
  const absPath = path.join(getBrandingStorageRoot(), fileName);
  fs.writeFileSync(absPath, buffer);

  // Best-effort cleanup of previous file
  const prior = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { [fieldMap.pathField]: true },
  });
  const priorRel = prior?.[fieldMap.pathField];
  if (priorRel) {
    const priorAbs = resolveBrandingAbsolutePath(priorRel);
    if (priorAbs && fs.existsSync(priorAbs)) {
      try {
        fs.unlinkSync(priorAbs);
      } catch (_e) {
        // non-fatal — orphan file is acceptable
      }
    }
  }

  await prisma.appSetting.update({
    where: { id: 1 },
    data: { [fieldMap.pathField]: fileName, [fieldMap.mimeField]: mime },
  });
  return getCompanyProfile();
}

async function removeBrandingAsset(fieldMap) {
  await ensureAppSettings();
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { [fieldMap.pathField]: true },
  });
  const rel = row?.[fieldMap.pathField];
  if (rel) {
    const abs = resolveBrandingAbsolutePath(rel);
    if (abs && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch (_e) {
        // non-fatal
      }
    }
  }
  await prisma.appSetting.update({
    where: { id: 1 },
    data: { [fieldMap.pathField]: null, [fieldMap.mimeField]: null },
  });
  return getCompanyProfile();
}

/* --------------------------- File stream helpers ------------------------- */

async function getCompanyLogoFile() {
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { companyLogoPath: true, companyLogoMime: true },
  });
  if (!row?.companyLogoPath) return null;
  const abs = resolveBrandingAbsolutePath(row.companyLogoPath);
  if (!abs || !fs.existsSync(abs)) return null;
  return { absolutePath: abs, mime: row.companyLogoMime || "application/octet-stream" };
}

async function getCompanySignatureFile() {
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { companySignaturePath: true, companySignatureMime: true },
  });
  if (!row?.companySignaturePath) return null;
  const abs = resolveBrandingAbsolutePath(row.companySignaturePath);
  if (!abs || !fs.existsSync(abs)) return null;
  return { absolutePath: abs, mime: row.companySignatureMime || "application/octet-stream" };
}

module.exports = {
  // limits exposed so the router can size multer + report consistent messages
  LOGO_MAX_BYTES,
  SIGNATURE_MAX_BYTES,
  LOGO_ALLOWED_MIME,
  SIGNATURE_ALLOWED_MIME,
  // public API
  getCompanyProfile,
  getCompanyProfileForDocuments,
  updateCompanyProfile,
  setCompanyLogo,
  clearCompanyLogo,
  setCompanySignature,
  clearCompanySignature,
  getCompanyLogoFile,
  getCompanySignatureFile,
};
