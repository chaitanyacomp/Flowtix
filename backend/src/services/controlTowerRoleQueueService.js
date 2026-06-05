/**
 * Control Tower role queue read-model (Prompt 6E).
 * Filters merged normalized rows by row.currentOwner (and role-specific rules).
 */

const { CONTROL_TOWER_STATUSES } = require("./controlTowerStatusMap");
const { CONTROL_TOWER_BOARD_GROUPS } = require("./controlTowerBoardGroups");
const { groupControlTowerRows } = require("./controlTowerBoardGroups");
const { applyBoardRowPageFilter } = require("./controlTowerBoardService");
const {
  CONTROL_TOWER_ROW_MODES,
  fetchMergedNormalizedRows,
  parseControlTowerRowMode,
  parseControlTowerPagination,
  paginateRows,
} = require("./controlTowerNormalizedRowsService");
const { dedupeRoleQueueRows } = require("./controlTowerRowIdentity");
const { ERP_ROLES } = require("../constants/erpRoles");

const ROLE_QUEUE_ROLES = Object.freeze([...ERP_ROLES]);

const PLANNING_STATUSES = new Set(
  CONTROL_TOWER_BOARD_GROUPS.find((g) => g.groupKey === "PLANNING")?.statusList ?? [
    CONTROL_TOWER_STATUSES.PLANNING_PENDING,
    CONTROL_TOWER_STATUSES.WO_PLANNING_PENDING,
  ],
);

const COMMERCIAL_STATUSES = new Set(
  CONTROL_TOWER_BOARD_GROUPS.find((g) => g.groupKey === "COMMERCIAL_CLOSURE")?.statusList ?? [
    CONTROL_TOWER_STATUSES.BILLING_PENDING,
    CONTROL_TOWER_STATUSES.NEXT_RS_READY,
    CONTROL_TOWER_STATUSES.EXPORT_PENDING,
    CONTROL_TOWER_STATUSES.PAYMENT_PENDING,
  ],
);

class RoleQueueAccessError extends Error {
  /**
   * @param {string} message
   * @param {number} [statusCode]
   */
  constructor(message, statusCode = 403) {
    super(message);
    this.name = "RoleQueueAccessError";
    this.statusCode = statusCode;
  }
}

/**
 * @param {unknown} role
 * @returns {string}
 */
function parseRoleQueueRole(role) {
  const token = String(role ?? "")
    .trim()
    .toUpperCase();
  if (!ROLE_QUEUE_ROLES.includes(token)) {
    throw new RoleQueueAccessError(`Invalid role queue: ${token}`, 400);
  }
  return token;
}

/**
 * @param {unknown} userRole
 * @param {unknown} requestedRole
 * @returns {string} normalized requested role
 */
function assertRoleQueueAccess(userRole, requestedRole) {
  const parsed = parseRoleQueueRole(requestedRole);
  const user = String(userRole ?? "")
    .trim()
    .toUpperCase();
  if (!user) {
    throw new RoleQueueAccessError("Unauthorized", 401);
  }
  if (user === "ADMIN") {
    return parsed;
  }
  if (user !== parsed) {
    throw new RoleQueueAccessError("Access denied. You can only view your own role queue.");
  }
  return parsed;
}

/**
 * @param {object} row
 * @param {string} role
 * @returns {boolean}
 */
function rowMatchesRoleQueue(row, role) {
  const owner = String(row?.currentOwner ?? "").toUpperCase();
  const status = String(row?.currentStatus ?? "");
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};

  if (role === "ADMIN") {
    if (owner === "ADMIN") return true;
    if (PLANNING_STATUSES.has(status)) return true;
    if (COMMERCIAL_STATUSES.has(status)) return true;
    return false;
  }

  if (role === "STORE") {
    return owner === "STORE";
  }

  if (role === "PRODUCTION") {
    return owner === "PRODUCTION";
  }

  if (role === "QA") {
    return owner === "QA";
  }

  if (role === "PURCHASE") {
    if (owner === "PURCHASE") return true;
    if (meta.purchaseHandoff === true) return true;
    return false;
  }

  return false;
}

/**
 * @param {object[]} rows
 * @param {string} role
 * @returns {object[]}
 */
function filterRowsForRoleQueue(rows, role) {
  const parsedRole = parseRoleQueueRole(role);
  return (Array.isArray(rows) ? rows : []).filter((row) => rowMatchesRoleQueue(row, parsedRole));
}

/**
 * @param {string} role
 * @param {{ page?: number; pageSize?: number; mode?: "sample" | "full"; limitPerSource?: number }} [options]
 */
async function getControlTowerRoleQueue(role, options = {}) {
  const parsedRole = parseRoleQueueRole(role);
  const mode =
    options.mode != null && String(options.mode).trim() !== ""
      ? parseControlTowerRowMode(options.mode)
      : CONTROL_TOWER_ROW_MODES.FULL;
  const { page, pageSize } = parseControlTowerPagination(options);

  const { rows: mergedRows, meta: pipelineMeta } = await fetchMergedNormalizedRows({
    mode,
    limitPerSource: options.limitPerSource,
  });

  const totalRowsBeforeRoleFilter = mergedRows.length;
  const roleFiltered = filterRowsForRoleQueue(mergedRows, parsedRole);
  const totalRowsAfterRoleFilter = roleFiltered.length;
  const roleDeduped = dedupeRoleQueueRows(roleFiltered, parsedRole);
  const totalRowsAfterRoleDedupe = roleDeduped.length;

  const { groups, ungrouped } = groupControlTowerRows(roleDeduped);
  const pageRows = paginateRows(roleDeduped, page, pageSize);
  const pageRowKeys = new Set(pageRows.map((r) => r.rowKey));
  const { groups: pagedGroups, ungrouped: pagedUngrouped } = applyBoardRowPageFilter(
    groups,
    ungrouped,
    pageRowKeys,
  );

  return {
    role: parsedRole,
    count: pageRows.length,
    rows: pageRows,
    groups: pagedGroups,
    ungrouped: pagedUngrouped,
    meta: {
      role: parsedRole,
      mode: pipelineMeta.mode ?? mode,
      sampled: pipelineMeta.sampled ?? mode === CONTROL_TOWER_ROW_MODES.SAMPLE,
      page,
      pageSize,
      totalRowsBeforeRoleFilter,
      totalRowsAfterRoleFilter,
      totalRowsAfterRoleDedupe,
      totalRows: totalRowsAfterRoleDedupe,
      generatedAt: new Date().toISOString(),
      pipeline: pipelineMeta,
    },
  };
}

module.exports = {
  ROLE_QUEUE_ROLES,
  PLANNING_STATUSES,
  COMMERCIAL_STATUSES,
  RoleQueueAccessError,
  parseRoleQueueRole,
  assertRoleQueueAccess,
  rowMatchesRoleQueue,
  filterRowsForRoleQueue,
  getControlTowerRoleQueue,
};
