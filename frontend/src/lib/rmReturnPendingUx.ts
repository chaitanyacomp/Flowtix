/** RM Return Pending — one-click receive UX helpers (P16-17B). */

export function isPendingDrivenRmReturnPage(params: {
  from?: string | null;
  pendingId?: number | null;
}): boolean {
  if (params.from === "pending-actions") return true;
  const id = params.pendingId;
  return id != null && Number.isFinite(id) && id > 0;
}

export function isAlreadyProcessedPendingReturnError(err: unknown): boolean {
  const msg =
    err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
      ? (err as { message: string }).message
      : err instanceof Error
        ? err.message
        : String(err ?? "");
  if (msg.includes("already processed")) return true;
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: unknown }).status;
    return status === 409;
  }
  return false;
}
