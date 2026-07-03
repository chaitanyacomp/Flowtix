import { ApiRequestError, apiFetch } from "../services/api";

export type PurchaseDashboardWidgetState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string };

export const PURCHASE_WIDGET_UNAVAILABLE =
  "Not available for this role.";

export async function loadPurchaseDashboardWidget<T>(
  path: string,
  normalize: (payload: unknown) => T,
): Promise<PurchaseDashboardWidgetState<T>> {
  try {
    const payload = await apiFetch<unknown>(path);
    return { status: "ready", data: normalize(payload) };
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 403) {
      return { status: "forbidden", message: PURCHASE_WIDGET_UNAVAILABLE };
    }
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to load",
    };
  }
}
