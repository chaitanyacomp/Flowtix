/**
 * Control Tower operational board groups (Prompt 5, 6C).
 * Maps normalized currentStatus values into approved swimlanes.
 */

const { CONTROL_TOWER_STATUSES } = require("./controlTowerStatusMap");

const BOARD_GROUP_KEYS = Object.freeze({
  RM_READINESS: "RM_READINESS",
  PRODUCTION: "PRODUCTION",
  QUALITY: "QUALITY",
  DISPATCH: "DISPATCH",
  COMMERCIAL_CLOSURE: "COMMERCIAL_CLOSURE",
  PLANNING: "PLANNING",
});

/** @type {ReadonlyArray<{ groupKey: string; label: string; ownerRole: string; statusList: readonly string[]; order: number }>} */
const CONTROL_TOWER_BOARD_GROUPS = Object.freeze([
  {
    groupKey: BOARD_GROUP_KEYS.RM_READINESS,
    label: "RM & Readiness",
    ownerRole: "STORE",
    statusList: Object.freeze([
      CONTROL_TOWER_STATUSES.WAITING_RM,
      CONTROL_TOWER_STATUSES.PROCUREMENT_IN_PROGRESS,
      CONTROL_TOWER_STATUSES.RM_READY_FOR_ISSUE,
      CONTROL_TOWER_STATUSES.WO_RELEASE_READY,
    ]),
    order: 1,
  },
  {
    groupKey: BOARD_GROUP_KEYS.PRODUCTION,
    label: "Production",
    ownerRole: "PRODUCTION",
    statusList: Object.freeze([
      CONTROL_TOWER_STATUSES.PRODUCTION_PENDING,
      CONTROL_TOWER_STATUSES.PRODUCTION_ON_HOLD,
    ]),
    order: 2,
  },
  {
    groupKey: BOARD_GROUP_KEYS.QUALITY,
    label: "Quality",
    ownerRole: "QA",
    statusList: Object.freeze([
      CONTROL_TOWER_STATUSES.QA_PENDING,
      CONTROL_TOWER_STATUSES.QA_REWORK_PENDING,
    ]),
    order: 3,
  },
  {
    groupKey: BOARD_GROUP_KEYS.DISPATCH,
    label: "Dispatch",
    ownerRole: "STORE",
    statusList: Object.freeze([
      CONTROL_TOWER_STATUSES.DISPATCH_PENDING,
      CONTROL_TOWER_STATUSES.DISPATCH_DRAFT_PENDING,
    ]),
    order: 4,
  },
  {
    groupKey: BOARD_GROUP_KEYS.COMMERCIAL_CLOSURE,
    label: "Commercial Closure",
    ownerRole: "ADMIN",
    statusList: Object.freeze([
      CONTROL_TOWER_STATUSES.BILLING_PENDING,
      CONTROL_TOWER_STATUSES.NEXT_RS_READY,
      CONTROL_TOWER_STATUSES.EXPORT_PENDING,
      CONTROL_TOWER_STATUSES.PAYMENT_PENDING,
    ]),
    order: 5,
  },
  {
    groupKey: BOARD_GROUP_KEYS.PLANNING,
    label: "Planning",
    ownerRole: "STORE",
    statusList: Object.freeze([
      CONTROL_TOWER_STATUSES.PLANNING_PENDING,
      CONTROL_TOWER_STATUSES.WO_PLANNING_PENDING,
    ]),
    order: 6,
  },
]);

/** @type {Map<string, string>} */
const STATUS_TO_BOARD_GROUP = (() => {
  const map = new Map();
  for (const def of CONTROL_TOWER_BOARD_GROUPS) {
    for (const status of def.statusList) {
      map.set(status, def.groupKey);
    }
  }
  return map;
})();

/**
 * @param {unknown[]} rows — deduped normalized Control Tower rows
 * @returns {{
 *   groups: Array<{ groupKey: string; label: string; ownerRole: string; order: number; count: number; rows: object[] }>;
 *   ungrouped: object[];
 * }}
 */
function groupControlTowerRows(rows) {
  const list = Array.isArray(rows) ? rows : [];

  /** @type {Map<string, object[]>} */
  const buckets = new Map();
  for (const def of CONTROL_TOWER_BOARD_GROUPS) {
    buckets.set(def.groupKey, []);
  }

  const ungrouped = [];

  for (const row of list) {
    const status = String(row?.currentStatus ?? "");
    const groupKey = STATUS_TO_BOARD_GROUP.get(status);
    if (groupKey && buckets.has(groupKey)) {
      buckets.get(groupKey).push(row);
    } else {
      ungrouped.push(row);
    }
  }

  const groups = CONTROL_TOWER_BOARD_GROUPS.map((def) => {
    const groupRows = buckets.get(def.groupKey) ?? [];
    return {
      groupKey: def.groupKey,
      label: def.label,
      ownerRole: def.ownerRole,
      order: def.order,
      count: groupRows.length,
      rows: groupRows,
    };
  });

  return { groups, ungrouped };
}

module.exports = {
  BOARD_GROUP_KEYS,
  CONTROL_TOWER_BOARD_GROUPS,
  STATUS_TO_BOARD_GROUP,
  groupControlTowerRows,
};
