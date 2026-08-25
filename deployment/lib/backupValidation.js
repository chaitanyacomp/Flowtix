/**
 * Backup validation helpers for deployment CLI.
 * Keep in sync with `backend/src/services/backupValidation.js`.
 */
const fs = require("fs");
const crypto = require("crypto");

const WARNING_ZERO_USERS = "ZERO_USERS";
const WARNING_ZERO_ACTIVE_ADMINS = "ZERO_ACTIVE_ADMINS";

/**
 * @param {string} filePathAbs
 * @returns {Promise<{ sizeBytes: number; checksumSha256: string }>}
 */
async function hashBackupFileSha256(filePathAbs) {
  const stat = await fs.promises.stat(filePathAbs);
  const sizeBytes = Number(stat.size);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw Object.assign(new Error("Backup file is empty (0 bytes). Dump rejected."), {
      code: "BACKUP_EMPTY",
    });
  }
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePathAbs);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return { sizeBytes, checksumSha256: hash.digest("hex") };
}

/**
 * @param {{ userCount: number; activeAdminCount: number }} counts
 * @returns {string[]}
 */
function buildValidationWarnings(counts) {
  const warnings = [];
  const users = Number(counts.userCount);
  const admins = Number(counts.activeAdminCount);
  if (!Number.isFinite(users) || users <= 0) warnings.push(WARNING_ZERO_USERS);
  if (!Number.isFinite(admins) || admins <= 0) warnings.push(WARNING_ZERO_ACTIVE_ADMINS);
  return warnings;
}

/**
 * @param {string[] | null | undefined} warnings
 * @returns {string | null}
 */
function serializeValidationWarnings(warnings) {
  if (!warnings || !warnings.length) return null;
  return warnings.join(",");
}

module.exports = {
  WARNING_ZERO_USERS,
  WARNING_ZERO_ACTIVE_ADMINS,
  hashBackupFileSha256,
  buildValidationWarnings,
  serializeValidationWarnings,
};
