/**
 * Canonical Material Issue Workspace deep-link contract (Pending Actions ↔ MI).
 * Prefer query `bucket=` (camelCase). Legacy `queue=` aliases remain accepted.
 */

import type { MaterialIssueQueueFilterKey } from "./materialIssueQueueState";
import {
  resolveIssueQueueState,
  resolveMaterialIssueQueueFilter,
} from "./materialIssueQueueState";
import type { PendingPmrSummary } from "./materialIssueWorkspace";
import type { PmrAllowanceQueueStatus } from "./rmAllowanceApprovalUx";

/** Canonical URL / PA bucket tokens. */
export type MaterialIssueBucket =
  | "readyToIssue"
  | "partiallyIssued"
  | "approvalPending"
  | "approved"
  | "rejected";

export const MATERIAL_ISSUE_BUCKETS: readonly MaterialIssueBucket[] = [
  "readyToIssue",
  "partiallyIssued",
  "approvalPending",
  "approved",
  "rejected",
] as const;

const BUCKET_TO_FILTER: Record<MaterialIssueBucket, MaterialIssueQueueFilterKey> = {
  readyToIssue: "READY",
  partiallyIssued: "PARTIAL",
  approvalPending: "PENDING",
  approved: "APPROVED",
  rejected: "REJECTED",
};

