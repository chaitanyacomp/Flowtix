/**
 * After migrate deploy: ensure the successful pre-migration CLI backup from
 * BACKUP_MANIFEST.json exists in DbBackup (idempotent; never duplicates).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  registerDbBackupCatalog,
  queryUserCounts,
  findMysqlExe,
  writeMysqlClientCnf,
} = require("./backupCatalogRegister");
const { hashBackupFileSha256, buildValidationWarnings } = require("./backupValidation");

/**
 * @param {{
 *   conn: { host: string; port: string; user: string; password: string; database: string };
 *   fileName: string;
 *   filePath: string;
 *   mysqlExe?: string;
 * }} input
 */
async function findExistingCatalogRow(input) {
  const mysqlExe = input.mysqlExe || findMysqlExe();
  const cnf = await writeMysqlClientCnf(input.conn);
  try {
    const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "''");
    const sql =
      "SELECT `id` FROM `DbBackup` WHERE `fileName`='" +
      esc(input.fileName) +
      "' OR `filePath`='" +
      esc(input.filePath) +
      "' LIMIT 1;";
    const r = spawnSync(
      mysqlExe,
      [`--defaults-extra-file=${cnf}`, "-N", "-B", input.conn.database, "-e", sql],
      { encoding: "utf8", windowsHide: true, timeout: 20000 },
    );
    if (r.error || r.status !== 0) {
      return { ok: false, id: null, error: String(r.stderr || r.error || "lookup failed") };
    }
    const idRaw = String(r.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)[0];
    const id = idRaw ? Number(idRaw) : null;
    return { ok: true, id: Number.isFinite(id) ? id : null };
  } finally {
    try {
      await fs.promises.unlink(cnf);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Idempotent reconcile of one successful manifest backup into DbBackup.
 * @param {{
 *   conn: { host: string; port: string; user: string; password: string; database: string };
 *   backupGate: { filename: string; path: string; fileSizeBytes?: number; timestamp?: string };
 *   mysqlExe?: string;
 * }} input
 * @returns {Promise<{ status: 'created'|'exists'|'skipped'|'error'; id?: number|null; message: string }>}
 */
async function reconcileManifestBackupToCatalog(input) {
  const fileName = input.backupGate.filename;
  const filePath = path.resolve(input.backupGate.path);
  if (!fileName || !filePath) {
    return { status: "skipped", message: "No backup gate filename/path to reconcile" };
  }
  if (!fs.existsSync(filePath)) {
    return { status: "skipped", message: `Backup file missing on disk: ${fileName}` };
  }

  const existing = await findExistingCatalogRow({
    conn: input.conn,
    fileName,
    filePath,
    mysqlExe: input.mysqlExe,
  });
  if (!existing.ok) {
    return { status: "error", message: `Catalog lookup failed: ${existing.error}` };
  }
  if (existing.id != null) {
    return {
      status: "exists",
      id: existing.id,
      message: `DbBackup already has id=${existing.id} for ${fileName}`,
    };
  }

  let sizeBytes = Number(input.backupGate.fileSizeBytes) || 0;
  let checksumSha256 = null;
  try {
    const hashed = await hashBackupFileSha256(filePath);
    sizeBytes = hashed.sizeBytes;
    checksumSha256 = hashed.checksumSha256;
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  let userCounts = { userCount: null, activeAdminCount: null };
  try {
    userCounts = await queryUserCounts(input.conn, input.mysqlExe);
  } catch {
    /* ignore */
  }
  const warnings = buildValidationWarnings({
    userCount: userCounts.userCount ?? 0,
    activeAdminCount: userCounts.activeAdminCount ?? 0,
  });

  const registered = await registerDbBackupCatalog({
    conn: input.conn,
    fileName,
    filePath,
    fileSizeBytes: sizeBytes,
    checksumSha256,
    userCount: userCounts.userCount,
    activeAdminCount: userCounts.activeAdminCount,
    validationWarnings: warnings,
    backupType: "DEPLOYMENT",
    status: "CREATED",
    remarks: "Reconciled from BACKUP_MANIFEST after migrate deploy",
    mysqlExe: input.mysqlExe,
  });

  if (registered.ok) {
    return {
      status: "created",
      id: registered.id,
      message: `Catalogued pre-migration backup as DbBackup id=${registered.id ?? "?"}`,
    };
  }

  const again = await findExistingCatalogRow({
    conn: input.conn,
    fileName,
    filePath,
    mysqlExe: input.mysqlExe,
  });
  if (again.ok && again.id != null) {
    return {
      status: "exists",
      id: again.id,
      message: `DbBackup already has id=${again.id} for ${fileName}`,
    };
  }

  return {
    status: "error",
    message: registered.reason || "Failed to register catalog row",
  };
}

module.exports = {
  reconcileManifestBackupToCatalog,
  findExistingCatalogRow,
};
