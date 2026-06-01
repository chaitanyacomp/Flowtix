import { ApiRequestError } from "../services/api";

/** User-facing message for REGULAR production approve / preview failures. */
export function mapProductionRmApproveError(e: unknown): string {
  if (e instanceof ApiRequestError) {
    switch (e.code) {
      case "PRODUCTION_RM_NO_PMR":
        return "Material request not raised.";
      case "PRODUCTION_RM_WAITING_ISSUE":
        return "Waiting for Store issue.";
      case "PRODUCTION_RM_INSUFFICIENT":
        return "Insufficient RM available at production location.";
      case "PRODUCTION_RM_NO_PRODUCTION_STOCK":
        return "No RM available at production area.";
      case "BOM_MISSING":
        return "Approved BOM is missing for this finished good.";
      case "BOM_CHILD_MISSING":
        return "Approved child BOM is missing for a sub-assembly.";
      default:
        return e.message || "Request failed.";
    }
  }
  if (e instanceof Error) return e.message;
  return "Request failed.";
}

export const PREVIEW_LOAD_FAILED_HEADLINE =
  "Unable to load RM consumption preview. Please check BOM, RM stock, or production locations.";
