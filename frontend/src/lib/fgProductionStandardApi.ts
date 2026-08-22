import { apiFetch } from "../services/api";

export type FgProductionStandardRow = {
  id: number;
  itemId: number;
  machineId: number;
  cycleTimeSeconds: number;
  piecesPerCycle: number;
  standardEfficiencyPercent: number;
  remarks?: string | null;
  isActive: boolean;
  itemName?: string | null;
  itemUnit?: string | null;
  itemIsActive?: boolean | null;
  machineCode?: string | null;
  machineName?: string | null;
  machineIsActive?: boolean | null;
};

export type FgProductionStandardCreateInput = {
  itemId: number;
  machineId: number;
  cycleTimeSeconds: number;
  piecesPerCycle?: number | null;
  standardEfficiencyPercent?: number | null;
  remarks?: string | null;
};

export type FgProductionStandardUpdateInput = Partial<FgProductionStandardCreateInput> & {
  isActive?: boolean;
};

export function fetchFgProductionStandards(includeInactive = false): Promise<FgProductionStandardRow[]> {
  const qs = includeInactive ? "?includeInactive=1" : "";
  return apiFetch<FgProductionStandardRow[]>(`/api/fg-production-standards${qs}`);
}

export function createFgProductionStandard(
  input: FgProductionStandardCreateInput,
): Promise<FgProductionStandardRow> {
  return apiFetch<FgProductionStandardRow>("/api/fg-production-standards", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateFgProductionStandard(
  id: number,
  patch: FgProductionStandardUpdateInput,
): Promise<FgProductionStandardRow> {
  return apiFetch<FgProductionStandardRow>(`/api/fg-production-standards/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
