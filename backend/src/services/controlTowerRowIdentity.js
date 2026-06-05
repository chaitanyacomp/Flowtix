/**
 * Control Tower row identity and deduplication (Prompt 4).
 * Stable rowKey per operational object; collapse duplicate feeds by source priority.
 */

const CONTROL_TOWER_SOURCE_PRIORITY = Object.freeze({
  RM_RISK: 100,
  PRODUCTION_QUEUE: 90,
  QA_REWORK: 85,
  QA_QUEUE: 80,
  DISPATCH_BACKLOG: 70,
  CONTINUE_WORKING: 50,
  NO_QTY_PLANNING: 45,
  WO_PLANNING: 45,
});

function positiveId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * @param {string} rowType
 * @returns {number}
 */
function getSourcePriorityForRowType(rowType) {
  const key = String(rowType ?? "");
  if (key in CONTROL_TOWER_SOURCE_PRIORITY) {
    return CONTROL_TOWER_SOURCE_PRIORITY[key];
  }
  return 0;
}

/**
 * Stable identity for deduplication — prefer parsed sourceId / metadata, never array index.
 * @param {object} row — normalized Control Tower row
 * @returns {string}
 */
function buildControlTowerRowKey(row) {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const sourceId = String(row?.sourceId ?? "");
  const orderType = String(meta.orderType ?? "").toUpperCase();

  let m = /^production:wo:(\d+):line:(\d+)$/.exec(sourceId);
  if (m) return `WORK_ORDER:${m[1]}`;

  m = /^rm-risk:wo:(\d+):rm:\d+$/.exec(sourceId);
  if (m) return `WORK_ORDER:${m[1]}`;

  m = /^rm-risk:so:(\d+):rm:\d+$/.exec(sourceId);
  if (m) {
    const soId = m[1];
    const cycleId = positiveId(meta.cycleId);
    if (orderType === "NO_QTY" && cycleId != null) return `NO_QTY:${soId}:CYCLE:${cycleId}`;
    return `SALES_ORDER:${soId}`;
  }

  m = /^qa:pe:(\d+)$/.exec(sourceId);
  if (m) {
    const woId = positiveId(meta.workOrderId);
    if (woId != null) return `WORK_ORDER:${woId}`;
    return `PRODUCTION_BATCH:${m[1]}`;
  }

  m = /^qa:wo:(\d+)$/.exec(sourceId);
  if (m) return `WORK_ORDER:${m[1]}`;

  m = /^qa-rework:disp:(\d+)$/.exec(sourceId);
  if (m) return `QA_REWORK:${m[1]}`;

  m = /^no-qty-planning:so:(\d+):cycle:(\d+)$/.exec(sourceId);
  if (m) {
    const soId = m[1];
    const cycleId = Number(m[2]);
    if (orderType === "NO_QTY" && Number.isFinite(cycleId) && cycleId > 0) {
      return `NO_QTY:${soId}:CYCLE:${cycleId}`;
    }
    return `SALES_ORDER:${soId}`;
  }

  m = /^wo-planning:so:(\d+)$/.exec(sourceId);
  if (m) return `SALES_ORDER:${m[1]}`;

  m = /^dispatch:so:(\d+):item:(\d+):cycle:(\d+)$/.exec(sourceId);
  if (m) {
    const soId = m[1];
    const itemId = m[2];
    const cycleId = Number(m[3]);
    if (orderType === "NO_QTY" && Number.isFinite(cycleId) && cycleId > 0) {
      return `NO_QTY:${soId}:CYCLE:${cycleId}:ITEM:${itemId}`;
    }
    return `DISPATCH:${soId}:ITEM:${itemId}`;
  }

  if (sourceId.startsWith("continue:")) {
    const woIdContinue = positiveId(meta.workOrderId);
    if (woIdContinue != null) return `WORK_ORDER:${woIdContinue}`;
    const soId = positiveId(meta.salesOrderId);
    const cycleId = positiveId(meta.cycleId);
    if (soId != null && orderType === "NO_QTY" && cycleId != null) {
      return `NO_QTY:${soId}:CYCLE:${cycleId}`;
    }
    if (soId != null) return `SALES_ORDER:${soId}`;
  }

  const woId = positiveId(meta.workOrderId);
  if (woId != null) return `WORK_ORDER:${woId}`;

  const soId = positiveId(meta.salesOrderId);
  if (soId != null) {
    const cycleId = positiveId(meta.cycleId);
    if (orderType === "NO_QTY" && cycleId != null) return `NO_QTY:${soId}:CYCLE:${cycleId}`;
    return `SALES_ORDER:${soId}`;
  }

  const moduleKey = String(row?.sourceModule ?? row?.rowType ?? "UNKNOWN");
  return `SOURCE:${moduleKey}:${sourceId || "unknown"}`;
}

/**
 * Attach rowKey and sourcePriority to a normalized row.
 * @param {object} row
 * @returns {object}
 */
function attachRowIdentity(row) {
  const rowKey = buildControlTowerRowKey(row);
  const sourcePriority = getSourcePriorityForRowType(row.rowType);
  return {
    ...row,
    rowKey,
    sourcePriority,
  };
}

/**
 * Collapse rows sharing the same rowKey; keep highest sourcePriority row.
 * @param {object[]} rows — normalized rows (rowKey optional)
 * @returns {object[]}
 */
function dedupeNormalizedRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  /** @type {Map<string, object[]>} */
  const groups = new Map();

  for (const row of list) {
    const enriched = attachRowIdentity(row);
    const key = enriched.rowKey;
    const bucket = groups.get(key) ?? [];
    bucket.push(enriched);
    groups.set(key, bucket);
  }

  const out = [];
  for (const group of groups.values()) {
    group.sort((a, b) => b.sourcePriority - a.sourcePriority);
    const winner = group[0];
    const duplicateSources = group.map((r) => String(r.rowType));
    out.push({
      ...winner,
      metadata: {
        ...winner.metadata,
        duplicateSources,
      },
    });
  }

  return out;
}

module.exports = {
  CONTROL_TOWER_SOURCE_PRIORITY,
  getSourcePriorityForRowType,
  buildControlTowerRowKey,
  attachRowIdentity,
  dedupeNormalizedRows,
};
