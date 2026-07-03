/**
 * Pending Actions page — allowed client API surface.
 * Layout may also call `/api/config/feature-flags` once per session (AppLayout).
 */
export const PENDING_ACTIONS_PAGE_API_ALLOWLIST = ["/api/pending-actions"] as const;

export function isPendingActionsPageApiPath(path: string): boolean {
  const normalized = path.split("?")[0]?.trim() ?? "";
  return PENDING_ACTIONS_PAGE_API_ALLOWLIST.some(
    (allowed) => normalized === allowed || normalized.startsWith(`${allowed}/`),
  );
}