const FILTER_TO_BUCKET: Record<MaterialIssueQueueFilterKey, MaterialIssueBucket> = {
  READY: "readyToIssue",
  PARTIAL: "partiallyIssued",
  PENDING: "approvalPending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

/** Pending Action action labels → Material Issue bucket. */
export const PENDING_ACTION_TO_MI_BUCKET: Record<string, MaterialIssueBucket> = {
  "Issue Material": "readyToIssue",
  "Continue RM Issue": "partiallyIssued",
  "Issue Remaining Material": "partiallyIssued", // legacy label
  "RM Allowance Awaiting Admin": "approvalPending",
  "RM Allowance Approved": "approved",
  "RM Allowance Rejected": "rejected",
};

export type MaterialIssueDeepLinkParsed = {
  bucket: MaterialIssueBucket | null;
  filterKey: MaterialIssueQueueFilterKey;
  workOrderId: number | null;
  pmrId: number | null;
  fromPendingActions: boolean;
  returnTo: string | null;
  /** True when a valid bucket token was present. */
  bucketExplicit: boolean;
  /** True when bucket/queue was present but not a known token. */
  invalidBucketRequested: boolean;
};

function normalizeToken(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .replace(/[_-]+/g, "")
    .toLowerCase();
}

/** Parse canonical or legacy bucket/queue tokens → MaterialIssueBucket. */
export function parseMaterialIssueBucketParam(
  raw: string | null | undefined,
): MaterialIssueBucket | null {
  const t = normalizeToken(raw);
  if (!t) return null;
  if (t === "readytoissue" || t === "ready") return "readyToIssue";
  if (t === "partiallyissued" || t === "partial") return "partiallyIssued";
  if (t === "approvalpending" || t === "pending") return "approvalPending";
  if (t === "approved") return "approved";
  if (t === "rejected" || t === "rejectedrevisionrequired" || t === "revise") return "rejected";
  return null;
}

export function materialIssueBucketToFilterKey(bucket: MaterialIssueBucket): MaterialIssueQueueFilterKey {
  return BUCKET_TO_FILTER[bucket];
}

export function materialIssueFilterKeyToBucket(key: MaterialIssueQueueFilterKey): MaterialIssueBucket {
  return FILTER_TO_BUCKET[key];
}

export function serializeMaterialIssueBucket(bucket: MaterialIssueBucket): string {
  return bucket;
}

/** Pending Action group key / action label → bucket (null if not an MI action). */
export function materialIssueBucketForPendingAction(actionOrGroupKey: string): MaterialIssueBucket | null {
  const label = String(actionOrGroupKey ?? "").trim();
  if (PENDING_ACTION_TO_MI_BUCKET[label]) return PENDING_ACTION_TO_MI_BUCKET[label];
  return parseMaterialIssueBucketParam(label);
}

export function parseMaterialIssueDeepLink(
  params: URLSearchParams | Record<string, string | null | undefined>,
): MaterialIssueDeepLinkParsed {
  const get = (key: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(key);
    const v = params[key];
    return v == null || v === "" ? null : String(v);
  };
  const bucketRaw = get("bucket") ?? get("queue");
  const hadBucketRaw = Boolean(String(bucketRaw ?? "").trim());
  const bucket = parseMaterialIssueBucketParam(bucketRaw);
  const filterKey = bucket ? materialIssueBucketToFilterKey(bucket) : "READY";
  const workOrderId = Number(get("workOrderId") ?? 0);
  const pmrId = Number(get("pmrId") ?? 0);
  const returnTo = get("returnTo");
  const from = get("from") ?? get("source");
  const fromPendingActions =
    String(returnTo ?? "").toLowerCase() === "pending-actions" ||
    String(from ?? "").toLowerCase() === "pending-actions";

  return {
    bucket,
    filterKey,
    workOrderId: Number.isFinite(workOrderId) && workOrderId > 0 ? workOrderId : null,
    pmrId: Number.isFinite(pmrId) && pmrId > 0 ? pmrId : null,
    fromPendingActions,
    returnTo,
    bucketExplicit: Boolean(bucket),
    invalidBucketRequested: hadBucketRaw && !bucket,
  };
}

export type MaterialIssueDeepLinkBuildInput = {
  bucket?: MaterialIssueBucket | null;
  workOrderId?: number | null;
  pmrId?: number | null;
  returnTo?: string | null;
  from?: string | null;
  salesOrderId?: number | null;
  requirementSheetId?: number | null;
  allowanceApprovalId?: number | null;
  /** When true (default for PA), set from=pending-actions if returnTo is pending-actions. */
  listOnly?: boolean;
};

/** Build `/material-issue?...` with canonical `bucket=` (and optional WO/PMR). */
export function buildMaterialIssueDeepLink(input: MaterialIssueDeepLinkBuildInput): string {
  const qs = new URLSearchParams();
  if (input.bucket) qs.set("bucket", serializeMaterialIssueBucket(input.bucket));
  if (!input.listOnly) {
    const wo = Number(input.workOrderId ?? 0);
    const pmr = Number(input.pmrId ?? 0);
    if (wo > 0) qs.set("workOrderId", String(wo));
    if (pmr > 0) qs.set("pmrId", String(pmr));
  }
  if (input.salesOrderId != null && Number(input.salesOrderId) > 0) {
    qs.set("salesOrderId", String(input.salesOrderId));
  }
  if (input.requirementSheetId != null && Number(input.requirementSheetId) > 0) {
    qs.set("requirementSheetId", String(input.requirementSheetId));
  }
  if (input.allowanceApprovalId != null && Number(input.allowanceApprovalId) > 0) {
    qs.set("allowanceApprovalId", String(input.allowanceApprovalId));
  }
  const returnTo = input.returnTo?.trim() || null;
  const from = input.from?.trim() || null;
  if (returnTo) qs.set("returnTo", returnTo);
  if (from) qs.set("from", from);
  else if (returnTo === "pending-actions") qs.set("from", "pending-actions");
  const q = qs.toString();
  return q ? `/material-issue?${q}` : "/material-issue";
}

/** Ensure an MI href carries the bucket for a Pending Action group (Open List). */
export function appendMaterialIssueBucketToHref(href: string, groupKey: string): string {
  const bucket = materialIssueBucketForPendingAction(groupKey);
  if (!bucket) return href;
  try {
    const url = new URL(href, "http://erp.local");
    if (!url.pathname.includes("/material-issue")) return href;
    url.searchParams.set("bucket", serializeMaterialIssueBucket(bucket));
    url.searchParams.delete("queue");
    if (!url.searchParams.has("returnTo") && !url.searchParams.has("from")) {
      url.searchParams.set("returnTo", "pending-actions");
      url.searchParams.set("from", "pending-actions");
    }
    return `${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return href;
  }
}

/** Compute which sidebar filter a pending PMR belongs to. */
export function resolvePmrMaterialIssueBucket(pmr: PendingPmrSummary): MaterialIssueBucket {
  const allowance = (pmr.allowanceStatus as PmrAllowanceQueueStatus | undefined) ?? "NONE";
  const filter = resolveMaterialIssueQueueFilter({
    allowanceStatus: allowance,
    issueQueueState: resolveIssueQueueState(pmr),
  });
  return materialIssueFilterKeyToBucket(filter);
}

export type MaterialIssueTargetResolveResult =
  | { ok: true; pmr: PendingPmrSummary; bucket: MaterialIssueBucket }
  | {
      ok: false;
      reason: "NOT_FOUND" | "WRONG_BUCKET" | "UNAUTHORIZED" | "STALE_ALLOWANCE";
      message: string;
      actualBucket?: MaterialIssueBucket | null;
      pmr?: PendingPmrSummary | null;
    };

const STALE_ALLOWANCE_MESSAGE =
  "This allowance request is no longer pending because the material issue has already been completed.";

/** Resolve WO/PMR against the requested bucket after queue data is loaded. */
export function resolveMaterialIssueDeepLinkTarget(input: {
  requestedBucket: MaterialIssueBucket;
  workOrderId?: number | null;
  pmrId?: number | null;
  pmrs: PendingPmrSummary[];
  /** When deep-link came from an allowance Pending Action / rejected bucket. */
  fromAllowanceAction?: boolean;
}): MaterialIssueTargetResolveResult {
  const pmrId = Number(input.pmrId ?? 0);
  const woId = Number(input.workOrderId ?? 0);
  let pmr: PendingPmrSummary | undefined;
  if (pmrId > 0) {
    pmr = input.pmrs.find((p) => Number(p.id) === pmrId);
  } else if (woId > 0) {
    const forWo = input.pmrs.filter((p) => Number(p.workOrderId) === woId);
    pmr = forWo.sort((a, b) => b.id - a.id)[0];
  }
  if (!pmr) {
    const fromAllowance =
      input.fromAllowanceAction === true ||
      input.requestedBucket === "rejected" ||
      input.requestedBucket === "approved" ||
      input.requestedBucket === "approvalPending";
    return {
      ok: false,
      reason: fromAllowance ? "STALE_ALLOWANCE" : "NOT_FOUND",
      message: fromAllowance
        ? STALE_ALLOWANCE_MESSAGE
        : "That work order or material request is no longer available for Material Issue.",
      actualBucket: null,
      pmr: null,
    };
  }
  const actual = resolvePmrMaterialIssueBucket(pmr);
  if (actual !== input.requestedBucket) {
    return {
      ok: false,
      reason: "WRONG_BUCKET",
      message: `This request is now in “${bucketDisplayLabel(actual)}”, not “${bucketDisplayLabel(input.requestedBucket)}”.`,
      actualBucket: actual,
      pmr,
    };
  }
  return { ok: true, pmr, bucket: actual };
}

export function bucketDisplayLabel(bucket: MaterialIssueBucket): string {
  switch (bucket) {
    case "readyToIssue":
      return "Ready to Issue";
    case "partiallyIssued":
      return "Partially Issued";
    case "approvalPending":
      return "Approval Pending";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected / Revision Required";
    default:
      return bucket;
  }
}
