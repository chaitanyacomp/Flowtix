import type { PendingAction, PendingActionPriority } from "./pendingActionsApi";
import { resolveGreenLevelPendingActionHref } from "./greenLevelWoPlacementNavigation";
import {
  buildCreateSalesBillWorkQueue,
  isCreateSalesBillPendingBucket,
  PENDING_ACTION_CREATE_SALES_BILL_KEY,
  withWorkQueueState,
  type WorkQueueContext,
} from "./workQueueContext";
import {
  buildPendingActionsProductionOverviewHref,
  toProductionWorkspaceOverviewFromHref,
} from "./productionWorkspaceRouteContract";
import {
  appendMaterialIssueBucketToHref,
  materialIssueBucketForPendingAction,
} from "./materialIssueDeepLink";

const READY_TO_DISPATCH_PREFIX = "Ready to Dispatch";
const DISPATCH_DRAFT_PREFIX = "Finalize Dispatch Draft";
const DISPATCH_DELIVERY_DUE_PREFIX = "Delivery Due — Dispatch";
const DISPATCH_PENDING_LABEL = "Dispatch Pending";

export type PendingActionBucketPreviewLine = {
  documentNo: string;
  detail?: string | null;
};

export type PendingActionWorkBucket = {
  key: string;
  actionType: string;
  title: string;
  count: number;
  items: PendingAction[];
  previewLines: PendingActionBucketPreviewLine[];
  overflowCount: number;
  topPriority: PendingActionPriority;
  maxAgeHours: number | null;
  ownerRole: string;
  listHref: string;
  openHref: string;
  openLabel: string;
};

const PREVIEW_LIMIT = 3;

const PRIORITY_RANK: Record<PendingActionPriority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** Normalize backend action label into a stable group key. */
export function resolvePendingActionGroupKey(action: PendingAction): string {
  const label = String(action.action ?? "").trim();
  if (label.startsWith(READY_TO_DISPATCH_PREFIX)) return "READY_TO_DISPATCH";
  if (label.startsWith(DISPATCH_DRAFT_PREFIX)) return "DISPATCH_DRAFT";
  if (label.startsWith(DISPATCH_DELIVERY_DUE_PREFIX)) return "DISPATCH_DELIVERY_DUE";
  if (label === DISPATCH_PENDING_LABEL || label === "Dispatch") return "READY_TO_DISPATCH";
  return label || "UNKNOWN";
}

/** Human title for a group key / representative action. */
export function resolvePendingActionGroupTitle(groupKey: string, sampleAction?: string): string {
  if (groupKey === "READY_TO_DISPATCH" || groupKey === "DISPATCH_DRAFT" || groupKey === "DISPATCH_DELIVERY_DUE") {
    return READY_TO_DISPATCH_PREFIX;
  }
  const label = String(sampleAction ?? groupKey).trim();
  return label || "Pending work";
}

export function parseReadyToDispatchQty(actionLabel: string): string | null {
  const match = String(actionLabel ?? "").match(/—\s*Qty\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export function buildPendingActionPreviewLine(row: PendingAction): PendingActionBucketPreviewLine {
  const doc = String(row.documentNo ?? "").trim() || "—";
  if (String(row.action ?? "").trim() === PENDING_ACTION_CREATE_SALES_BILL_KEY) {
    const dispatchOnly = doc.split(" · ")[0]?.trim() || doc;
    return { documentNo: dispatchOnly };
  }
  if (
    String(row.action ?? "").startsWith(READY_TO_DISPATCH_PREFIX) ||
    String(row.action ?? "").startsWith(DISPATCH_DRAFT_PREFIX) ||
    String(row.action ?? "").startsWith(DISPATCH_DELIVERY_DUE_PREFIX)
  ) {
    const qty = parseReadyToDispatchQty(row.action);
    return { documentNo: doc, detail: qty ? `Dispatchable Qty: ${qty}` : null };
  }
  const parts = doc.split(" · ").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      documentNo: parts[0],
      detail: parts.slice(1).join(" · "),
    };
  }
  return { documentNo: doc };
}

