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
  ChevronRight,
} from "lucide-react";

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

const allRoles = ["ADMIN", "SALES", "STORE", "PRODUCTION", "QC", "SUPERVISOR"] as const;

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
    roles: [...allRoles],
    icon: <Package className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      { to: "/customers", navKey: "cust", label: "Customers", roles: ["ADMIN", "SALES"], icon: <Users className="h-4 w-4 shrink-0" /> },
      { to: "/items", navKey: "items", label: "Items", roles: ["ADMIN", "STORE"], icon: <Package className="h-4 w-4 shrink-0" /> },
      { to: "/opening-stock", navKey: "opening-stock", label: "Opening Stock", roles: ["ADMIN", "STORE"], icon: <Boxes className="h-4 w-4 shrink-0" /> },
      { to: "/units", navKey: "units", label: "Units", roles: ["ADMIN", "STORE"], icon: <Ruler className="h-4 w-4 shrink-0" /> },
      { to: "/suppliers", navKey: "supp", label: "Suppliers", roles: ["ADMIN", "STORE"], icon: <Building2 className="h-4 w-4 shrink-0" /> },
      { to: "/boms", navKey: "boms", label: "BOM", roles: ["ADMIN", "STORE", "PRODUCTION"], icon: <Network className="h-4 w-4 shrink-0" /> },
    ],
  },
  {
    key: "sales-flow",
    label: "Sales Flow",
    roles: [...allRoles],
    icon: <FileSpreadsheet className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      { to: "/enquiries", navKey: "enq", label: "Enquiries", roles: ["ADMIN", "SALES"], icon: <MessageSquare className="h-4 w-4 shrink-0" /> },
      { to: "/quotations", navKey: "quot", label: "Quotations", roles: ["ADMIN", "SALES", "STORE"], icon: <FileText className="h-4 w-4 shrink-0" /> },
      { to: "/sales-orders", navKey: "so", label: "Sales Orders", roles: ["ADMIN", "STORE", "SALES", "PRODUCTION"], icon: <FileSpreadsheet className="h-4 w-4 shrink-0" /> },
      { to: "/dispatch", navKey: "disp", label: "Dispatch", roles: ["ADMIN", "SALES"], icon: <Truck className="h-4 w-4 shrink-0" /> },
      { to: "/sales-bills", navKey: "salebill", label: "Sales Bills", roles: ["ADMIN", "SALES"], icon: <Receipt className="h-4 w-4 shrink-0" /> },
      { to: "/customer-returns", navKey: "cust-ret", label: "Customer Return", roles: ["ADMIN", "SALES", "STORE", "PRODUCTION", "QC"], icon: <Table className="h-4 w-4 shrink-0" /> },
    ],
  },
  {
    key: "rm-purchase",
    label: "RM & Purchase",
    roles: [...allRoles],
    icon: <ShoppingCart className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      { to: "/rm-po-grn", navKey: "grn", label: "RM Purchase", roles: ["ADMIN", "STORE"], icon: <ShoppingCart className="h-4 w-4 shrink-0" /> },
      {
        to: "/purchase-bills",
        navKey: "purbill",
        label: "Purchase Bills",
        roles: ["ADMIN", "STORE"],
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
        roles: ["ADMIN", "STORE"],
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
    roles: [...allRoles],
    icon: <Factory className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      { to: "/planning-dashboard", navKey: "plan-dash", label: "Planning", roles: ["ADMIN", "PRODUCTION", "STORE", "SALES"], icon: <BarChart3 className="h-4 w-4 shrink-0" /> },
      { to: "/planning-dashboard/production", navKey: "plan-prod", label: "Prod Planning", roles: ["ADMIN", "PRODUCTION", "STORE", "SALES"], icon: <BarChart3 className="h-4 w-4 shrink-0" /> },
      { to: "/work-orders", navKey: "wo", label: "Work Order", roles: ["ADMIN", "PRODUCTION"], icon: <Factory className="h-4 w-4 shrink-0" /> },
      { to: "/production", navKey: "prod", label: "Production", roles: ["ADMIN", "PRODUCTION"], icon: <GitBranch className="h-4 w-4 shrink-0" /> },
      { to: "/qc-entry", navKey: "qc", label: "QC", roles: ["ADMIN", "QC", "SUPERVISOR"], icon: <ClipboardCheck className="h-4 w-4 shrink-0" /> },
      { to: "/qc-report", navKey: "qc-report", label: "QC Report", roles: [...allRoles], icon: <FileText className="h-4 w-4 shrink-0" /> },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    roles: [...allRoles],
    icon: <ClipboardList className="h-4 w-4 shrink-0" />,
    collapsible: false,
    items: [{ to: "/reports", navKey: "reports", label: "Reports", roles: ["ADMIN", "SALES", "STORE", "PRODUCTION"], icon: <ClipboardList className="h-4 w-4 shrink-0" /> }],
  },
  {
    key: "settings",
    label: "Settings",
    roles: ["ADMIN"],
    icon: <Settings className="h-4 w-4 shrink-0" />,
    collapsible: true,
    items: [
      { to: "/admin/settings", navKey: "admset", label: "Settings", roles: ["ADMIN"], icon: <Settings className="h-4 w-4 shrink-0" /> },
      { to: "/admin/database-cleanup", navKey: "db-cleanup", label: "Database Cleanup", roles: ["ADMIN"], icon: <Database className="h-4 w-4 shrink-0" /> },
      { to: "/activity", navKey: "activity", label: "Activity", roles: ["ADMIN"], icon: <History className="h-4 w-4 shrink-0" /> },
    ],
  },
];

