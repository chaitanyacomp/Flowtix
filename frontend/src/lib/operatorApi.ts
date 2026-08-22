import { apiFetch } from "../services/api";

export type OperatorRow = {
  id: number;
  operatorCode: string;
  operatorName: string;
  employeeNumber?: string | null;
  department?: string | null;
  designationSkill?: string | null;
  remarks?: string | null;
  isActive: boolean;
};

export type OperatorCreateInput = {
  operatorCode: string;
  operatorName: string;
  employeeNumber?: string | null;
  department?: string | null;
  designationSkill?: string | null;
  remarks?: string | null;
};

export type OperatorUpdateInput = Partial<OperatorCreateInput> & {
  isActive?: boolean;
};

/** Client-side preview of server normalize (trim, upper, spaces → _). */
export function normalizeOperatorCodePreview(value: string): string {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!raw) return "";
  return raw.replace(/\s+/g, "_").slice(0, 32);
}

export function fetchOperators(includeInactive = false): Promise<OperatorRow[]> {
  const qs = includeInactive ? "?includeInactive=1" : "";
  return apiFetch<OperatorRow[]>(`/api/operators${qs}`);
}

export function createOperator(input: OperatorCreateInput): Promise<OperatorRow> {
  return apiFetch<OperatorRow>("/api/operators", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateOperator(id: number, patch: OperatorUpdateInput): Promise<OperatorRow> {
  return apiFetch<OperatorRow>(`/api/operators/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
