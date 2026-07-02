import { apiFetch } from "../services/api";

export type WastageTypeRow = {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export function fetchWastageTypes(includeInactive = false): Promise<WastageTypeRow[]> {
  const qs = includeInactive ? "?includeInactive=true" : "";
  return apiFetch<WastageTypeRow[]>(`/api/wastage-types${qs}`);
}

export function createWastageType(name: string): Promise<WastageTypeRow> {
  return apiFetch<WastageTypeRow>("/api/wastage-types", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateWastageType(id: number, patch: { name?: string; isActive?: boolean }): Promise<WastageTypeRow> {
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
