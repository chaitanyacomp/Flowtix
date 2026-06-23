/**
 * Shared dashboard layout tokens — operational density, laptop-first (Phase B).
 * Presentation only; no queue or business logic.
 */
export const dashboardShell = {
  /** Laptop-first dual control center — fixed viewport band, inner columns scroll. */
  page: "bg-gradient-to-b from-slate-50 via-slate-50 to-slate-100/90",
  dualRoot: "erp-dash-dual-root flex min-h-0 flex-col",
  dualInner: "erp-dash-dual-inner mx-auto flex w-full max-w-[min(100%,92rem)] min-h-0 flex-1 flex-col px-3 py-1 md:px-4 md:py-1.5",
  dualGrid: "erp-dash-dual-grid grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1.86fr)_minmax(0,1fr)]",
  dualGridSingle: "erp-dash-dual-grid erp-dash-dual-grid--single lg:grid-cols-1",
  max: "mx-auto w-full max-w-[min(100%,90rem)] px-3 pt-0.5 pb-3 md:px-5 md:pb-4",
  grid: "grid max-w-full gap-1.5",
  gridCompact: "grid max-w-full gap-1",
  card: "rounded-lg border border-slate-200/95 bg-white shadow-sm",
  cardMuted: "rounded-lg border border-slate-200/70 bg-slate-50/40 shadow-none ring-1 ring-slate-900/[0.02]",
  cardPrimary:
    "rounded-lg border border-slate-300/95 bg-white shadow-md ring-1 ring-slate-900/[0.04] border-l-[3px] border-l-blue-700",
  btnPrimary: "bg-blue-700 text-white hover:bg-blue-800 shadow-sm ring-1 ring-blue-950/10 transition-colors",
  btnSecondary:
    "inline-flex h-7 items-center justify-center rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-700 hover:border-blue-300 hover:bg-slate-50",
  tableWrap:
    "erp-table-wrap mt-auto max-w-full overflow-x-auto border-t border-slate-200 !rounded-lg",
} as const;

export function dashboardWorkspaceHeadline(role: string): { title: string; subtitle: string } {
  switch (role) {
    case "PRODUCTION":
      return { title: "Production desk", subtitle: "Shop floor · production · embedded QA" };
    case "QA":
      return { title: "Production QA desk", subtitle: "Inspection · rework · disposition (production workflow)" };
    case "PURCHASE":
      return { title: "Purchase desk", subtitle: "Procurement · RM PO · purchase bills" };
    case "STORE":
      return {
        title: "Store Operations",
        subtitle: "RS · monthly planning · GRN · WO · material issue · stock · dispatch",
      };
    case "ADMIN":
      return {
        title: "Dual Control Center",
        subtitle: "Operational control · commercial workflow",
      };
    default:
      return { title: "Control Center", subtitle: "Operational & commercial workspace" };
  }
}
