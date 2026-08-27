/**
 * Machine Shift Session API client (Step 4A execution surface).
 */
import { apiFetch } from "../services/api";

/** Matches backend SHIFT_REPORT_PRODUCTION_LOCKED message. */
export const SHIFT_REPORT_PRODUCTION_LOCKED_MESSAGE =
  "Shift Report has already been submitted. Production quantities cannot change unless the report is returned or the shift is reopened.";

export const SHIFT_REPORT_PRODUCTION_LOCKED_UI =
  "Shift Report submitted — production quantities are locked pending manager review.";

export type ShiftCapabilities = {
  canView: boolean;
  canPerformManagerActions: boolean;
  /** Pause/resume production downtime — always for PRODUCTION/ADMIN/PM. */
  canPauseProduction?: boolean;
  productionManagerAssigned: boolean;
  isFallbackControl: boolean;
};

export type ShiftBrief = {
  id: number;
  shiftCode?: string | null;
  shiftName?: string | null;
};

export type MachineBrief = {
  id: number;
  machineCode?: string | null;
  machineName?: string | null;
};

export type OperatorBrief = {
  id: number;
  operatorCode?: string | null;
  operatorName?: string | null;
};

export type ShiftParticipation = {
  id: number;
  operator: OperatorBrief | null;
  isPrimary: boolean;
  joinedAt: string | null;
  leftAt: string | null;
  changeReason?: string | null;
};

export type ShiftRunSegment = {
  id: number;
  segmentNo: number;
  status: string;
  workOrderId: number | null;
  workOrderDocNo: string | null;
  runAllocationId: number | null;
  startedAt: string | null;
  closedAt: string | null;
  closeReason?: string | null;
};

export type ShiftDowntimeSegment = {
  id: number;
  sessionId: number;
  segmentStartAt: string | null;
  segmentEndAt: string | null;
  remarks?: string | null;
};

export type ShiftDowntimeIncident = {
  id: number;
  reason: string;
  startedAt: string | null;
  endedAt: string | null;
  remarks?: string | null;
  runSegmentId?: number | null;
  segments: ShiftDowntimeSegment[];
};

export type ShiftReportLine = {
  id?: number;
  runSegmentId: number;
  itemId: number;
  itemName?: string | null;
  itemLabel?: string | null;
  workOrderId?: number | null;
  workOrderNo?: string | null;
  runSegmentLabel?: string | null;
  runSegmentNo?: number | null;
  grossOutputQty: number;
  productionScrapQty: number;
  qtySentToQc: number;
  remarks?: string | null;
  pendingDraftCount?: number;
  pendingDraftQty?: number;
};

export type ShiftReportVersion = {
  id: number;
  versionNo: number;
  status: string;
  previousVersionId?: number | null;
  declaredOperator?: OperatorBrief | null;
  declaredByUserId?: number | null;
  declaredAt?: string | null;
  submittedAt?: string | null;
  submittedByUserId?: number | null;
  returnedAt?: string | null;
  returnedByUserId?: number | null;
  returnReason?: string | null;
  verifiedAt?: string | null;
  verifiedByUserId?: number | null;
  grossOutputQty: number;
  productionScrapQty: number;
  qtySentToQc: number;
  remarks?: string | null;
  zeroProductionReason?: string | null;
  zeroProductionRemarks?: string | null;
  pendingDraftCount?: number;
  pendingDraftQty?: number;
  lines: ShiftReportLine[];
};

export type ShiftReopenRequest = {
  id: number;
  status: string;
  reopenReason: string;
  requestedAt: string | null;
  requestedByUserId: number | null;
  requestedByName?: string | null;
  decidedAt?: string | null;
  decidedByUserId?: number | null;
  decidedByName?: string | null;
  decisionNote?: string | null;
};

