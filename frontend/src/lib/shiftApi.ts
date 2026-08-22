import { apiFetch } from "../services/api";

export type ShiftRow = {
  id: number;
  shiftCode: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  plannedBreakMinutes: number;
  remarks?: string | null;
  isActive: boolean;
  isOvernight?: boolean;
  grossDurationMinutes?: number;
  netProductionDurationMinutes?: number;
  grossDurationLabel?: string;
  netProductionDurationLabel?: string;
};

export type ShiftCreateInput = {
  shiftCode: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  plannedBreakMinutes?: number | null;
  remarks?: string | null;
};

export type ShiftUpdateInput = Partial<ShiftCreateInput> & {
  isActive?: boolean;
};

export function normalizeShiftCodePreview(value: string): string {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!raw) return "";
  return raw.replace(/\s+/g, "_").slice(0, 32);
}

export function fetchShifts(includeInactive = false): Promise<ShiftRow[]> {
  const qs = includeInactive ? "?includeInactive=1" : "";
  return apiFetch<ShiftRow[]>(`/api/shifts${qs}`);
}

export function createShift(input: ShiftCreateInput): Promise<ShiftRow> {
  return apiFetch<ShiftRow>("/api/shifts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateShift(id: number, patch: ShiftUpdateInput): Promise<ShiftRow> {
  return apiFetch<ShiftRow>(`/api/shifts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
