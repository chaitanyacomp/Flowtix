/**
 * Retention for AUTOMATIC backups only.
 * Keep: 14 latest daily + 8 weekly + 12 monthly recovery points.
 * Never delete MANUAL / DEPLOYMENT / PRE_RESTORE_AUTO.
 * Never delete the latest successful backup (any type).
 * Never delete FAILED rows (remain visible).
 */
const DEFAULT_DAILY = 14;
const DEFAULT_WEEKLY = 8;
const DEFAULT_MONTHLY = 12;

const PROTECTED_TYPES = new Set(["MANUAL", "DEPLOYMENT", "PRE_RESTORE_AUTO"]);

/**
 * @param {Date|string|number} d
 * @returns {Date}
 */
function asDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  return Number.isFinite(x.getTime()) ? x : new Date(0);
}

function dayKey(d) {
  const x = asDate(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekKey(d) {
  const x = asDate(d);
  // ISO week
  const t = new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function monthKey(d) {
  const x = asDate(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * @param {Array<{ id: number; backupType: string; status: string; createdAt: Date|string; fileName?: string; filePath?: string }>} rows
 * @param {{ daily?: number; weekly?: number; monthly?: number; now?: Date }} [policy]
 * @returns {{ keepIds: Set<number>; deleteIds: number[]; reasons: Record<number, string> }}
 */
function planAutomaticRetention(rows, policy = {}) {
  const dailyN = policy.daily ?? DEFAULT_DAILY;
  const weeklyN = policy.weekly ?? DEFAULT_WEEKLY;
  const monthlyN = policy.monthly ?? DEFAULT_MONTHLY;

  const keepIds = new Set();
  const reasons = {};

  const successful = (rows || []).filter((r) => r && r.status === "CREATED");
  successful.sort((a, b) => asDate(b.createdAt) - asDate(a.createdAt));

  // Never delete the latest successful backup (any type).
  if (successful[0]) {
    keepIds.add(successful[0].id);
    reasons[successful[0].id] = "latest-successful";
  }

  // Protect non-automatic types always
  for (const r of rows || []) {
    if (PROTECTED_TYPES.has(r.backupType)) {
      keepIds.add(r.id);
      reasons[r.id] = reasons[r.id] || `protected-type:${r.backupType}`;
    }
    if (r.status === "FAILED" || r.status === "RESTORED") {
      keepIds.add(r.id);
      reasons[r.id] = reasons[r.id] || `protected-status:${r.status}`;
    }
  }

  const automaticOk = successful
    .filter((r) => r.backupType === "AUTOMATIC")
    .sort((a, b) => asDate(b.createdAt) - asDate(a.createdAt));

  // Daily: one newest per calendar day, up to dailyN distinct days
  const daysSeen = new Set();
  for (const r of automaticOk) {
    if (daysSeen.size >= dailyN) break;
    const k = dayKey(r.createdAt);
    if (daysSeen.has(k)) continue;
    daysSeen.add(k);
    keepIds.add(r.id);
    reasons[r.id] = reasons[r.id] ? `${reasons[r.id]}+daily` : "daily";
  }

  // Weekly
  const weeksSeen = new Set();
  for (const r of automaticOk) {
    if (weeksSeen.size >= weeklyN) break;
    const k = weekKey(r.createdAt);
    if (weeksSeen.has(k)) continue;
    weeksSeen.add(k);
    keepIds.add(r.id);
    reasons[r.id] = reasons[r.id] ? `${reasons[r.id]}+weekly` : "weekly";
  }

  // Monthly
  const monthsSeen = new Set();
  for (const r of automaticOk) {
    if (monthsSeen.size >= monthlyN) break;
    const k = monthKey(r.createdAt);
    if (monthsSeen.has(k)) continue;
    monthsSeen.add(k);
    keepIds.add(r.id);
    reasons[r.id] = reasons[r.id] ? `${reasons[r.id]}+monthly` : "monthly";
  }

  const deleteIds = automaticOk.filter((r) => !keepIds.has(r.id)).map((r) => r.id);

  return { keepIds, deleteIds, reasons };
}

function retentionPolicySummary() {
  return {
    automaticOnly: true,
    dailyRecoveryPoints: DEFAULT_DAILY,
    weeklyRecoveryPoints: DEFAULT_WEEKLY,
    monthlyRecoveryPoints: DEFAULT_MONTHLY,
    protectedTypes: ["MANUAL", "DEPLOYMENT", "PRE_RESTORE_AUTO"],
    neverDeleteLatestSuccessful: true,
    neverDeleteFailedRows: true,
  };
}

module.exports = {
  DEFAULT_DAILY,
  DEFAULT_WEEKLY,
  DEFAULT_MONTHLY,
  PROTECTED_TYPES,
  planAutomaticRetention,
  retentionPolicySummary,
  dayKey,
  weekKey,
  monthKey,
};
