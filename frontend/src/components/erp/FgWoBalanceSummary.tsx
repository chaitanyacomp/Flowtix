import { StatBlock } from "./StatBlock";

type FgWoBalanceItem = {
  soOrderedQty: number;
  plannedOnOtherWorkOrdersQty: number;
  producedQty?: number;
  balanceQty: number;
};

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

/**
 * Scannable FG vs SO line balance for work order entry (operational, not faint helper text).
 */
export function FgWoBalanceSummary({
  balance,
  fallbackSoOrdered,
}: {
  balance: FgWoBalanceItem | undefined;
  fallbackSoOrdered?: number;
}) {
  if (balance) {
    const produced = balance.producedQty ?? 0;
    return (
      <div
        className="mt-2 flex flex-wrap gap-2"
        role="group"
        aria-label="Work order planning quantities for this finished good"
      >
        <StatBlock label="SO qty" value={fmtQty(balance.soOrderedQty)} />
        <StatBlock label="Already planned (WO)" value={fmtQty(balance.plannedOnOtherWorkOrdersQty)} />
        <StatBlock label="Produced qty" value={fmtQty(produced)} />
        <StatBlock label="Remaining for planning" value={fmtQty(balance.balanceQty)} emphasis />
      </div>
    );
  }
  if (fallbackSoOrdered != null && Number.isFinite(fallbackSoOrdered)) {
    return (
      <p className="mt-2 text-xs text-slate-600">
        SO qty: <span className="font-medium tabular-nums text-slate-800">{fmtQty(fallbackSoOrdered)}</span>
        <span className="text-slate-500"> · Balance details load after FG list is available.</span>
      </p>
    );
  }
  return null;
}
