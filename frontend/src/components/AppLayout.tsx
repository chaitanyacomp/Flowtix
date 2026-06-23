import * as React from "react";
import type { ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useDemoMode } from "../contexts/DemoModeContext";
import { isDemoNavigationAllowed } from "../lib/demoFlowConfig";
import { DemoHighlightController } from "./demo/DemoHighlightController";
import { DemoGuide } from "./demo/DemoGuide";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { getPageTitle } from "../lib/routeTitles";
import { REGULAR_TERMS } from "../lib/flowTerminology";
import { PROCUREMENT_TERMS } from "../lib/procurementTerminology";
import { GlobalSearch } from "./GlobalSearch";
import { CommercialWorkflowOriginTrace } from "./PageHeader";
import { BrandLogo, BrandMark, BRAND_NAME } from "./branding/Branding";
import {
  LayoutDashboard,
  Package,
  PackageMinus,
  Users,
  Boxes,
  LogOut,
  ShoppingCart,
  Factory,
  ClipboardCheck,
  Truck,
  GitBranch,
  Building2,
  Network,
  FileSpreadsheet,
  ClipboardList,
  PlusCircle,
  MessageSquare,
  FileText,
  Settings,
  History,
  Table,
  Receipt,
  BarChart3,
  Ruler,
  Database,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Tags,
  UserCircle,
  Contact,
  HardDrive,
  FileUp,
  ShieldAlert,
  CalendarRange,
  Gauge,
} from "lucide-react";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import {
  ALL_APP_ROLES,
  ALL_APP_ROLES_OPERATIONAL,
  REPORTS_ROLES,
  SO_READ_ROLES,
  ENQUIRY_QUOTATION_WRITE_ROLES,
  DISPATCH_READ_ROLES,
  SALES_BILL_READ_ROLES,
  PURCHASE_BILL_READ_ROLES,
  QA_PAGE_ROLES,
  QA_REPORT_READ_ROLES,
  STOCK_READ_ROLES,
  CUSTOMER_RETURN_READ_ROLES,
  PROCUREMENT_PLANNING_ROLES,
  MATERIAL_ISSUE_ROLES,
  SUPPLIER_VIEW_ROLES,
  MONTHLY_PLANNING_READ_ROLES,
  RM_CONTROL_CENTER_ROLES,
  PLANNING_DASHBOARD_ROLES,
} from "../config/erpRoles";
import { isStoreNavItemVisible } from "../lib/storeNavFilter";
import { isPurchaseNavItemVisible } from "../lib/purchaseNavFilter";
import { isProductionNavItemVisible } from "../lib/productionNavFilter";
import { isQaNavItemVisible } from "../lib/qaNavFilter";

type NavItem = {
  to: string;
  label: string;
  roles: string[];
  icon: React.ReactNode;
  navKey: string;
  /** Tooltip describing screen purpose (procurement navigation clarity). */
  navHint?: string;
  /** When true, NavLink only matches this path exactly (avoids /stock highlighting on /stock/rm-ledger). */
  end?: boolean;
  /** When set, the item is only shown if this runtime feature flag is enabled. */
  featureFlag?: "monthlyPlanning";
};
type NavGroup = {
  key: string;
  label: string;
  roles: string[];
  icon: React.ReactNode;
  items: NavItem[];
  /** When true, renders as collapsible section. */
  collapsible?: boolean;
};

const allRoles = [...ALL_APP_ROLES];
const opsRoles = [...ALL_APP_ROLES_OPERATIONAL];

