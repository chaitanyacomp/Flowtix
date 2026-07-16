import { apiFetch } from "../services/api";

export type WastageTypeCategory =
  | "PROCESS"
  | "SETUP"
  | "QUALITY"
  | "MACHINE"
  | "MATERIAL"
  | "TRIAL"
  | "BREAKDOWN"
  | "MISC";

export const WASTAGE_TYPE_CATEGORIES: WastageTypeCategory[] = [
  "PROCESS",
  "SETUP",
  "QUALITY",
  "MACHINE",
  "MATERIAL",
  "TRIAL",
  "BREAKDOWN",
  "MISC",
];

export type WastageTypeRow = {
  id: number;
  code?: string | null;
  name: string;
  category?: WastageTypeCategory;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type WastageTypeCreateInput = {
  name: string;
  code?: string | null;
  category?: WastageTypeCategory;
  description?: string | null;
};

export type WastageTypeUpdateInput = {
  name?: string;
  code?: string | null;
  category?: WastageTypeCategory;
  description?: string | null;
  isActive?: boolean;
};

export function fetchWastageTypes(includeInactive = false): Promise<WastageTypeRow[]> {
  const qs = includeInactive ? "?includeInactive=true" : "";
  return apiFetch<WastageTypeRow[]>(`/api/wastage-types${qs}`);
}

export function createWastageType(input: WastageTypeCreateInput | string): Promise<WastageTypeRow> {
  const body = typeof input === "string" ? { name: input } : input;
  return apiFetch<WastageTypeRow>("/api/wastage-types", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateWastageType(id: number, patch: WastageTypeUpdateInput): Promise<WastageTypeRow> {
  return apiFetch<WastageTypeRow>(`/api/wastage-types/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function reorderWastageTypes(orderedIds: number[]): Promise<WastageTypeRow[]> {
  return apiFetch<WastageTypeRow[]>("/api/wastage-types/reorder", {
    method: "PUT",
    body: JSON.stringify({ orderedIds }),
  });
}
