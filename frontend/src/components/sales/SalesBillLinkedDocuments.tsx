import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { displaySalesBillNo, displaySalesOrderNo } from "../../lib/docNoDisplay";
import { cn } from "../../lib/utils";
import { salesBillDispatchDetails, salesBillDispatchLabel, type SalesBillDispatchSource } from "../../lib/salesBillDispatchDisplay";

export function SalesBillLinkedDocuments({
  billId,
  billDocNo,
  salesOrderId,
  salesOrderDocNo,
  dispatchId,
  dispatchDocNo,
  dispatchAllocations,
  customerId,
  customerName,
  isExported,
  className,
}: {
  billId: number;
  billDocNo?: string | null;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  dispatchId: number;
  dispatchDocNo?: string | null;
  dispatchAllocations?: SalesBillDispatchSource[];
  customerId: number;
  customerName: string;
  isExported?: boolean;
  className?: string;
}) {
  const sources = dispatchAllocations?.length ? dispatchAllocations : [{ dispatchId, allocatedQty: 0, dispatch: { docNo: dispatchDocNo } }];
  const links = [
    {
      key: "so",
      label: "Sales Order",
      value: displaySalesOrderNo(salesOrderId, salesOrderDocNo),
      href: `/sales-orders/${salesOrderId}`,
    },
    {
      key: "dispatch",
      label: "Dispatch",
      value: salesBillDispatchLabel(sources),
      href: `/dispatch?salesOrderId=${salesOrderId}`,
    },
    {
      key: "customer",
      label: "Customer",
      value: customerName,
      href: `/customers/${customerId}`,
    },
    {
      key: "bill",
      label: "Sales Bill",
      value: displaySalesBillNo(billId, null, billDocNo),
      href: `/sales-bills/${billId}`,
    },
  ];

  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white", className)} data-testid="sales-bill-linked-documents">
      <div className="border-b border-slate-100 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Linked documents</h3>
      </div>
      <ul className="divide-y divide-slate-100 px-3 py-1">
        {links.map((link) => (
          <li key={link.key} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{link.label}</div>
              <div className="truncate font-mono text-[12px] font-semibold tabular-nums text-slate-900">{link.value}</div>
              {link.key === "dispatch" && sources.length > 1 ? <div className="mt-0.5 text-[10px] text-slate-500">{salesBillDispatchDetails(sources).join(" Â· ")}</div> : null}
            </div>
            <Link
              to={link.href}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-sky-800 hover:text-sky-950"
            >
              Open
              <ExternalLink className="h-3 w-3 opacity-70" aria-hidden />
            </Link>
          </li>
        ))}
        <li className="flex items-center justify-between gap-2 py-2">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Export status</div>
            <div className={cn("text-[12px] font-semibold", isExported ? "text-emerald-800" : "text-amber-800")}>
              {isExported ? "XML downloaded" : "Not exported"}
            </div>
          </div>
        </li>
      </ul>
    </div>
  );
}