/** Strip document-specific params; keep workspace navigation context. */
export function pendingActionWorkspaceListHref(href: string): string {
  try {
    const url = new URL(href, "http://erp.local");
    const path = url.pathname;
    if (path === "/production-release") {
      const params = new URLSearchParams();
      const from = url.searchParams.get("from") ?? "pending-actions";
      params.set("from", from);
      return `/production-release?${params.toString()}`;
    }
    /**
     * Production multi-item / list open must match left-menu overview semantics:
     * keep productionBucket + pending-actions return — never pin SO/cycle/flow/WO
     * (that reuses a completed sibling and shows "Production entry completed for this cycle").
     */
    if (path.endsWith("/production")) {
      const bucket = url.searchParams.get("productionBucket");
      const section = url.searchParams.get("pwSection");
      const focus = url.searchParams.get("pwFocus");
      const qs = new URLSearchParams();
      if (bucket) qs.set("productionBucket", bucket);
      if (section) qs.set("pwSection", section);
      if (focus) qs.set("pwFocus", focus);
      qs.set("from", "pending-actions");
      return toProductionWorkspaceOverviewFromHref(`/production?${qs.toString()}`);
    }
    /**
     * Material Issue Open List: keep canonical `bucket` (or legacy `queue`) so the
     * correct side-queue activates — strip WO/PMR so no arbitrary card is preselected.
     */
    if (path.includes("/material-issue")) {
      const qs = new URLSearchParams();
      const bucket =
        url.searchParams.get("bucket") ||
        url.searchParams.get("queue");
      if (bucket) qs.set("bucket", bucket);
      qs.set("returnTo", url.searchParams.get("returnTo") || "pending-actions");
      qs.set("from", url.searchParams.get("from") || "pending-actions");
      return `/material-issue?${qs.toString()}`;
    }
    const params = new URLSearchParams();
    const preserveKeys = [
      "returnTo",
      "from",
      "source",
      "onlyBlocked",
      "demandPool",
      "focus",
      "planId",
      "monthlyPlanId",
      "period",
      "openAdditionalPlan",
    ];
    // NO_QTY WO placement / RS execution: never drop explicit RS identity (FT-PD-040 §7.10).
    if (path.includes("/requirement-sheets")) {
      preserveKeys.push("sheetId", "requirementSheetId", "cycleId", "salesOrderId");
    }
    for (const key of preserveKeys) {
      const v = url.searchParams.get(key);
      if (v != null && v !== "") params.set(key, v);
    }
    if (!params.has("returnTo") && !params.has("from") && !params.has("source")) {
      if (path.includes("/dispatch")) params.set("source", "pending-actions");
      else params.set("from", "pending-actions");
    }
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  } catch {
    return href;
  }
}

function appendProductionWorkspaceBucket(href: string, groupKey: string): string {
  if (groupKey !== "Ready to Start Production" && groupKey !== "Continue Production") return href;
  const bucket = groupKey === "Ready to Start Production" ? "readyToStart" : "inProgress";
  try {
    const url = new URL(href, "http://erp.local");
    if (!url.pathname.endsWith("/production")) return href;
    // Multi-WO / list path already overview-normalized; ensure correct tab + bucket.
    return buildPendingActionsProductionOverviewHref(bucket);
  } catch {
    return href;
  }
}

/** Ensure Material Issue list/item hrefs carry the canonical bucket for the PA group. */
function appendMaterialIssueWorkspaceBucket(href: string, groupKey: string): string {
  if (!materialIssueBucketForPendingAction(groupKey)) return href;
  return appendMaterialIssueBucketToHref(href, groupKey);
}

/**
 * Ready to Start (single): Workbench Ready tab + focused card (pwFocus), not a scoped process.
 * Continue Production (single): keep WO deep-link so the executable remaining-balance screen opens.
 */
