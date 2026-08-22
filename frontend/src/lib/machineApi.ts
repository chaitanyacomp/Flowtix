import { apiFetch } from "../services/api";

export type MachineType =
  | "INJECTION_MOULDING"
  | "BLOW_MOULDING"
  | "EXTRUSION"
  | "ASSEMBLY"
  | "CNC"
  | "PRESS"
  | "PACKAGING"
  | "UTILITY"
  | "OTHER";

export const MACHINE_TYPES: { value: MachineType; label: string }[] = [
  { value: "INJECTION_MOULDING", label: "Injection Moulding" },
  { value: "BLOW_MOULDING", label: "Blow Moulding" },
  { value: "EXTRUSION", label: "Extrusion" },
  { value: "ASSEMBLY", label: "Assembly" },
  { value: "CNC", label: "CNC" },
  { value: "PRESS", label: "Press" },
  { value: "PACKAGING", label: "Packaging" },
  { value: "UTILITY", label: "Utility" },
  { value: "OTHER", label: "Other" },
];

export type MachineRow = {
  id: number;
  machineCode: string;
  machineName: string;
  machineType: MachineType;
  machineTypeLabel?: string;
  make?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  departmentLocation?: string | null;
  description?: string | null;
  isActive: boolean;
};

export type MachineCreateInput = {
  machineCode: string;
  machineName: string;
  machineType: MachineType;
  make?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  departmentLocation?: string | null;
  description?: string | null;
};

export type MachineUpdateInput = Partial<MachineCreateInput> & {
  isActive?: boolean;
};

/** Client-side preview of server normalize (trim, upper, spaces → _). */
export function normalizeMachineCodePreview(value: string): string {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!raw) return "";
  return raw.replace(/\s+/g, "_").slice(0, 32);
}

export function fetchMachines(includeInactive = false): Promise<MachineRow[]> {
  const qs = includeInactive ? "?includeInactive=1" : "";
  return apiFetch<MachineRow[]>(`/api/machines${qs}`);
}

export function createMachine(input: MachineCreateInput): Promise<MachineRow> {
  return apiFetch<MachineRow>("/api/machines", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateMachine(id: number, patch: MachineUpdateInput): Promise<MachineRow> {
  return apiFetch<MachineRow>(`/api/machines/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
