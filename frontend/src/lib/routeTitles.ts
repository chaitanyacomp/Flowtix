const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/planning-dashboard": "Planning dashboard",
  "/planning-dashboard/production": "Production planning",
  "/export-history": "Export history",
  "/customers": "Customers",
  "/items": "Items",
  "/opening-stock": "Opening stock",
  "/units": "Units",
  "/suppliers": "Suppliers",
  "/boms": "BOM",
  "/enquiries": "Enquiries",
  "/quotations": "Quotations",
  "/quotations/new": "New quotation",
  "/sales-orders": "Sales orders",
  "/sales-orders/requirements": "Requirement sheet",
  "/dispatch": "Dispatch",
  "/rm-check": "Production Planning",
  "/stock": "Stock Summary",
  "/stock/rm-ledger": "RM Movement",
  "/stock/adjustment": "Stock Adjustment",
  "/rm-po-grn": "RM Purchase",
  "/purchase-bills": "Purchase bills",
  "/purchase-bills/new": "New purchase bill",
  "/work-orders": "Work order",
  "/production": "Production",
  "/qc-entry": "QC",
  "/qc-report": "QC Report",
  "/scrap-report": "Scrap report",
  "/reports": "Reports",
  "/reports/stock-reconciliation": "Stock reconciliation",
  "/reports/purchase-matching": "Purchase matching",
  "/reports/sales-matching": "Sales matching",
  "/reports/batch-traceability": "Batch traceability",
  "/reports/rm-shortage": "RM Shortage Report",
  "/reports/work-order-tracking": "Work Order Tracking Report",
  "/reports/operations-exceptions": "Operations Exception Report",
  "/reports/so-dispatch-trace": "SO to Dispatch Trace",
  "/reports/activity-log": "User Activity Log",
  "/reports/dispatch-backlog": "Dispatch Backlog",
  "/reports/dispatch-summary": "Dispatch Summary",
  "/customer-po-tracking": "Customer Tracking Report",
  "/customer-tracking-flow": "Customer Tracking Report",
  "/customer-returns": "Customer Return",
  "/customer-returns/qc-hold": "Customer Return · Hold for Checking",
  "/customer-returns/rework": "Customer Return · Rework",
  "/admin/settings": "Admin settings",
  "/admin/database-cleanup": "Database cleanup",
  "/activity": "Activity",
};

export function getPageTitle(pathname: string): string {
  if (pathname.startsWith("/rm-po-grn/") && pathname !== "/rm-po-grn") {
    return "RM Purchase · Order";
  }
  if (pathname.startsWith("/purchase-bills/") && pathname !== "/purchase-bills/new") {
    return "Purchase bill";
  }
  if (pathname.startsWith("/sales-orders/") && pathname.endsWith("/requirement-sheets")) {
    return "Requirement sheet";
  }
  if (pathname.startsWith("/requirement-sheets/") && pathname.endsWith("/wo-plan")) {
    return "WO planning";
  }
  return TITLES[pathname] ?? "Mini ERP";
}
