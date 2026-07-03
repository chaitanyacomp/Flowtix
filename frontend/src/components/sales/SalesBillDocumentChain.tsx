import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowDown } from "lucide-react";
import { displayDispatchNo, displaySalesBillNo, displaySalesOrderNo } from "../../lib/docNoDisplay";
import { cn } from "../../lib/utils";

export function SalesBillDocumentChain({
  salesOrderId,
  salesOrderDocNo,
  dispatchId,
  dispatchDocNo,
  billId,
  billDocNo,
  className,
}: {
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  dispatchId: number;
  dispatchDocNo?: string | null;
  billId: number;
  billDocNo?: string | null;
  className?: string;
}) {
  const billLabel = displaySalesBillNo(billId, null, billDocNo);
  const soLabel = displaySalesOrderNo(salesOrderId, salesOrderDocNo);
  const dispatchLabel = displayDispatchNo(dispatchId, dispatchDocNo);

  const steps = [
    { key: "so", title: "Sales Order", label: soLabel, href: `/sales-orders/${salesOrderId}` },
    { key: "dispatch", title: "Dispatch", label: dispatchLabel, href: `/dispatch?salesOrderId=${salesOrderId}` },
    { key: "bill", title: "Sales Bill", label: billLabel, href: null as string | null, current: true },
  ];

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-gradient-to-b from-slate-50/90 to-white px-3 py-2.5",
        className,
      )}
      data-testid="sales-bill-document-chain"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
        {steps.map((step, idx) => (
          <React.Fragment key={step.key}>
            {idx > 0 ? (
              <div className="flex items-center justify-center text-slate-300 sm:px-0" aria-hidden>
                <ArrowDown className="h-4 w-4 sm:rotate-[-90deg]" />
              </div>
            ) : null}
            <div
              className={cn(
                "min-w-0 flex-1 rounded-md border px-2.5 py-2",
                step.current
                  ? "border-emerald-200 bg-emerald-50/80 ring-1 ring-emerald-100"
                  : "border-slate-200 bg-white",
              )}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{step.title}</div>
              {step.href ? (
                <Link
                  to={step.href}
                  className="mt-0.5 block truncate font-mono text-[13px] font-semibold tabular-nums text-sky-800 underline decoration-sky-800/30 underline-offset-2 hover:text-sky-950"
                >
                  {step.label}
                </Link>
              ) : (
                <div className="mt-0.5 truncate font-mono text-[13px] font-semibold tabular-nums text-emerald-950">
                  {step.label}
                </div>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
