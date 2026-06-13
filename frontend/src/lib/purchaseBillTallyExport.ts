import { getApiUrl } from "../services/api";

export type PurchaseBillTallyExportRow = {
  id: number;
  status: string;
  isExported?: boolean;
  cancelledAt?: string | null;
};

/** Finalized, not exported, not cancelled — eligible for bulk Tally export selection. */
export function isPurchaseBillTallyBulkExportEligible(row: PurchaseBillTallyExportRow): boolean {
  if (row.status !== "FINALIZED") return false;
  if (row.cancelledAt) return false;
  if (row.isExported) return false;
  return true;
}

export async function downloadPurchaseBillsTallyExport(ids: number[]): Promise<{ filename: string; count: number }> {
  const token = localStorage.getItem("token");
  const res = await fetch(getApiUrl("/api/purchase-bills/export/tally-bulk"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    let msg = "Could not export to Tally";
    const ct = res.headers.get("content-type");
    if (ct && ct.includes("application/json")) {
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        if (j?.error?.message) msg = j.error.message;
      } catch {
        /* ignore */
      }
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const m = /filename=\"?([^\";]+)\"?/i.exec(disposition);
  const filename = m?.[1]?.trim() || `purchase-bills-tally-${ids.length}-bills.xml`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  return { filename, count: ids.length };
}