const navGroups: NavGroup[] = [
  {
    key: "dash",
    label: "Dashboard",
    roles: [...allRoles],
    icon: <LayoutDashboard className="h-4 w-4 shrink-0" />,
    collapsible: false,
    items: [{ to: "/dashboard", navKey: "dash-home", label: "Dashboard", roles: [...allRoles], icon: <LayoutDashboard className="h-4 w-4 shrink-0" /> }],
  },
  {
    key: "control-tower",
    label: "Control Tower (Beta)",
    roles: [...allRoles],
    icon: <Gauge className="h-4 w-4 shrink-0" />,
    collapsible: false,
    items: [
      {
        to: "/control-tower",
        navKey: "control-tower",
        label: "Control Tower (Beta)",
        roles: [...allRoles],
        icon: <Gauge className="h-4 w-4 shrink-0" />,
      },
    ],
  },
  {
    key: "masters",
    label: "Masters",
    roles: [...opsRoles],
    icon: <Package className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      { to: "/customers", navKey: "cust", label: "Customers", roles: [...ENQUIRY_QUOTATION_WRITE_ROLES], icon: <Users className="h-4 w-4 shrink-0" /> },
      { to: "/items", navKey: "items", label: "Items", roles: ["ADMIN", "STORE"], icon: <Package className="h-4 w-4 shrink-0" /> },
      { to: "/opening-stock", navKey: "opening-stock", label: "Opening Stock", roles: ["ADMIN", "STORE"], icon: <Boxes className="h-4 w-4 shrink-0" /> },
      { to: "/units", navKey: "units", label: "Units", roles: ["ADMIN", "STORE"], icon: <Ruler className="h-4 w-4 shrink-0" /> },
      { to: "/locations", navKey: "locations", label: "Locations", roles: ["ADMIN", "STORE"], icon: <Boxes className="h-4 w-4 shrink-0" /> },
      { to: "/masters/tally-import", navKey: "tally-import", label: "Tally import", roles: ["ADMIN"], icon: <FileUp className="h-4 w-4 shrink-0" /> },
      { to: "/suppliers", navKey: "supp", label: "Suppliers", roles: [...SUPPLIER_VIEW_ROLES], icon: <Building2 className="h-4 w-4 shrink-0" /> },
      { to: "/boms", navKey: "boms", label: "BOM", roles: ["ADMIN", "STORE"], icon: <Network className="h-4 w-4 shrink-0" /> },
      { to: "/admin/backup-restore", navKey: "backup-restore", label: "Backup & Restore", roles: ["ADMIN"], icon: <HardDrive className="h-4 w-4 shrink-0" /> },
    ],
  },
  {
    key: "sales-flow",
    label: "Sales Flow",
    roles: ["ADMIN", "STORE"],
    icon: <FileSpreadsheet className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      { to: "/enquiries", navKey: "enq", label: "Enquiries", roles: [...ENQUIRY_QUOTATION_WRITE_ROLES], icon: <MessageSquare className="h-4 w-4 shrink-0" /> },
      { to: "/quotations", navKey: "quot", label: "Quotations", roles: [...ENQUIRY_QUOTATION_WRITE_ROLES], icon: <FileText className="h-4 w-4 shrink-0" /> },
      { to: "/sales-orders", navKey: "so", label: "Sales Orders", roles: [...SO_READ_ROLES], icon: <FileSpreadsheet className="h-4 w-4 shrink-0" /> },
      { to: "/dispatch", navKey: "disp", label: "Dispatch Workspace", roles: [...DISPATCH_READ_ROLES], icon: <Truck className="h-4 w-4 shrink-0" /> },
      {
        to: "/customer-po-tracking",
        navKey: "cust-track",
        label: "Customer tracking",
        roles: ["ADMIN"],
        icon: <Contact className="h-4 w-4 shrink-0" />,
      },
      { to: "/sales-bills", navKey: "salebill", label: "Sales Bills", roles: [...SALES_BILL_READ_ROLES], icon: <Receipt className="h-4 w-4 shrink-0" /> },
      { to: "/customer-returns", navKey: "cust-ret", label: "Customer Return", roles: [...CUSTOMER_RETURN_READ_ROLES], icon: <Table className="h-4 w-4 shrink-0" /> },
    ],
  },
  {
    key: "rm-purchase",
    label: "Operations",
    roles: [...allRoles],
    icon: <ShoppingCart className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      {
        to: "/monthly-planning",
        navKey: "monthly-planning",
        label: "Monthly Planning",
        roles: [...MONTHLY_PLANNING_READ_ROLES],
        icon: <CalendarRange className="h-4 w-4 shrink-0" />,
        featureFlag: "monthlyPlanning",
      },
      {
        to: "/reports/rm-shortage",
        navKey: "rm-control-center",
        label: PROCUREMENT_TERMS.NAV_RM_CONTROL_CENTER,
        navHint: PROCUREMENT_TERMS.NAV_RM_CONTROL_CENTER_HINT,
        roles: [...RM_CONTROL_CENTER_ROLES],
        icon: <ShieldAlert className="h-4 w-4 shrink-0" />,
      },
      {
        to: "/material-planning",
        navKey: "mat-plan",
        label: REGULAR_TERMS.ORDER_RM_PLANNING_TITLE,
        navHint: REGULAR_TERMS.ORDER_RM_PLANNING_SCOPE_HINT,
        roles: [...PROCUREMENT_PLANNING_ROLES],
        icon: <Package className="h-4 w-4 shrink-0" />,
      },
      {
        to: "/rm-stock-planning",
        navKey: "rm-stock-plan",
        label: "RM Stock Planning",
        roles: [...PROCUREMENT_PLANNING_ROLES],
        icon: <Boxes className="h-4 w-4 shrink-0" />,
      },
      {
        to: "/procurement-planning?demandPool=REGULAR_SO",
        navKey: "proc-plan",
        label: PROCUREMENT_TERMS.WORKSPACE_TITLE,
        navHint: PROCUREMENT_TERMS.NAV_PROCUREMENT_WORKSPACE_HINT,
        roles: [...PROCUREMENT_PLANNING_ROLES],
        icon: <ClipboardList className="h-4 w-4 shrink-0" />,
      },
      {
        to: "/material-issue",
        navKey: "mat-issue",
        label: "Material Issue Workspace",
        roles: [...MATERIAL_ISSUE_ROLES],
        icon: <Truck className="h-4 w-4 shrink-0" />,
      },
      { to: "/dispatch", navKey: "disp", label: "Dispatch Workspace", roles: [...DISPATCH_READ_ROLES], icon: <Truck className="h-4 w-4 shrink-0" /> },
      {
        to: "/rm-po-grn",
        navKey: "grn",
        label: PROCUREMENT_TERMS.NAV_PURCHASE_GRN,
        navHint: PROCUREMENT_TERMS.NAV_PURCHASE_GRN_HINT,
        roles: ["ADMIN", "PURCHASE", "STORE"],
        icon: <ShoppingCart className="h-4 w-4 shrink-0" />,
      },
      {
        to: "/purchase-bills",
        navKey: "purbill",
        label: "Purchase Bills",
        roles: [...PURCHASE_BILL_READ_ROLES],
        icon: <Receipt className="h-4 w-4 shrink-0" />,
      },
      {
        to: "/stock/rm-ledger",
        navKey: "rm-ledger",
        label: "RM Ledger",
        roles: ["ADMIN", "STORE"],
        icon: <Table className="h-4 w-4 shrink-0" />,
      },
      {
        to: "/stock",
        navKey: "stock",
        label: "Stock Overview",
        roles: [...STOCK_READ_ROLES],
        icon: <Boxes className="h-4 w-4 shrink-0" />,
      },
      {
        to: "/stock/movement-history",
        navKey: "stock-move",
        label: "Movement History",
        roles: [...STOCK_READ_ROLES],
        icon: <Table className="h-4 w-4 shrink-0" />,
        end: true,
      },
      {
        to: "/stock/adjustment",
        navKey: "stock-adj",
        label: "Stock Adjustment",
        roles: ["ADMIN", "STORE"],
        icon: <PlusCircle className="h-4 w-4 shrink-0" />,
      },
    ],
  },
  {
    key: "production-flow",
    label: "Production Flow",
    roles: [...opsRoles],
    icon: <Factory className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      { to: "/planning-dashboard", navKey: "plan-dash", label: "Requirement & Cycle Planning", roles: [...PLANNING_DASHBOARD_ROLES], icon: <BarChart3 className="h-4 w-4 shrink-0" /> },
      {
        to: "/no-qty-agreements",
        navKey: "no-qty-agreements",
        label: "NO_QTY Execution",
        roles: [...PLANNING_DASHBOARD_ROLES],
        icon: <FileSpreadsheet className="h-4 w-4 shrink-0" />,
      },
      { to: "/work-orders", navKey: "wo", label: "Work Order", roles: ["ADMIN", "PRODUCTION"], icon: <Factory className="h-4 w-4 shrink-0" /> },
      { to: "/production", navKey: "prod", label: "Production Workspace", roles: ["ADMIN", "PRODUCTION"], icon: <GitBranch className="h-4 w-4 shrink-0" /> },
      {
        to: "/production/material-requests",
        navKey: "pmr",
        label: "Material Requests",
        roles: ["ADMIN", "STORE"],
        icon: <ClipboardList className="h-4 w-4 shrink-0" />,
      },
      {
        to: "/production/rm-returns",
        navKey: "mrn",
        label: "RM Returns",
        roles: ["ADMIN", "STORE"],
        icon: <PackageMinus className="h-4 w-4 shrink-0" />,
      },
      {
        to: "/qc-entry",
        navKey: "qc",
        label: "Production QA",
        roles: [...QA_PAGE_ROLES],
        icon: <ClipboardCheck className="h-4 w-4 shrink-0" />,
      },
      { to: "/qc-report", navKey: "qc-report", label: "QC Report", roles: [...QA_REPORT_READ_ROLES], icon: <FileText className="h-4 w-4 shrink-0" /> },
    ],
  },
  {
    key: "reports",
    label: "Analysis",
    roles: [...allRoles],
    icon: <ClipboardList className="h-4 w-4 shrink-0" />,
    collapsible: false,
    items: [{ to: "/reports", navKey: "reports", label: "Reports", roles: [...REPORTS_ROLES], icon: <ClipboardList className="h-4 w-4 shrink-0" /> }],
  },
  {
    key: "account",
    label: "Account",
    roles: ["ADMIN"],
    icon: <UserCircle className="h-4 w-4 shrink-0" />,
    collapsible: false,
    items: [{ to: "/account", navKey: "account-prof", label: "Profile", roles: ["ADMIN"], icon: <UserCircle className="h-4 w-4 shrink-0" /> }],
  },
  {
    key: "settings",
    label: "Settings",
    roles: ["ADMIN"],
    icon: <Settings className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      { to: "/admin/settings", navKey: "admset", label: "Settings", roles: ["ADMIN"], icon: <Settings className="h-4 w-4 shrink-0" /> },
      { to: "/admin/company-profile", navKey: "company-profile", label: "Company Profile", roles: ["ADMIN"], icon: <Building2 className="h-4 w-4 shrink-0" /> },
      { to: "/admin/rate-contracts", navKey: "rate-contracts", label: "Rate Contracts", roles: ["ADMIN"], icon: <Tags className="h-4 w-4 shrink-0" /> },
      { to: "/admin/database-cleanup", navKey: "db-cleanup", label: "Database Cleanup", roles: ["ADMIN"], icon: <Database className="h-4 w-4 shrink-0" /> },
      { to: "/activity", navKey: "activity", label: "Activity", roles: ["ADMIN"], icon: <History className="h-4 w-4 shrink-0" /> },
    ],
  },
];

