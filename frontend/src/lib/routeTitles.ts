const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/control-tower": "Control Tower (Beta)",
  "/account": "Account",
  "/planning-dashboard": "Requirement & Cycle Planning",
  "/export-history": "Export history",
  "/customers": "Customers",
  "/items": "Items",
  "/opening-stock": "Opening stock",
  "/units": "Units",
  "/locations": "Locations",
  "/suppliers": "Suppliers",
  "/boms": "BOM",
  "/enquiries": "Enquiries",
  "/quotations": "Quotations",
  "/quotations/new": "New quotation",
  "/sales-orders": "Sales orders",
  "/sales-orders/no-qty/from-quotation": "Continue to Sales Order",
  "/sales-orders/requirements": "Requirement sheet",
  "/dispatch": "Dispatch Workspace",
  "/rm-check": "Prepare work order",
  "/work-orders/prepare": "Prepare work order",
  "/stock": "Stock Summary",
  "/stock/items": "Item Stock",
  "/stock/movement-history": "Movement History",
  "/stock/rm-ledger": "RM Movement",
  "/stock/adjustment": "Stock Adjustment",
  "/monthly-planning": "Monthly Planning",
  "/material-planning": "Material Planning",
  "/rm-stock-planning": "RM Stock Planning",
  "/procurement-planning": "Procurement Workspace",
  "/material-issue": "Material Issue Workspace",
  "/rm-po-grn": "Purchase & GRN Workspace",
  "/purchase-bills": "Purchase bills",
  "/purchase-bills/new": "New purchase bill",
  "/work-orders": "Work order",
  "/production": "Production Workspace",
  "/production/material-requests": "Material Requests (queue)",
  "/production/rm-returns": "RM Returns",
  "/qc-entry": "Production QA",
  "/qc-report": "QC Report",
  "/scrap-report": "Scrap report",
  "/reports": "Analysis",
  "/reports/stock-reconciliation": "Stock reconciliation",
  "/reports/purchase-matching": "Purchase matching",
  "/reports/rm-procurement-connectivity": "RM Procurement Connectivity",
  "/reports/sales-matching": "Sales matching",
  "/reports/customer-so-rs": "Customer-wise SO & RS Report",
  "/reports/batch-traceability": "Batch traceability",
  "/reports/rm-shortage": "RM Control Center",
  "/reports/production-rm-variance": "Production RM Variance",
  "/reports/rm-wastage": "RM Wastage Report",
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
  "/admin/company-profile": "Company Profile",
  "/admin/rate-contracts": "Rate contracts",
  "/admin/database-cleanup": "Database cleanup",
  "/admin/backup-restore": "Backup & Restore",
  "/masters/tally-import": "Tally master import",
  "/activity": "Activity",
};

export function getPageTitle(pathname: string): string {
  if (pathname.startsWith("/work-orders/prepare")) {
    return TITLES["/work-orders/prepare"];
  }
  if (pathname.startsWith("/planning-dashboard")) {
    return TITLES["/planning-dashboard"];
  }
  if (pathname.startsWith("/rm-po-grn/") && pathname !== "/rm-po-grn") {
    return "RM Purchase Order";
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
  return TITLES[pathname] ?? "Flowtix ERP";
}