export type ShiftAdjustmentLine = {
  id?: number;
  runSegmentId: number;
  itemId: number;
  itemName?: string | null;
  grossOutputQty: number;
  productionScrapQty: number;
  qtySentToQc: number;
  remarks?: string | null;
};

export type ShiftAdjustmentRequest = {
  id: number;
  reportVersionId: number;
  status: string;
  adjustReason: string;
  remarks?: string | null;
  proposedGrossOutputQty: number;
  proposedProductionScrapQty: number;
  proposedQtySentToQc: number;
  proposedLines: ShiftAdjustmentLine[];
  requestedAt: string | null;
  requestedByUserId?: number | null;
  requestedByName?: string | null;
  decidedAt?: string | null;
  decidedByUserId?: number | null;
  decidedByName?: string | null;
  decisionNote?: string | null;
  appliedAt?: string | null;
  appliedByUserId?: number | null;
  appliedByName?: string | null;
  appliedReportVersionId?: number | null;
};

export type ShiftSessionDetail = {
  id: number;
  shiftSessionNo: string;
  status: string;
  sessionDate: string | null;
  machine: MachineBrief | null;
  shift: ShiftBrief | null;
  primaryOperator: OperatorBrief | null;
  handoverState?: string | null;
  handoverRemarks?: string | null;
  cancellationReason?: string | null;
  startedAt: string | null;
  endedAt: string | null;
  reopenCount?: number;
  canCancel?: boolean;
  operators: ShiftParticipation[];
  runSegments: ShiftRunSegment[];
  downtimeIncidents: ShiftDowntimeIncident[];
  productionQtyLocked?: boolean;
  productionQtyLockReason?: string | null;
  pendingDraftCount?: number;
  pendingDraftQty?: number;
  /** Live APPROVED PE totals by segment/item (seed Shift Report before first draft). */
  qtyLines?: ShiftReportLine[];
  report?: {
    id: number;
    latestVersionNo: number;
    productionQtyLocked?: boolean;
    productionQtyLockReason?: string | null;
    pendingDraftCount?: number;
    pendingDraftQty?: number;
    latestVersion?: ShiftReportVersion | null;
    versions?: ShiftReportVersion[];
  } | null;
  reopenRequests?: ShiftReopenRequest[];
};

export type EligibleRunOption = {
  workOrderId: number;
  workOrderNo: string | null;
  runAllocationId: number;
  runSequence?: number;
  itemId: number;
  itemCode?: string | null;
  itemName?: string | null;
  machine: MachineBrief;
  productionFlow?: string | null;
  workOrderStatus?: string | null;
};

export type OpenDowntimeIncident = {
  incidentId: number;
  reason: string;
  remarks?: string | null;
  startedAt: string | null;
  endedAt: string | null;
  machine: MachineBrief;
  latestSegment: {
    id: number;
    sessionId: number;
    shiftSessionNo: string | null;
    sessionStatus: string | null;
    sessionDate: string | null;
    segmentStartAt: string | null;
    segmentEndAt: string | null;
    remarks?: string | null;
  } | null;
  currentOpenSessionId: number | null;
  canContinueIntoCurrentSession: boolean;
  continuedFromPriorShift: boolean;
};

export const DOWNTIME_REASON_OPTIONS = [
  { value: "MACHINE_BREAKDOWN", label: "Machine breakdown" },
  { value: "WAITING_FOR_RM", label: "Waiting for RM" },
  { value: "TOOL_MOULD_MAINTENANCE", label: "Tool / mould maintenance" },
  { value: "QUALITY_CONCERN", label: "Quality concern" },
  { value: "EMERGENCY_PRIORITY_PRODUCTION", label: "Emergency / priority production" },
  { value: "POWER_UTILITY_FAILURE", label: "Power / utility failure" },
  { value: "MANAGEMENT_HOLD", label: "Management hold" },
  { value: "OTHER", label: "Other" },
] as const;

