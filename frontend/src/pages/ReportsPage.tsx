import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Boxes,
  BookOpen,
  ClipboardList,
  Contact,
  FileCheck,
  FileSearch,
  FileUp,
  Factory,
  GitBranch,
  History,
  ListChecks,
  Network,
  Package,
  Receipt,
  RotateCcw,
  ShoppingCart,
  Trash2,
  Truck,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { withReportsReturnContext } from "../lib/drillDownRoutes";
import { useAuth } from "../hooks/useAuth";
import { Card, CardContent } from "../components/ui/card";
import { cn } from "../lib/utils";

/* ---------------------------------------------------------------------------
 * Role-based reporting workspace
 *
 * Reports are organized by *department-oriented groups* and gated by role so
 * each operator opens this page and sees "MY reports" — never a mix of factory
 * internals (stock, scrap, purchase audit) alongside sales-facing operations.
 *
 * UI-only refinement: routes, APIs, calculations, and permissions are unchanged.
 * Visibility here mirrors (does not relax) the existing per-route ProtectedRoute
 * gates in App.tsx and per-API requireRole gates in the backend.
 * ---------------------------------------------------------------------------*/

type RoleKey = "ADMIN" | "SALES" | "STORE" | "PRODUCTION" | "QC" | "ACCOUNTS";

type GroupKey =
  | "sales-ops"
  | "customer-service"
  | "stock"
  | "purchase"
  | "production"
  | "quality"
  | "commercial"
  | "exceptions";

type ReportTile = {
  to: string;
  title: string;
  description: string;
  /** Roles allowed to see this tile (mirrors backend/route gates). */
  roles: RoleKey[];
  group: GroupKey;
  icon: ReactNode;
  /** Lower = appears first within its group. */
  priority: number;
};

type ReportGroupDef = {
  key: GroupKey;
  label: string;
  caption: string;
};

const GROUP_DEFS: Record<GroupKey, ReportGroupDef> = {
  "sales-ops": {
    key: "sales-ops",
    label: "Sales Operations",
    caption: "Day-to-day sales pipeline, dispatch, and billing visibility",
  },
  "customer-service": {
    key: "customer-service",
    label: "Customer Service",
    caption: "Returns, replacements, and customer-journey reports",
  },
  stock: {
    key: "stock",
    label: "Stock & Reconciliation",
    caption: "Stock views and raw-material reconciliation",
  },
  purchase: {
    key: "purchase",
    label: "Purchase Audit",
    caption: "Bills and pending Material Planning follow-up",
  },
  production: {
    key: "production",
    label: "Production & Traceability",
    caption: "Work-order tracking and production trace",
  },
  quality: {
    key: "quality",
    label: "Quality & Scrap",
    caption: "QC trace and scrap reasons",
  },
  commercial: {
    key: "commercial",
    label: "Commercial",
    caption: "Operational registers and billing alignment — statutory books remain in Tally",
  },
  exceptions: {
    key: "exceptions",
    label: "Exceptions & Activity",
    caption: "Operational exceptions, exports, and audit log",
  },
};

/**
 * Per-role group order — the user's "home" reports appear first.
 * (Admin sees everything in operational reading order.)
 */
const ROLE_GROUP_ORDER: Record<RoleKey, GroupKey[]> = {
  SALES: ["sales-ops", "customer-service"],
  STORE: ["sales-ops", "stock", "purchase", "production", "exceptions"],
  PRODUCTION: ["production", "quality", "stock", "customer-service"],
  QC: ["quality", "production", "customer-service"],
  ACCOUNTS: ["commercial"],
  ADMIN: [
    "sales-ops",
    "customer-service",
    "stock",
    "purchase",
    "production",
    "quality",
    "commercial",
    "exceptions",
  ],
};