const ERP_SIDEBAR_COLLAPSED_KEY = "erp-shell-sidebar-collapsed";

function DemoGatedNavLink({
  to,
  end,
  className,
  children,
  title,
}: {
  to: string;
  end?: boolean;
  className?: string | ((args: { isActive: boolean }) => string);
  children: ReactNode;
  /** Native tooltip (e.g. icon-only collapsed sidebar) */
  title?: string;
}) {
  const demo = useDemoMode();
  const blocked = demo.enabled && !isDemoNavigationAllowed(to, demo.flow, demo.step);
  return (
    <NavLink
      to={to}
      end={end === true}
      title={title}
      aria-disabled={blocked}
      tabIndex={blocked ? -1 : 0}
      onClick={(e) => {
        if (blocked) e.preventDefault();
      }}
      className={(args) =>
        cn(typeof className === "function" ? className(args) : className, blocked && "pointer-events-none opacity-40")
      }
    >
      {children}
    </NavLink>
  );
}

function groupDefaultOpen(pathname: string, group: NavGroup): boolean {
  if (!group.collapsible) return false;
  if (group.key === "masters")
    return (
      pathname === "/customers" ||
      pathname === "/items" ||
      pathname === "/units" ||
      pathname === "/locations" ||
      pathname === "/suppliers" ||
      pathname === "/boms" ||
      pathname.startsWith("/admin/backup-restore") ||
      pathname.startsWith("/masters/tally-import")
    );
  if (group.key === "sales-flow")
    return ["/enquiries", "/quotations", "/sales-orders", "/dispatch", "/sales-bills", "/customer-returns", "/customer-po-tracking"].some((p) =>
      pathname.startsWith(p),
    );
  if (group.key === "rm-purchase")
    return ["/monthly-planning", "/reports/rm-shortage", "/material-planning", "/rm-stock-planning", "/procurement-planning", "/material-issue", "/dispatch", "/rm-po-grn", "/purchase-bills", "/stock"].some((p) =>
      pathname.startsWith(p),
    );
  if (group.key === "production-flow")
    return ["/planning-dashboard", "/work-orders", "/rm-check", "/production", "/qc-entry", "/qc-report"].some((p) =>
      pathname.startsWith(p),
    );
  if (group.key === "settings")
    return (
      pathname.startsWith("/admin/settings") ||
      pathname.startsWith("/admin/company-profile") ||
      pathname.startsWith("/admin/database-cleanup") ||
      pathname.startsWith("/activity")
    );
  return false;
}

