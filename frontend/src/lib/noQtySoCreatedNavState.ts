import { displaySalesOrderNo } from "./docNoDisplay";

export const NO_QTY_SO_CREATED_BANNER_KEY = "noQtySoCreatedBanner" as const;

export type NoQtySoCreatedBannerState = {
  kind: typeof NO_QTY_SO_CREATED_BANNER_KEY;
  salesOrderId: number;
  soNo: string;
  customerName: string;
  cycleNo: number;
};

export function buildNoQtySoCreatedBannerState(params: {
  salesOrderId: number;
  docNo?: string | null;
  customerName: string;
  cycleNo?: number | null;
}): NoQtySoCreatedBannerState {
  const cycleNo =
    params.cycleNo != null && Number.isFinite(Number(params.cycleNo)) && Number(params.cycleNo) > 0
      ? Number(params.cycleNo)
      : 1;
  return {
    kind: NO_QTY_SO_CREATED_BANNER_KEY,
    salesOrderId: params.salesOrderId,
    soNo: displaySalesOrderNo(params.salesOrderId, params.docNo),
    customerName: params.customerName.trim() || "—",
    cycleNo,
  };
}

export function readNoQtySoCreatedBannerState(
  locationState: unknown,
  salesOrderId: number,
): NoQtySoCreatedBannerState | null {
  const st = locationState as Partial<NoQtySoCreatedBannerState> | null | undefined;
  if (!st || st.kind !== NO_QTY_SO_CREATED_BANNER_KEY) return null;
  if (Number(st.salesOrderId) !== salesOrderId) return null;
  if (!st.soNo || !st.customerName) return null;
  const cycleNo = Number(st.cycleNo);
  return {
    kind: NO_QTY_SO_CREATED_BANNER_KEY,
    salesOrderId: Number(st.salesOrderId),
    soNo: String(st.soNo),
    customerName: String(st.customerName),
    cycleNo: Number.isFinite(cycleNo) && cycleNo > 0 ? cycleNo : 1,
  };
}
