import { Outlet } from "react-router-dom";

/** Parent route for `/rm-po-grn` — renders list (index) or PO detail (`:poId`). */
export function RmPurchaseRoutes() {
  return <Outlet />;
}
