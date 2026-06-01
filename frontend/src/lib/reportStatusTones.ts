import type { DashboardBadgeTone } from "./dispatchBacklog";

export function rmRiskStatusTone(status: string): DashboardBadgeTone {
  switch (status) {
    case "CRITICAL":
      return "critical";
    case "LOW_BUFFER":
      return "active";
    default:
      return "neutral";
  }
}

export function workOrderStatusTone(status: string): DashboardBadgeTone {
  switch (status) {
    case "PENDING":
      return "active";
    case "IN_PROGRESS":
      return "active";
    case "COMPLETED":
      return "success";
    case "REJECTED":
      return "critical";
    case "HOLD":
      return "active";
    case "CLOSED_WITH_SHORTFALL":
      return "neutral";
    default:
      return "neutral";
  }
}

export function qcQueueStatusTone(status: string): DashboardBadgeTone {
  switch (status) {
    case "PENDING_QC":
    case "PARTIAL_QC":
      return "active";
    default:
      return "neutral";
  }
}

export function purchasePoStatusTone(status: string): DashboardBadgeTone {
  switch (status) {
    case "PENDING":
      return "active";
    case "COMPLETED":
      return "success";
    case "REJECTED":
      return "critical";
    default:
      return "neutral";
  }
}

/** Operational pipeline status from work-order tracking report */
export function woTrackingStatusTone(status: string): DashboardBadgeTone {
  switch (status) {
    case "PENDING_PRODUCTION":
      return "neutral";
    case "IN_PRODUCTION":
    case "PENDING_QC":
    case "PARTIAL_QC":
      return "active";
    case "READY_TO_DISPATCH":
    case "PARTIAL_DISPATCH":
      return "active";
    case "COMPLETED":
      return "success";
    default:
      return "neutral";
  }
}