export function fetchShiftCapabilities(): Promise<ShiftCapabilities> {
  return apiFetch<ShiftCapabilities>("/api/machine-shift-sessions/capabilities");
}

export type BusyShiftOperator = {
  operatorId: number;
  operatorCode?: string | null;
  operatorName?: string | null;
  sessionId: number;
  shiftSessionNo?: string | null;
  sessionStatus?: string | null;
  machineId?: number | null;
  machineCode?: string | null;
  machineName?: string | null;
  machineLabel?: string | null;
};

export function fetchBusyShiftOperators(): Promise<{ operators: BusyShiftOperator[] }> {
  return apiFetch("/api/machine-shift-sessions/busy-operators");
}

export function fetchOpenShiftSession(machineId: number): Promise<{ session: ShiftSessionDetail | null }> {
  return apiFetch(`/api/machine-shift-sessions/open?machineId=${encodeURIComponent(String(machineId))}`);
}

export function fetchShiftSession(sessionId: number): Promise<{ session: ShiftSessionDetail }> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}`);
}

export function fetchEligibleRuns(machineId: number): Promise<{ machine: MachineBrief; runs: EligibleRunOption[] }> {
  return apiFetch(`/api/machine-shift-sessions/eligible-runs?machineId=${encodeURIComponent(String(machineId))}`);
}

export function fetchOpenDowntime(machineId: number): Promise<{ incident: OpenDowntimeIncident | null }> {
  return apiFetch(`/api/machine-shift-sessions/open-downtime?machineId=${encodeURIComponent(String(machineId))}`);
}

export function startShiftSession(body: {
  machineId: number;
  shiftId?: number | null;
  sessionDate: string;
  operators: { operatorId: number; isPrimary?: boolean }[];
}): Promise<{ session: ShiftSessionDetail }> {
  return apiFetch("/api/machine-shift-sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function joinShiftOperator(
  sessionId: number,
  body: { operatorId: number; changeReason?: string | null },
): Promise<unknown> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/operators/join`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function leaveShiftOperator(
  sessionId: number,
  body: { operatorId: number; changeReason: string },
): Promise<unknown> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/operators/leave`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function changeShiftPrimaryOperator(
  sessionId: number,
  body: { newPrimaryOperatorId: number; changeReason: string; keepPreviousPrimary?: boolean },
): Promise<unknown> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/operators/change-primary`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function startShiftRunSegment(
  sessionId: number,
  body: { runAllocationId?: number | null; workOrderId?: number | null },
): Promise<unknown> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/run-segments`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function closeShiftRunSegment(
  sessionId: number,
  body: { segmentId?: number | null; closeReason: string },
): Promise<unknown> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/run-segments/close`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function pauseShiftDowntime(
  sessionId: number,
  body: { reason: string; remarks?: string | null },
): Promise<unknown> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/downtime/pause`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function resumeShiftDowntime(
  sessionId: number,
  body?: { incidentId?: number | null; remarks?: string | null },
): Promise<unknown> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/downtime/resume`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export function continueShiftDowntime(
  sessionId: number,
  body: { incidentId: number; remarks?: string | null },
): Promise<unknown> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/downtime/continue`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function saveShiftReportDraft(
  sessionId: number,
  body: {
    lines?: {
      runSegmentId: number;
      itemId: number;
      productionScrapQty: number;
      remarks?: string | null;
    }[];
    remarks?: string | null;
    zeroProductionReason?: string | null;
    zeroProductionRemarks?: string | null;
    zeroProduction?: boolean;
  },
): Promise<{
  declared: false;
  zeroProduction?: boolean;
  pendingDraftCount: number;
  pendingDraftQty: number;
  version: ShiftReportVersion;
}> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/report/draft`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function submitShiftReport(
  sessionId: number,
  body: { declaredOperatorId: number; versionId?: number | null },
): Promise<{
  submitted: boolean;
  alreadySubmitted?: boolean;
  version: ShiftReportVersion;
}> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/report/submit`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function returnShiftReport(
  versionId: number,
  body: { returnReason: string },
): Promise<{ returned: boolean; alreadyReturned?: boolean; version: ShiftReportVersion }> {
  return apiFetch(`/api/machine-shift-sessions/report-versions/${versionId}/return`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function verifyShiftReport(
  versionId: number,
): Promise<{ verified: boolean; alreadyVerified?: boolean; version: ShiftReportVersion }> {
  return apiFetch(`/api/machine-shift-sessions/report-versions/${versionId}/verify`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function completeShiftOver(
  sessionId: number,
  body: { handoverState: "RETAINED" | "CLEARED" | "UNKNOWN"; handoverRemarks?: string | null },
): Promise<{ session: ShiftSessionDetail; completed: boolean; alreadyShiftOver?: boolean }> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/shift-over`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function cancelShiftSession(
  sessionId: number,
  body: { reason: string },
): Promise<{ session: ShiftSessionDetail; cancelled: boolean; alreadyCancelled?: boolean }> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/cancel`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchShiftReopenRequests(
  sessionId: number,
): Promise<{ requests: ShiftReopenRequest[] }> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/reopen-requests`);
}