const TILES: ReportTile[] = [
  /* ----------------------------- Sales Operations ----------------------------- */
  {
    to: withReportsReturnContext("/sales-orders"),
    title: "Sales Order Status",
    description: "Open, in-process, and closed sales orders across customers",
    roles: ["ADMIN", "SALES", "STORE"],
    group: "sales-ops",
    icon: <ListChecks className="h-4 w-4" />,
    priority: 10,
  },
  {
    to: "/reports/dispatch-backlog",
    title: "Dispatch Backlog",
    description: "Pending dispatch across active sales orders",
    roles: ["ADMIN", "SALES"],
    group: "sales-ops",
    icon: <Truck className="h-4 w-4" />,
    priority: 20,
  },
  {
    to: "/customer-tracking-flow?from=reports",
    title: "Customer Tracking Report",
    description: "Order journey from dispatch through billing, returns, and replacements",
    roles: ["ADMIN", "SALES", "STORE", "PRODUCTION", "QC"],
    group: "sales-ops",
    icon: <Users className="h-4 w-4" />,
    priority: 30,
  },
  {
    to: withReportsReturnContext("/sales-bills"),
    title: "Sales Bills",
    description: "Dispatch-wise customer invoices (Tally export ready)",
    roles: ["ADMIN", "SALES"],
    group: "sales-ops",
    icon: <Receipt className="h-4 w-4" />,
    priority: 40,
  },
  {
    to: "/reports/dispatch-summary",
    title: "Dispatch Summary",
    description: "Ready-to-ship now (matches Dispatch) + locked dispatch history",
    roles: ["ADMIN", "SALES", "STORE"],
    group: "sales-ops",
    icon: <Truck className="h-4 w-4" />,
    priority: 50,
  },
  {
    to: "/reports/customer-so-rs",
    title: "Customer-wise SO & RS Report",
    description: "Customer, SO type, cycle, requirement sheet, quantities, and pipeline next action",
    roles: ["ADMIN", "SALES", "STORE"],
    group: "sales-ops",
    icon: <ClipboardList className="h-4 w-4" />,
    priority: 60,
  },
  {
    to: "/reports/so-dispatch-trace",
    title: "SO to Dispatch Trace",
    description: "Follow a sales order through dispatch references",
    roles: ["ADMIN", "SALES", "STORE"],
    group: "sales-ops",
    icon: <GitBranch className="h-4 w-4" />,
    priority: 70,
  },
  {
    to: "/reports/sales-matching",
    title: "Sales Matching Report",
    description: "Sales Order vs Dispatch vs Sales Bill (partial dispatch / billing, mismatches)",
    roles: ["ADMIN", "SALES"],
    group: "sales-ops",
    icon: <FileCheck className="h-4 w-4" />,
    priority: 80,
  },
  {
    to: "/export-history?from=reports",
    title: "Export History",
    description: "Download previously exported Tally XML (sales bills)",
    roles: ["ADMIN", "SALES", "ACCOUNTS"],
    group: "sales-ops",
    icon: <FileUp className="h-4 w-4" />,
    priority: 90,
  },

  /* ----------------------------- Customer Service ----------------------------- */
  {
    to: withReportsReturnContext("/customer-returns"),
    title: "Customer Returns",
    description: "Returned material — QC hold, rework, and replacement status",
    roles: ["ADMIN", "SALES", "STORE", "PRODUCTION", "QC"],
    group: "customer-service",
    icon: <RotateCcw className="h-4 w-4" />,
    priority: 10,
  },
  {
    to: withReportsReturnContext("/customer-po-tracking"),
    title: "Customer PO Tracking",
    description: "Customer purchase orders — fulfillment, dispatch, and billing alignment",
    roles: ["ADMIN", "SALES"],
    group: "customer-service",
    icon: <Contact className="h-4 w-4" />,
    priority: 20,
  },

  /* -------------------------- Stock & Reconciliation -------------------------- */
  {
    to: "/reports/stock-reconciliation",
    title: "Stock Reconciliation Report",
    description: "Opening, movement, adjustments, and closing by item for a date range",
    roles: ["ADMIN", "STORE"],
    group: "stock",
    icon: <Boxes className="h-4 w-4" />,
    priority: 10,
  },
  {
    to: "/stock?from=reports",
    title: "Stock Overview",
    description: "Current stock summary by item",
    roles: ["ADMIN", "STORE"],
    group: "stock",
    icon: <Package className="h-4 w-4" />,
    priority: 20,
  },
  {
    to: "/stock/rm-ledger?from=reports",
    title: "RM Ledger",
    description: "Raw material movement and balances",
    roles: ["ADMIN", "STORE"],
    group: "stock",
    icon: <BookOpen className="h-4 w-4" />,
    priority: 30,
  },
  {
    to: "/reports/rm-shortage",
    title: "RM Shortage Workspace",
    description: "Review shortages, plan purchase coverage, and create RM PO",
    roles: ["ADMIN", "STORE", "PRODUCTION"],
    group: "stock",
    icon: <AlertTriangle className="h-4 w-4" />,
    priority: 40,
  },

  /* ------------------------------ Purchase Audit ------------------------------ */
  {
    to: "/reports/purchase-matching",
    title: "Purchase Matching Report",
    description: "Material Planning vs GRN receipt vs Purchase Bill (pending receipt / billing, mismatches)",
    roles: ["ADMIN", "STORE", "ACCOUNTS"],
    group: "purchase",
    icon: <FileSearch className="h-4 w-4" />,
    priority: 10,
  },
  {
    to: withReportsReturnContext("/purchase-bills"),
    title: "Purchase Bills",
    description: "Search and review purchase bills",
    roles: ["ADMIN", "STORE", "ACCOUNTS"],
    group: "purchase",
    icon: <ShoppingCart className="h-4 w-4" />,
    priority: 20,
  },
  {
    to: withReportsReturnContext("/rm-po-grn"),
    title: "Material Planning",
    description: "Pending purchase orders and GRN follow-up",
    roles: ["ADMIN", "STORE"],
    group: "purchase",
    icon: <Factory className="h-4 w-4" />,
    priority: 30,
  },

  /* -------------------------- Production & Traceability ----------------------- */
  {
    to: "/reports/work-order-tracking",
    title: "Work Order Tracking",
    description: "Progress from sales order through production and dispatch",
    roles: ["ADMIN", "PRODUCTION"],
    group: "production",
    icon: <Factory className="h-4 w-4" />,
    priority: 10,
  },
  {
    to: "/reports/batch-traceability",
    title: "Batch Traceability",
    description: "Forward / backward trace from production batch to QC and SO / dispatch",
    roles: ["ADMIN", "PRODUCTION", "QC", "STORE"],
    group: "production",
    icon: <Network className="h-4 w-4" />,
    priority: 20,
  },

  /* ------------------------------- Quality & Scrap ---------------------------- */
  {
    to: "/scrap-report?from=reports",
    title: "Scrap Report",
    description: "Scrap summary and reasons",
    roles: ["ADMIN", "QC", "PRODUCTION", "STORE"],
    group: "quality",
    icon: <Trash2 className="h-4 w-4" />,
    priority: 10,
  },

  /* -------------------------------- Commercial -------------------------------- */
  {
    to: "/sales-bills?payment=pending",
    title: "Receivables / Pending Receipts",
    description: "Finalized sales bills with outstanding customer balance",
    roles: ["ADMIN", "ACCOUNTS"],
    group: "commercial",
    icon: <Receipt className="h-4 w-4" />,
    priority: 10,
  },
  {
    to: "/purchase-bills?payment=pending",
    title: "Payables / Pending Payments",
    description: "Finalized purchase bills with outstanding supplier balance",
    roles: ["ADMIN", "ACCOUNTS"],
    group: "commercial",
    icon: <ShoppingCart className="h-4 w-4" />,
    priority: 20,
  },
  {
    to: "/reports/sales-matching",
    title: "Sales Register (matching)",
    description: "Sales Order vs Dispatch vs Sales Bill — dispatch vs billing gaps",
    roles: ["ADMIN", "ACCOUNTS"],
    group: "commercial",
    icon: <FileCheck className="h-4 w-4" />,
    priority: 30,
  },
  {
    to: "/reports/purchase-matching",
    title: "Purchase Register (matching)",
    description: "RM PO vs GRN vs Purchase Bill — receipt and billing coverage",
    roles: ["ADMIN", "ACCOUNTS"],
    group: "commercial",
    icon: <FileSearch className="h-4 w-4" />,
    priority: 40,
  },
  {
    to: "/reports/dispatch-summary",
    title: "Dispatch Summary",
    description: "Ready-to-ship and locked dispatch history",
    roles: ["ADMIN", "ACCOUNTS"],
    group: "commercial",
    icon: <Truck className="h-4 w-4" />,
    priority: 50,
  },
  {
    to: "/reports/so-dispatch-trace",
    title: "SO → Dispatch Trace",
    description: "Follow an order through dispatch references",
    roles: ["ADMIN", "ACCOUNTS"],
    group: "commercial",
    icon: <GitBranch className="h-4 w-4" />,
    priority: 60,
  },
  {
    to: withReportsReturnContext("/customer-po-tracking"),
    title: "Customer Ledger Summary",
    description: "Customer journey — dispatch, billing, returns (where linked)",
    roles: ["ADMIN", "ACCOUNTS"],
    group: "commercial",
    icon: <Contact className="h-4 w-4" />,
    priority: 70,
  },
  {
    to: withReportsReturnContext("/suppliers"),
    title: "Supplier Master",
    description: "Supplier directory for payable context (GST / terms)",
    roles: ["ADMIN", "ACCOUNTS"],
    group: "commercial",
    icon: <Contact className="h-4 w-4" />,
    priority: 80,
  },

  /* ----------------------------- Exceptions & Activity ------------------------ */
  {
    to: "/reports/operations-exceptions",
    title: "Operations Exception Report",
    description: "Cross-cutting operational exceptions",
    roles: ["ADMIN"],
    group: "exceptions",
    icon: <AlertCircle className="h-4 w-4" />,
    priority: 10,
  },
  {
    to: "/reports/activity-log",
    title: "User Activity Log",
    description: "Audit-friendly log (who did what, when, and on which document)",
    roles: ["ADMIN"],
    group: "exceptions",
    icon: <History className="h-4 w-4" />,
    priority: 20,
  },
];