function DemoGatedNavLink({
  to,
  end,
  className,
  children,
}: {
  to: string;
  end?: boolean;
  className?: string | ((args: { isActive: boolean }) => string);
  children: ReactNode;
}) {
  const demo = useDemoMode();
  const blocked = demo.enabled && !isDemoNavigationAllowed(to, demo.flow, demo.step);
  return (
    <NavLink
      to={to}
      end={end === true}
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
  if (group.key === "masters") return pathname === "/customers" || pathname === "/items" || pathname === "/units" || pathname === "/suppliers" || pathname === "/boms";
  if (group.key === "sales-flow") return ["/enquiries", "/quotations", "/sales-orders", "/dispatch", "/sales-bills", "/customer-returns"].some((p) => pathname.startsWith(p));
  if (group.key === "rm-purchase") return ["/rm-po-grn", "/purchase-bills", "/stock"].some((p) => pathname.startsWith(p));
  if (group.key === "production-flow")
    return ["/planning-dashboard", "/work-orders", "/production", "/qc-entry", "/qc-report"].some((p) => pathname.startsWith(p));
  if (group.key === "settings")
    return pathname.startsWith("/admin/settings") || pathname.startsWith("/admin/database-cleanup") || pathname.startsWith("/activity");
  return false;
}

export function AppLayout() {
  const auth = useAuth();
  const demo = useDemoMode();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const pageTitle = getPageTitle(pathname);

  const role = auth.user?.role || "";

  function onLogout() {
    auth.logout();
    nav("/login");
  }

  return (
    <div className="erp-shell">
      <aside className="erp-sidebar flex w-48 shrink-0 sm:w-56">
        <DemoGatedNavLink to="/dashboard" className="erp-sidebar-brand">
          Mini ERP
        </DemoGatedNavLink>
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-4">
          {navGroups.map((group) => {
            const visible = group.items.filter((n) => n.roles.includes(role));
            if (!visible.length) return null;

            if (!group.collapsible) {
              const item = visible[0] ?? null;
              if (!item) return null;
              return (
                <div key={group.key} className="pt-1">
                  <DemoGatedNavLink
                    to={item.to}
                    end={item.end === true}
                    className={({ isActive }) => cn("erp-nav-link", isActive ? "erp-nav-link-active" : "")}
                  >
                    {group.icon}
                    <span className="min-w-0 truncate">{group.label}</span>
                  </DemoGatedNavLink>
                </div>
              );
            }

            const defaultOpen = groupDefaultOpen(pathname, group);
            return (
              <details key={group.key} className="group" open={defaultOpen}>
                <summary className={cn("erp-nav-link list-none cursor-pointer select-none", defaultOpen ? "bg-slate-50" : "")}>
                  {group.icon}
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                  <span className="ml-auto inline-flex items-center text-slate-400">
                    <ChevronRight className="h-4 w-4 group-open:hidden" />
                    <ChevronDown className="h-4 w-4 hidden group-open:block" />
                  </span>
                </summary>
                <div className="mt-1 space-y-0.5 pl-3">
                  {visible.map((item) => (
                    <DemoGatedNavLink
                      key={item.navKey}
                      to={item.to}
                      end={item.end === true}
                      className={({ isActive }) =>
                        cn("erp-nav-link py-1.5 text-[13px]", isActive ? "erp-nav-link-active" : "")
                      }
                    >
                      {item.icon}
                      <span className="min-w-0 truncate">{item.label}</span>
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
          <h1 className="min-w-0 shrink truncate text-base font-semibold text-slate-900">{pageTitle}</h1>
          <div className="mx-1 flex min-w-0 max-w-full flex-1 justify-center px-1 sm:mx-2">
            <GlobalSearch />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium text-slate-900">{auth.user?.name}</div>
              <div className="text-xs text-slate-500">{auth.user?.role}</div>
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

        <main className="erp-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