export function AppLayout() {
  const auth = useAuth();
  const demo = useDemoMode();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { flags } = useFeatureFlags();
  const role = auth.user?.role || "";
  const pageTitle =
    pathname === "/dashboard" && role === "PURCHASE"
      ? "Purchase desk"
      : pathname === "/dashboard" && role === "STORE"
        ? "Store Operations"
        : pathname === "/dashboard" && role === "PRODUCTION"
          ? "Production desk"
          : pathname === "/dashboard" && role === "QA"
            ? "Production QA desk"
            : pathname === "/dashboard" && role === "ADMIN"
              ? "Operations"
              : getPageTitle(pathname);

  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(ERP_SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  React.useEffect(() => {
    try {
      window.localStorage.setItem(ERP_SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  function onLogout() {
    auth.logout();
    nav("/login");
  }

  return (
    <div className="erp-shell erp-app-shell app-shell">
      <aside
        className={cn(
          "erp-sidebar overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          sidebarCollapsed ? "w-14" : "w-60",
        )}
        data-sidebar-collapsed={sidebarCollapsed ? "1" : "0"}
      >
        <DemoGatedNavLink
          to="/dashboard"
          title={sidebarCollapsed ? `Dashboard · ${BRAND_NAME} home` : `${BRAND_NAME} · Dashboard`}
          aria-label={`${BRAND_NAME} · Dashboard`}
          className={({ isActive }) =>
            cn(
              "erp-nav-link flex shrink-0 items-center rounded-none border-b border-slate-200/80 text-[13px] font-semibold tracking-tight text-slate-900 no-underline",
              sidebarCollapsed ? "justify-center py-2.5" : "gap-2 px-3 py-2.5",
              isActive ? "erp-nav-link-active" : "",
            )
          }
        >
          {sidebarCollapsed ? (
            <BrandMark size="md" className="erp-brand-mark--interactive" decorative />
          ) : (
            <BrandLogo size="compact" className="erp-brand-mark--interactive" />
          )}
        </DemoGatedNavLink>
        <nav
          id="erp-sidebar-nav"
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-3 pt-1.5",
            sidebarCollapsed ? "px-1" : "px-2",
          )}
        >
          {navGroups.map((group) => {
            const visible = group.items.filter(
              (n) =>
                n.roles.includes(role) &&
                isStoreNavItemVisible(role, n.navKey) &&
                isPurchaseNavItemVisible(role, n.navKey) &&
                isProductionNavItemVisible(role, n.navKey) &&
                isQaNavItemVisible(role, n.navKey) &&
                (!n.featureFlag || flags[n.featureFlag]),
            );
            if (!visible.length) return null;

            if (!group.collapsible) {
              const item = visible[0] ?? null;
              if (!item) return null;
              return (
                <div key={group.key} className="pt-0">
                  <DemoGatedNavLink
                    to={item.to}
                    end={item.end === true}
                    title={item.navHint ?? (sidebarCollapsed ? item.label : undefined)}
                    className={({ isActive }) => cn("erp-nav-link", isActive ? "erp-nav-link-active" : "")}
                  >
                    {group.icon}
                    {!sidebarCollapsed ? <span className="min-w-0 truncate">{group.label}</span> : null}
                  </DemoGatedNavLink>
                </div>
              );
            }

            const defaultOpen = groupDefaultOpen(pathname, group);
            return (
              <details key={group.key} className="group" open={defaultOpen}>
                <summary
                  title={sidebarCollapsed ? group.label : undefined}
                  className={cn(
                    "erp-nav-link list-none cursor-pointer select-none",
                    defaultOpen ? "bg-slate-50/55" : "",
                  )}
                >
                  {group.icon}
                  {!sidebarCollapsed ? (
                    <>
                      <span className="min-w-0 flex-1 truncate">{group.label}</span>
                      <span className="ml-auto inline-flex items-center text-slate-400">
                        <ChevronRight className="h-4 w-4 group-open:hidden" />
                        <ChevronDown className="h-4 w-4 hidden group-open:block" />
                      </span>
                    </>
                  ) : (
                    <span className="sr-only">{group.label}</span>
                  )}
                </summary>
                <div className={cn("mt-0.5 space-y-0.5", sidebarCollapsed ? "pl-0" : "pl-2.5")}>
                  {visible.map((item) => (
                    <DemoGatedNavLink
                      key={item.navKey}
                      to={item.to}
                      end={item.end === true}
                      title={item.navHint ?? (sidebarCollapsed ? item.label : undefined)}
                      className={({ isActive }) => cn("erp-nav-link text-[13px] leading-snug", isActive ? "erp-nav-link-active" : "")}
                    >
                      {item.icon}
                      {!sidebarCollapsed ? <span className="min-w-0 truncate">{item.label}</span> : null}
                    </DemoGatedNavLink>
                  ))}
                </div>
              </details>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="erp-topbar">
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-md border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-blue-400/40"
              aria-label={sidebarCollapsed ? "Expand navigation sidebar" : "Collapse navigation sidebar"}
              aria-expanded={!sidebarCollapsed}
              aria-controls="erp-sidebar-nav"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setSidebarCollapsed((c) => !c)}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-5 w-5" aria-hidden />
              ) : (
                <ChevronLeft className="h-5 w-5" aria-hidden />
              )}
            </Button>
            <BrandMark
              size="sm"
              className="hidden shrink-0 sm:inline-flex"
              alt={`${BRAND_NAME} home`}
            />
            <h1 className="min-w-0 max-w-[40vw] shrink truncate border-l-[3px] border-l-blue-800/90 pl-2.5 text-base font-semibold leading-tight tracking-tight text-slate-800 sm:max-w-[min(50vw,28rem)] sm:pl-3 sm:text-lg">
              {pageTitle}
            </h1>
          </div>
          <div className="mx-1 flex min-w-0 max-w-full flex-1 justify-center px-1 sm:mx-2">
            <GlobalSearch />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold text-slate-900">{auth.user?.name}</div>
              <div className="text-xs font-medium text-slate-600">{auth.user?.role}</div>
            </div>
            <Button variant="outline" size="sm" onClick={onLogout} className="shrink-0">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </header>

        {demo.enabled ? (
          <div
            role="status"
            className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-[13px] font-medium text-amber-950"
          >
            Demo Mode Active — No real data will be saved
          </div>
        ) : null}

        {demo.enabled ? <DemoGuide /> : null}
        {demo.enabled ? <DemoHighlightController /> : null}

        <main className="erp-main erp-page-shell page-shell">
          <CommercialWorkflowOriginTrace />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