function ensureSingleProductionPendingHref(href: string, groupKey: string): string {
  if (groupKey !== "Ready to Start Production" && groupKey !== "Continue Production") return href;
  const bucket = groupKey === "Ready to Start Production" ? "readyToStart" : "inProgress";
  try {
    const url = new URL(href, "http://erp.local");
    if (!url.pathname.endsWith("/production")) return href;
    const woId = Number(url.searchParams.get("workOrderId") ?? url.searchParams.get("woId") ?? 0);

    if (groupKey === "Ready to Start Production") {
      return buildPendingActionsProductionOverviewHref(bucket, {
        pwFocus: Number.isFinite(woId) && woId > 0 ? woId : null,
      });
    }

    // Continue: scoped executable process + Continuity tokens.
    url.searchParams.set("productionBucket", bucket);
    url.searchParams.set("pwSection", "active");
    if (!url.searchParams.has("from")) {
      url.searchParams.set("from", url.searchParams.get("returnTo") ?? "pending-actions");
    }
    if (!url.searchParams.has("returnTo")) {
      url.searchParams.set("returnTo", "pending-actions");
    }
    return `${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return href;
  }
}

function bucketTitle(count: number, actionType: string, groupKey: string): string {
  const base = actionType;
  if (groupKey === "READY_TO_DISPATCH" || groupKey === "DISPATCH_DRAFT" || groupKey === "DISPATCH_DELIVERY_DUE") {
    return `${READY_TO_DISPATCH_PREFIX} (${count} ${count === 1 ? "Item" : "Items"})`;
  }
  return `${base} (${count})`;
}

function bucketOpenLabel(groupKey: string, count: number): string {
  if (groupKey === "READY_TO_DISPATCH" || groupKey === "DISPATCH_DRAFT" || groupKey === "DISPATCH_DELIVERY_DUE") {
    return "Open Dispatch";
  }
  if (groupKey === "Place Partial WO" || groupKey === "Place WO") {
    return "Place WO";
  }
  if (groupKey === "Ready to Start Production" || groupKey === "Continue Production") {
    return "Open Production Workspace";
  }
  return count === 1 ? "Open" : "Open List";
}

function compareBuckets(
  a: PendingActionWorkBucket,
  b: PendingActionWorkBucket,
  sortMode: "priority" | "age" = "priority",
): number {
  if (sortMode === "age") {
    const aa = a.maxAgeHours != null ? Number(a.maxAgeHours) : -1;
    const ab = b.maxAgeHours != null ? Number(b.maxAgeHours) : -1;
    if (aa !== ab) return ab - aa;
  }
  const pr =
    (PRIORITY_RANK[a.topPriority] ?? 99) - (PRIORITY_RANK[b.topPriority] ?? 99);
  if (pr !== 0) return pr;
  const aa = a.maxAgeHours != null ? Number(a.maxAgeHours) : -1;
  const ab = b.maxAgeHours != null ? Number(b.maxAgeHours) : -1;
  if (aa !== ab) return ab - aa;
  return a.actionType.localeCompare(b.actionType);
}

export function groupPendingActionsIntoWorkBuckets(
  rows: PendingAction[],
  sortMode: "priority" | "age" = "priority",
): PendingActionWorkBucket[] {
  const groups = new Map<string, PendingAction[]>();
  for (const row of rows) {
    const key = resolvePendingActionGroupKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const buckets: PendingActionWorkBucket[] = [];
  for (const [key, items] of groups) {
    const actionType = resolvePendingActionGroupTitle(key, items[0]?.action);
    const count = items.length;
    const previewItems = items.slice(0, PREVIEW_LIMIT);
    const previewLines = previewItems.map(buildPendingActionPreviewLine);
    const overflowCount = Math.max(0, count - PREVIEW_LIMIT);

    let topPriority: PendingActionPriority = "LOW";
    let maxAgeHours: number | null = null;
    for (const item of items) {
      if ((PRIORITY_RANK[item.priority] ?? 99) < (PRIORITY_RANK[topPriority] ?? 99)) {
        topPriority = item.priority;
      }
      if (item.ageHours != null && Number.isFinite(Number(item.ageHours))) {
        const h = Number(item.ageHours);
        if (maxAgeHours == null || h > maxAgeHours) maxAgeHours = h;
      }
    }

    const rawHref = items[0]?.href ?? "/pending-actions";
    const listHref = appendMaterialIssueWorkspaceBucket(
      appendProductionWorkspaceBucket(
        pendingActionWorkspaceListHref(
          resolveGreenLevelPendingActionHref(rawHref, items[0]?.action),
        ),
        key,
      ),
      key,
    );
    const openHref =
      count === 1 || isCreateSalesBillPendingBucket(key)
        ? appendMaterialIssueWorkspaceBucket(
            ensureSingleProductionPendingHref(
              resolveGreenLevelPendingActionHref(items[0]?.href ?? listHref, items[0]?.action),
              key,
            ),
            key,
          )
        : listHref;

    buckets.push({
      key,
      actionType,
      title: bucketTitle(count, actionType, key),
      count,
      items,
      previewLines,
      overflowCount,
      topPriority,
      maxAgeHours,
      ownerRole: items[0]?.ownerRole ?? "",
      listHref,
      openHref,
      openLabel: bucketOpenLabel(key, count),
    });
  }

  return buckets.sort((a, b) => compareBuckets(a, b, sortMode));
}

/** Navigation state when opening a pending-actions work bucket (sales bill queue). */
export function pendingActionsBucketNavigateState(
  bucket: PendingActionWorkBucket,
): { workQueue?: WorkQueueContext } | undefined {
  if (!isCreateSalesBillPendingBucket(bucket.key) || bucket.count < 1) return undefined;
  const workQueue = buildCreateSalesBillWorkQueue(bucket.items);
  return workQueue ? withWorkQueueState(workQueue) : undefined;
}
