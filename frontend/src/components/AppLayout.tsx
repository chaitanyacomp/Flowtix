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
import { GlobalSearch } from "./GlobalSearch";
import { CommercialWorkflowOriginTrace } from "./PageHeader";
import {
  LayoutDashboard,
  Package,
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
} from "lucide-react";
import {
  ALL_APP_ROLES,
  ALL_APP_ROLES_NO_ACCOUNTS,
  REPORTS_WITH_ACCOUNTS_ROLES,
  SO_READ_ROLES,
  ENQUIRY_QUOTATION_WRITE_ROLES,
  DISPATCH_READ_ROLES,
  SALES_BILL_READ_ROLES,
  PURCHASE_BILL_READ_ROLES,
  PLANNING_DASHBOARD_ROLES,
  QC_PAGE_ROLES,
  STOCK_READ_ROLES,
  CUSTOMER_RETURN_READ_ROLES,
} from "../config/erpRoles";

type NavItem = {
  to: string;
  label: string;
  roles: string[];
  icon: React.ReactNode;
  navKey: string;
  /** When true, NavLink only matches this path exactly (avoids /stock highlighting on /stock/rm-ledger). */
  end?: boolean;
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
const opsRolesNoAccounts = [...ALL_APP_ROLES_NO_ACCOUNTS];

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
    key: "masters",
    label: "Masters",
    roles: [...opsRolesNoAccounts],
    icon: <Package className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      { to: "/customers", navKey: "cust", label: "Customers", roles: [...ENQUIRY_QUOTATION_WRITE_ROLES], icon: <Users className="h-4 w-4 shrink-0" /> },
      { to: "/items", navKey: "items", label: "Items", roles: ["ADMIN", "STORE"], icon: <Package className="h-4 w-4 shrink-0" /> },
      { to: "/opening-stock", navKey: "opening-stock", label: "Opening Stock", roles: ["ADMIN", "STORE"], icon: <Boxes className="h-4 w-4 shrink-0" /> },
      { to: "/units", navKey: "units", label: "Units", roles: ["ADMIN", "STORE"], icon: <Ruler className="h-4 w-4 shrink-0" /> },
      { to: "/masters/tally-import", navKey: "tally-import", label: "Tally import", roles: ["ADMIN"], icon: <FileUp className="h-4 w-4 shrink-0" /> },
      { to: "/suppliers", navKey: "supp", label: "Suppliers", roles: ["ADMIN", "STORE", "ACCOUNTS"], icon: <Building2 className="h-4 w-4 shrink-0" /> },
      { to: "/boms", navKey: "boms", label: "BOM", roles: ["ADMIN", "STORE", "PRODUCTION", "SALES", "QC"], icon: <Network className="h-4 w-4 shrink-0" /> },
      { to: "/admin/backup-restore", navKey: "backup-restore", label: "Backup & Restore", roles: ["ADMIN"], icon: <HardDrive className="h-4 w-4 shrink-0" /> },
    ],
  },
  {
    key: "sales-flow",
    label: "Sales Flow",
    roles: [...allRoles],
    icon: <FileSpreadsheet className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      { to: "/enquiries", navKey: "enq", label: "Enquiries", roles: [...ENQUIRY_QUOTATION_WRITE_ROLES], icon: <MessageSquare className="h-4 w-4 shrink-0" /> },
      { to: "/quotations", navKey: "quot", label: "Quotations", roles: [...ENQUIRY_QUOTATION_WRITE_ROLES], icon: <FileText className="h-4 w-4 shrink-0" /> },
      { to: "/sales-orders", navKey: "so", label: "Sales Orders", roles: [...SO_READ_ROLES], icon: <FileSpreadsheet className="h-4 w-4 shrink-0" /> },
      { to: "/dispatch", navKey: "disp", label: "Dispatch", roles: [...DISPATCH_READ_ROLES], icon: <Truck className="h-4 w-4 shrink-0" /> },
      {
        to: "/customer-po-tracking",
        navKey: "cust-track",
        label: "Customer tracking",
        roles: [...allRoles],
        icon: <Contact className="h-4 w-4 shrink-0" />,
      },
      { to: "/sales-bills", navKey: "salebill", label: "Sales Bills", roles: [...SALES_BILL_READ_ROLES], icon: <Receipt className="h-4 w-4 shrink-0" /> },
      { to: "/customer-returns", navKey: "cust-ret", label: "Customer Return", roles: [...CUSTOMER_RETURN_READ_ROLES], icon: <Table className="h-4 w-4 shrink-0" /> },
    ],
  },
  {
    key: "rm-purchase",
    label: "Material Planning & Purchase",
    roles: [...allRoles],
    icon: <ShoppingCart className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      { to: "/rm-po-grn", navKey: "grn", label: "Material Planning", roles: ["ADMIN", "STORE"], icon: <ShoppingCart className="h-4 w-4 shrink-0" /> },
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
    roles: [...opsRolesNoAccounts],
    icon: <Factory className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      { to: "/planning-dashboard", navKey: "plan-dash", label: "Requirement & Cycle Planning", roles: [...PLANNING_DASHBOARD_ROLES], icon: <BarChart3 className="h-4 w-4 shrink-0" /> },
      { to: "/work-orders", navKey: "wo", label: "Work Order", roles: ["ADMIN", "PRODUCTION"], icon: <Factory className="h-4 w-4 shrink-0" /> },
      { to: "/production", navKey: "prod", label: "Production", roles: ["ADMIN", "PRODUCTION"], icon: <GitBranch className="h-4 w-4 shrink-0" /> },
      { to: "/qc-entry", navKey: "qc", label: "QC", roles: [...QC_PAGE_ROLES], icon: <ClipboardCheck className="h-4 w-4 shrink-0" /> },
      { to: "/qc-report", navKey: "qc-report", label: "QC Report", roles: [...opsRolesNoAccounts], icon: <FileText className="h-4 w-4 shrink-0" /> },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    roles: [...allRoles],
    icon: <ClipboardList className="h-4 w-4 shrink-0" />,
    collapsible: false,
    items: [{ to: "/reports", navKey: "reports", label: "Reports", roles: [...REPORTS_WITH_ACCOUNTS_ROLES], icon: <ClipboardList className="h-4 w-4 shrink-0" /> }],
  },
  {
    key: "account",
    label: "Account",
    roles: [...allRoles],
    icon: <UserCircle className="h-4 w-4 shrink-0" />,
    collapsible: false,
    items: [{ to: "/account", navKey: "account-prof", label: "Profile", roles: [...allRoles], icon: <UserCircle className="h-4 w-4 shrink-0" /> }],
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
      pathname === "/suppliers" ||
      pathname === "/boms" ||
      pathname.startsWith("/admin/backup-restore") ||
      pathname.startsWith("/masters/tally-import")
    );
  if (group.key === "sales-flow")
    return ["/enquiries", "/quotations", "/sales-orders", "/dispatch", "/sales-bills", "/customer-returns", "/customer-po-tracking"].some((p) =>
      pathname.startsWith(p),
    );
  if (group.key === "rm-purchase") return ["/rm-po-grn", "/purchase-bills", "/stock"].some((p) => pathname.startsWith(p));
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
  const role = auth.user?.role || "";
  const pageTitle =
    pathname === "/dashboard" && role === "ACCOUNTS" ? "Accounts" : getPageTitle(pathname);

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
          "erp-sidebar flex shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white transition-[width] duration-200 ease-in-out",
          sidebarCollapsed ? "w-[3.25rem]" : "w-48 sm:w-56",
        )}
        data-sidebar-collapsed={sidebarCollapsed ? "1" : "0"}
      >
        <DemoGatedNavLink
          to="/dashboard"
          title={sidebarCollapsed ? "Dashboard · Mini ERP home" : undefined}
          className={({ isActive }) =>
            cn(
              "flex shrink-0 items-center border-b border-slate-200 text-sm font-semibold text-slate-900 no-underline hover:bg-slate-50",
              sidebarCollapsed ? "justify-center px-0 py-2.5" : "erp-sidebar-brand",
              isActive ? "bg-blue-50 text-blue-900" : "",
            )
          }
        >
          {sidebarCollapsed ? (
            <LayoutDashboard className="h-5 w-5 shrink-0 text-blue-800" aria-hidden />
          ) : (
            "Mini ERP"
          )}
        </DemoGatedNavLink>
        <nav
          id="erp-sidebar-nav"
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-4 pt-1",
            sidebarCollapsed ? "px-1" : "px-2",
          )}
        >
          {navGroups.map((group) => {
            const visible = group.items.filter((n) => n.roles.includes(role));
            if (!visible.length) return null;

            if (!group.collapsible) {
              const item = visible[0] ?? null;
              if (!item) return null;
              return (
                <div key={group.key} className="pt-0.5">
                  <DemoGatedNavLink
                    to={item.to}
                    end={item.end === true}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        "erp-nav-link",
                        sidebarCollapsed && "justify-center gap-0 px-1.5 py-2",
                        isActive ? "erp-nav-link-active" : "",
                      )
                    }
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
                    defaultOpen ? "bg-slate-50" : "",
                    sidebarCollapsed && "justify-center gap-0 px-1.5 py-2",
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
                <div className={cn("mt-1 space-y-0.5", sidebarCollapsed ? "pl-0" : "pl-3")}>
                  {visible.map((item) => (
                    <DemoGatedNavLink
                      key={item.navKey}
                      to={item.to}
                      end={item.end === true}
                      title={sidebarCollapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          "erp-nav-link py-1.5 text-[13px]",
                          sidebarCollapsed && "justify-center gap-0 px-1.5",
                          isActive ? "erp-nav-link-active" : "",
                        )
                      }
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
            <h1 className="min-w-0 max-w-[40vw] shrink truncate border-l-[3px] border-l-blue-800 pl-2.5 text-lg font-bold leading-tight tracking-tight text-slate-950 sm:max-w-[min(50vw,28rem)] sm:pl-3 sm:text-xl">
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