function isRoleKey(value: string): value is RoleKey {
  return (
    value === "ADMIN" ||
    value === "SALES" ||
    value === "STORE" ||
    value === "PRODUCTION" ||
    value === "QC" ||
    value === "ACCOUNTS"
  );
}

/** Compact ERP report tile — icon, title, one-line description. */
function ReportTileCard({ tile }: { tile: ReportTile }) {
  return (
    <Link
      to={tile.to}
      className="block min-w-0 no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 rounded-md"
    >
      <Card
        className={cn(
          "h-full border-slate-200 shadow-sm transition-colors",
          "hover:border-blue-300 hover:bg-blue-50/40",
        )}
      >
        <CardContent className="flex min-w-0 items-start gap-2 p-2.5 md:p-3">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600"
          >
            {tile.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold leading-snug text-slate-900">
              {tile.title}
            </div>
            <p className="mt-0.5 text-[11.5px] leading-snug text-slate-600">
              {tile.description}
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function ReportsPage() {
  const auth = useAuth();
  const rawRole = auth.user?.role ?? "";
  const role: RoleKey = isRoleKey(rawRole) ? rawRole : "ADMIN";

  const groupOrder = ROLE_GROUP_ORDER[role] ?? ROLE_GROUP_ORDER.ADMIN;

  const tilesByGroup = new Map<GroupKey, ReportTile[]>();
  for (const tile of TILES) {
    if (!tile.roles.includes(role)) continue;
    const list = tilesByGroup.get(tile.group) ?? [];
    list.push(tile);
    tilesByGroup.set(tile.group, list);
  }
  for (const list of tilesByGroup.values()) {
    list.sort((a, b) => a.priority - b.priority);
  }

  const visibleGroups = groupOrder
    .map((key) => ({ def: GROUP_DEFS[key], tiles: tilesByGroup.get(key) ?? [] }))
    .filter((g) => g.tiles.length > 0);

  const totalTiles = visibleGroups.reduce((sum, g) => sum + g.tiles.length, 0);

  const heading = role === "ACCOUNTS" ? "Commercial reports" : "Reports";
  const subheading =
    role === "ACCOUNTS"
      ? "Operational registers and billing alignment — statutory books remain in Tally."
      : "Your reports — organized by department";

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="erp-page-title-row">
        <div className="min-w-0">
          <h2 className="erp-page-title">{heading}</h2>
          <p className="erp-page-subtitle">{subheading}</p>
        </div>
        {totalTiles > 0 ? (
          <span className="erp-chip" data-tone="info">
            {totalTiles} {totalTiles === 1 ? "report" : "reports"}
          </span>
        ) : null}
      </div>

      {visibleGroups.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-6 py-12 text-center shadow-sm">
          <p className="font-medium text-slate-800">No reports available</p>
          <p className="mt-1 max-w-md mx-auto text-sm text-slate-600">
            Your role does not include analytical reports on this page.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleGroups.map(({ def, tiles }) => (
            <section key={def.key} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold uppercase tracking-wide text-slate-700">
                    {def.label}
                  </h3>
                  <p className="text-[11px] leading-snug text-slate-500">{def.caption}</p>
                </div>
                <span className="text-[10.5px] font-medium text-slate-400 tabular-nums">
                  {tiles.length}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {tiles.map((tile) => (
                  <ReportTileCard key={`${def.key}-${tile.to}-${tile.title}`} tile={tile} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
