/**
 * Restore eligibility / preflight (Phase 3) — pure helpers + file checks.
 * Self-service: MANUAL | AUTOMATIC | DEPLOYMENT with CREATED + validated metadata.
 * PRE_RESTORE_AUTO is rollback-only (not Admin self-service).
 */
const fs = require("fs");
const { hashBackupFileSha256 } = require("./backupValidation");
const { assertBackupPathAllowed } = require("./backupStoragePaths");

const SELF_SERVICE_TYPES = new Set(["MANUAL", "AUTOMATIC", "DEPLOYMENT"]);

/**
 * @param {object} row DbBackup-like
 * @returns {{
 *   eligible: boolean;
 *   code: string | null;
 *   reason: string | null;
 *   itAssistedRequired: boolean;
 *   display: object;
 * }}
 */
function evaluateRestoreEligibility(row) {
  const display = {
    id: row?.id ?? null,
    fileName: row?.fileName ?? null,
    backupType: row?.backupType ?? null,
    status: row?.status ?? null,
    createdAt: row?.createdAt instanceof Date ? row.createdAt.toISOString() : row?.createdAt ?? null,
    fileSizeBytes: row?.fileSizeBytes == null ? null : Number(row.fileSizeBytes),
    userCount: row?.userCount ?? null,
    activeAdminCount: row?.activeAdminCount ?? null,
    hasChecksum: Boolean(row?.checksumSha256),
  };

  if (!row) {
    return {
      eligible: false,
      code: "NOT_FOUND",
      reason: "Backup not found.",
      itAssistedRequired: false,
      display,
    };
  }

  if (row.backupType === "PRE_RESTORE_AUTO") {
    return {
      eligible: false,
      code: "ROLLBACK_ONLY",
      reason: "Pre-restore safety backups are for automatic rollback only (not self-service restore).",
      itAssistedRequired: true,
      display,
    };
  }

  if (!SELF_SERVICE_TYPES.has(row.backupType)) {
    return {
      eligible: false,
      code: "RESTORE_INVALID_TYPE",
      reason: "This backup type cannot be restored from Admin self-service.",
      itAssistedRequired: true,
      display,
    };
  }

  if (row.status !== "CREATED") {
    return {
      eligible: false,
      code: "RESTORE_INVALID_STATUS",
      reason: "Only completed (Created) backups can be restored.",
      itAssistedRequired: false,
      display,
    };
  }

  // Legacy / unverified: missing checksum or user/admin metadata
  if (
    !row.checksumSha256 ||
    row.userCount == null ||
    row.activeAdminCount == null ||
    row.fileSizeBytes == null
  ) {
    return {
      eligible: false,
      code: "IT_ASSISTED_REQUIRED",
      reason: "IT-assisted restore required. This backup is missing validated size, checksum, or user/Admin metadata.",
      itAssistedRequired: true,
      display,
    };
  }

  if (Number(row.userCount) < 1 || Number(row.activeAdminCount) < 1) {
    return {
      eligible: false,
      code: "ZERO_ADMIN_OR_USERS",
      reason:
        "IT-assisted restore required. Backup metadata must show at least one user and one active Admin.",
      itAssistedRequired: true,
      display,
    };
  }

  return {
    eligible: true,
    code: null,
    reason: null,
    itAssistedRequired: false,
    display,
  };
}

/**
 * Verify file on disk: exists, size, SHA-256. Path must be under trusted roots.
 * @param {object} row
 * @param {NodeJS.ProcessEnv} [env]
 */
async function verifyBackupFileIntegrity(row, env = process.env) {
  assertBackupPathAllowed(row.filePath, env);
  try {
    await fs.promises.access(row.filePath, fs.constants.R_OK);
  } catch {
    const err = new Error("Backup file is missing on disk.");
    err.statusCode = 400;
    err.code = "BACKUP_FILE_MISSING";
    throw err;
  }
  const { sizeBytes, checksumSha256 } = await hashBackupFileSha256(row.filePath);
  const expectedSize = Number(row.fileSizeBytes);
  if (Number.isFinite(expectedSize) && sizeBytes !== expectedSize) {
    const err = new Error(
      "Backup file size does not match catalog metadata. IT-assisted restore required.",
    );
    err.statusCode = 400;
    err.code = "BACKUP_SIZE_MISMATCH";
    throw err;
  }
  const expected = String(row.checksumSha256 || "").toLowerCase();
  if (!expected || checksumSha256.toLowerCase() !== expected) {
    const err = new Error(
      "Backup SHA-256 checksum verification failed. File may be corrupt. IT-assisted restore required.",
    );
    err.statusCode = 400;
    err.code = "BACKUP_CHECKSUM_MISMATCH";
    throw err;
  }
  return { sizeBytes, checksumSha256 };
}

/**
 * Safety PRE_RESTORE_AUTO must itself be valid before import.
 */
function assertPreRestoreBackupValid(row) {
  if (!row || row.status !== "CREATED") {
    const err = new Error("Pre-restore safety backup failed validation (not Created). Restore aborted.");
    err.statusCode = 503;
    err.code = "SAFETY_BACKUP_INVALID";
    throw err;
  }
  if (!row.checksumSha256 || !row.fileSizeBytes || Number(row.fileSizeBytes) <= 0) {
    const err = new Error("Pre-restore safety backup failed validation (missing checksum/size). Restore aborted.");
    err.statusCode = 503;
    err.code = "SAFETY_BACKUP_INVALID";
    throw err;
  }
  if (row.userCount == null || Number(row.userCount) < 1) {
    const err = new Error("Pre-restore safety backup failed validation (zero users). Restore aborted.");
    err.statusCode = 503;
    err.code = "SAFETY_BACKUP_INVALID";
    throw err;
  }
  if (row.activeAdminCount == null || Number(row.activeAdminCount) < 1) {
    const err = new Error("Pre-restore safety backup failed validation (zero active Admins). Restore aborted.");
    err.statusCode = 503;
    err.code = "SAFETY_BACKUP_INVALID";
    throw err;
  }
}

module.exports = {
  SELF_SERVICE_TYPES,
  evaluateRestoreEligibility,
  verifyBackupFileIntegrity,
  assertPreRestoreBackupValid,
};