export function requestShiftReopen(
  sessionId: number,
  body: { reopenReason: string },
): Promise<{ created: boolean; request: ShiftReopenRequest }> {
  return apiFetch(`/api/machine-shift-sessions/${sessionId}/reopen-requests`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function approveShiftReopen(
  requestId: number,
  body?: { decisionNote?: string | null },
): Promise<{
  approved: boolean;
  alreadyApproved?: boolean;
  request: ShiftReopenRequest;
  session?: ShiftSessionDetail | null;
  draftVersion?: ShiftReportVersion | null;
}> {
  return apiFetch(`/api/machine-shift-sessions/reopen-requests/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export function denyShiftReopen(
  requestId: number,
  body: { decisionNote: string },
): Promise<{ denied: boolean; alreadyDenied?: boolean; request: ShiftReopenRequest }> {
  return apiFetch(`/api/machine-shift-sessions/reopen-requests/${requestId}/deny`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchShiftReportAdjustments(
  reportVersionId: number,
): Promise<{ requests: ShiftAdjustmentRequest[] }> {
  return apiFetch(`/api/machine-shift-sessions/report-versions/${reportVersionId}/adjustments`);
}

export function requestShiftReportAdjustment(
  reportVersionId: number,
  body: {
    adjustReason: string;
    remarks?: string | null;
    lines: {
      runSegmentId: number;
      itemId: number;
      productionScrapQty: number;
      qtySentToQc: number;
      grossOutputQty: number;
      remarks?: string | null;
    }[];
  },
): Promise<{ created: boolean; request: ShiftAdjustmentRequest }> {
  return apiFetch(`/api/machine-shift-sessions/report-versions/${reportVersionId}/adjustments`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function approveShiftReportAdjustment(
  requestId: number,
  body?: { decisionNote?: string | null },
): Promise<{ approved: boolean; alreadyApproved?: boolean; request: ShiftAdjustmentRequest }> {
  return apiFetch(`/api/machine-shift-sessions/adjustments/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export function denyShiftReportAdjustment(
  requestId: number,
  body: { decisionNote: string },
): Promise<{ denied: boolean; alreadyDenied?: boolean; request: ShiftAdjustmentRequest }> {
  return apiFetch(`/api/machine-shift-sessions/adjustments/${requestId}/deny`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function applyShiftReportAdjustment(
  requestId: number,
): Promise<{
  applied: boolean;
  alreadyApplied?: boolean;
  request: ShiftAdjustmentRequest;
  correctedVersion?: ShiftReportVersion | null;
  sessionRemainsShiftOver?: boolean;
}> {
  return apiFetch(`/api/machine-shift-sessions/adjustments/${requestId}/apply`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
