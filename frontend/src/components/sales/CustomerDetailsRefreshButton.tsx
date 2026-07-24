import { Button } from "../ui/button";

export function CustomerDetailsRefreshButton({
  status,
  refreshing,
  onRefresh,
}: {
  status: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  if (status !== "DRAFT") return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-8 border-sky-300 bg-sky-50 text-[11px] font-semibold text-sky-900 hover:bg-sky-100"
      data-testid="refresh-customer-details"
      onClick={onRefresh}
      disabled={refreshing}
    >
      {refreshing ? "Refreshing…" : "Refresh customer details"}
    </Button>
  );
}
