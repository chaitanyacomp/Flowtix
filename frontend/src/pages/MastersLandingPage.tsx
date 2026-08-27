import * as React from "react";
import { Link } from "react-router-dom";
import {
  Users,
  Building2,
  Package,
  Ruler,
  Boxes,
  Network,
  FileUp,
  HardDrive,
  Cog,
  Clock,
  Gauge,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import {
  ENQUIRY_QUOTATION_WRITE_ROLES,
  SUPPLIER_VIEW_ROLES,
  PRODUCTION_MASTER_READ_ROLES,
} from "../config/erpRoles";
import { MasterListPageShell } from "../components/masters/MasterListWorkbench";
import { cn } from "../lib/utils";

type MasterCard = {
  to: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  roles: string[];
};

const CARDS: MasterCard[] = [
  {
    to: "/customers",
    title: "Customers",
    description: "Customer master, GST details and delivery locations.",
    icon: <Users className="h-5 w-5" />,
    roles: [...ENQUIRY_QUOTATION_WRITE_ROLES],
  },
  {
    to: "/suppliers",
    title: "Suppliers",
    description: "Supplier master, GST details and supply locations.",
    icon: <Building2 className="h-5 w-5" />,
    roles: [...SUPPLIER_VIEW_ROLES],
  },
  {
    to: "/items",
    title: "Items",
    description: "Raw materials, finished goods, semi-finished and consumable items.",
    icon: <Package className="h-5 w-5" />,
    roles: ["ADMIN", "STORE"],
  },
  {
    to: "/units",
    title: "Units",
    description: "Units of measure used across items and documents.",
    icon: <Ruler className="h-5 w-5" />,
    roles: ["ADMIN", "STORE"],
  },
  {
    to: "/machines",
    title: "Machines",
    description: "Production machine register (code, type, make/model). Soft activate/deactivate only.",
    icon: <Cog className="h-5 w-5" />,
    roles: [...PRODUCTION_MASTER_READ_ROLES],
  },
  {
    to: "/operators",
    title: "Operators",
    description: "Production operator register. Soft activate/deactivate only.",
    icon: <Users className="h-5 w-5" />,
    roles: [...PRODUCTION_MASTER_READ_ROLES],
  },
  {
    to: "/shifts",
    title: "Shifts",
    description: "Production shift templates (code, window, break). Soft activate/deactivate only.",
    icon: <Clock className="h-5 w-5" />,
    roles: [...PRODUCTION_MASTER_READ_ROLES],
  },
  {
    to: "/fg-production-standards",
    title: "FG Production Standards",
    description: "FG capacity on a machine (cycle time, cavities, efficiency). Soft activate/deactivate only.",
    icon: <Gauge className="h-5 w-5" />,
    roles: [...PRODUCTION_MASTER_READ_ROLES],
  },
  {
    to: "/locations",
    title: "Locations",
    description: "Store and warehouse locations for stock movements.",
    icon: <Boxes className="h-5 w-5" />,
    roles: ["ADMIN", "STORE"],
  },
  {
    to: "/opening-stock",
    title: "Opening Stock",
    description: "Opening quantity entries for inventory take-on.",
    icon: <Boxes className="h-5 w-5" />,
    roles: ["ADMIN", "STORE"],
  },
  {
    to: "/boms",
    title: "BOM",
    description: "Bill of materials for finished and semi-finished goods.",
    icon: <Network className="h-5 w-5" />,
    roles: ["ADMIN", "STORE"],
  },
  {
    to: "/masters/tally-import",
    title: "Tally import",
    description: "Import Tally party and stock masters (Admin).",
    icon: <FileUp className="h-5 w-5" />,
    roles: ["ADMIN"],
  },
  {
    to: "/admin/backup-restore",
    title: "Backup & Restore",
    description: "Database backup and restore (Admin).",
    icon: <HardDrive className="h-5 w-5" />,
    roles: ["ADMIN"],
  },
];

/**
 * Masters landing hub — canonical target for “Back to Masters”.
 * (Previously missing; Suppliers incorrectly linked to /customers.)
 */
export function MastersLandingPage() {
  const role = useAuth().user?.role || "";
  const visible = CARDS.filter((c) => c.roles.includes(role));

  return (
    <MasterListPageShell>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-slate-900" data-testid="masters-landing-title">
          Masters
        </h1>
        <p className="text-sm text-slate-600">
          Maintain business reference data. Open a master workbench to search, filter, and update records.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="masters-landing-grid">
        {visible.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className={cn(
              "group rounded-md border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow",
            )}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-slate-700 group-hover:bg-white">
                {c.icon}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-slate-900">{c.title}</div>
                <p className="mt-1 text-sm text-slate-600">{c.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </MasterListPageShell>
  );
}
