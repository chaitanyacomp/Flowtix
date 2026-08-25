/**
 * Apply AUTOMATIC retention: delete SQL under trusted roots + DbBackup catalog rows.
 * MUST be invoked only while the caller holds the shared backup job lock (CLI/Admin),
 * so restore and manual backup cannot overlap retention deletes.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { planAutomaticRetention } = require("./backupRetention");
const { assertBackupPathAllowed } = require("./backupStoragePaths");
const { findMysqlExe, writeMysqlClientCnf } = require("./backupCatalogRegister");

/**
 * @param {{
 *   conn: { host: string; port: string; user: string; password: string; database: string };
 *   homeDir?: string;
 *   mysqlExe?: string;
 *   env?: NodeJS.ProcessEnv;
 * }} input
 */
async function listCatalogRowsForRetention(input) {
  const mysqlExe = input.mysqlExe || findMysqlExe(input.env);
  const cnf = await writeMysqlClientCnf(input.conn);
  try {
    const sql =
      "SELECT `id`, `fileName`, `filePath`, `backupType`, `status`, `createdAt` FROM `DbBackup` ORDER BY `createdAt` DESC LIMIT 2000;";
    const r = spawnSync(
      mysqlExe,
      [`--defaults-extra-file=${cnf}`, "-N", "-B", input.conn.database, "-e", sql],
      { encoding: "utf8", windowsHide: true, timeout: 60000 },
    );
    if (r.error || r.status !== 0) {
      return { ok: false, rows: [], error: String(r.stderr || r.error || "list failed") };
    }
    const rows = [];
    for (const line of String(r.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)) {
      const parts = line.split("\t");
      if (parts.length < 6) continue;
      rows.push({
        id: Number(parts[0]),
        fileName: parts[1],
        filePath: parts[2],
        backupType: parts[3],
        status: parts[4],
        createdAt: parts[5],
      });
    }
    return { ok: true, rows };
  } finally {
    try {
      await fs.promises.unlink(cnf);
    } catch {
      /* ignore */
    }
  }
}

async function deleteCatalogRow(conn, id, mysqlExe) {
  const cnf = await writeMysqlClientCnf(conn);
  try {
    const sql = `DELETE FROM \`DbBackup\` WHERE \`id\`=${Number(id)} AND \`backupType\`='AUTOMATIC' LIMIT 1;`;
    const r = spawnSync(
      mysqlExe,
      [`--defaults-extra-file=${cnf}`, "-N", "-B", conn.database, "-e", sql],
      { encoding: "utf8", windowsHide: true, timeout: 30000 },
    );
    return r.status === 0;
  } finally {
    try {
      await fs.promises.unlink(cnf);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {{
 *   conn: object;
 *   homeDir?: string;
 *   mysqlExe?: string;
 *   env?: NodeJS.ProcessEnv;
 *   dryRun?: boolean;
 * }} input
 */
async function applyAutomaticBackupRetention(input) {
  const env = input.env || process.env;
  const listed = await listCatalogRowsForRetention(input);
  if (!listed.ok) {
    return { ok: false, deleted: [], kept: [], error: listed.error };
  }
  const plan = planAutomaticRetention(listed.rows);
  const deleted = [];
  const errors = [];
  const byId = new Map(listed.rows.map((r) => [r.id, r]));

  for (const id of plan.deleteIds) {
    const row = byId.get(id);
    if (!row) continue;
    if (row.backupType !== "AUTOMATIC" || row.status !== "CREATED") continue;
    try {
      assertBackupPathAllowed(row.filePath, env, { homeDir: input.homeDir });
    } catch (e) {
      errors.push({ id, error: e.code || e.message || "path-rejected" });
      continue;
    }
    if (input.dryRun) {
      deleted.push({ id, fileName: row.fileName, dryRun: true });
      continue;
    }
    try {
      if (fs.existsSync(row.filePath)) fs.unlinkSync(row.filePath);
    } catch (e) {
      errors.push({ id, error: e.message || "unlink-failed" });
      continue;
    }
    const okDel = await deleteCatalogRow(input.conn, id, input.mysqlExe || findMysqlExe(env));
    if (!okDel) {
      errors.push({ id, error: "catalog-delete-failed" });
      continue;
    }
    deleted.push({ id, fileName: row.fileName });
  }

  return {
    ok: errors.length === 0,
    deleted,
    deleteIds: plan.deleteIds,
    keepIds: [...plan.keepIds],
    errors,
  };
}

module.exports = {
  listCatalogRowsForRetention,
  applyAutomaticBackupRetention,
  planAutomaticRetention,
};
