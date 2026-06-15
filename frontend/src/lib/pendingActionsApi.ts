export type PendingActionPriority = "HIGH" | "MEDIUM" | "LOW";

export type PendingAction = {
  id?: string;
  priority: PendingActionPriority;
  action: string;
  documentNo: string | null;
  ownerRole: string;
  ageHours: number | null;
  href: string;
};

export type PendingActionsResponse = {
  count: number;
  actions: PendingAction[];
  meta?: {
    role?: string;
    generatedAt?: string;
  };
};

/** Props passed from DashboardPage into role-specific desk dashboards. */
export type PendingActionsDashboardProps = {
  count: number;
  loading?: boolean;
  error?: string | null;
};

export async function fetchPendingActions(): Promise<PendingActionsResponse> {
  const { apiFetch } = await import("../services/api");
  return apiFetch<PendingActionsResponse>("/api/pending-actions");
}

export function pendingActionPriorityLabel(priority: PendingActionPriority): string {
  switch (priority) {
    case "HIGH":
      return "High";
    case "MEDIUM":
      return "Medium";
    case "LOW":
      return "Low";
    default:
      return priority;
  }
}

export function pendingActionPriorityTone(priority: PendingActionPriority): "crit" | "warn" | "muted" {
  if (priority === "HIGH") return "crit";
  if (priority === "MEDIUM") return "warn";
  return "muted";
}

export function formatPendingActionAge(ageHours: number | null | undefined): string {
  if (ageHours == null || !Number.isFinite(Number(ageHours))) return "—";
  const h = Math.max(0, Math.floor(Number(ageHours)));
  if (h < 1) return "<1h";
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  const rem = h % 24;
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
}

export function formatPendingActionOwner(role: string): string {
  const token = String(role ?? "").trim().toUpperCase();
  if (token === "STORE") return "Store";
  if (token === "PURCHASE") return "Purchase";
  if (token === "PRODUCTION") return "Production";
  if (token === "QA") return "QA";
  if (token === "ADMIN") return "Admin";
  return token || "—";
}
