import { Badge } from "../ui/badge";
import {
  itemStockStatusBadgeVariant,
  itemStockStatusFromItemFields,
  itemStockStatusLabel,
} from "../../lib/itemStockStatus";
import { cn } from "../../lib/utils";

type ItemStockStatusBadgeProps = {
  currentQty: number;
  minimumStockQty?: string | number | null;
  minStockLevel?: string | number | null;
  className?: string;
};

/**
 * Stock status chip — same labels and Badge variants as Item master.
 */
export function ItemStockStatusBadge({
  currentQty,
  minimumStockQty,
  minStockLevel,
  className,
}: ItemStockStatusBadgeProps) {
  const status = itemStockStatusFromItemFields({ currentQty, minimumStockQty, minStockLevel });
  return (
    <Badge
      variant={itemStockStatusBadgeVariant(status)}
      className={cn(
        "whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold",
        status === "OUT_OF_STOCK" && "border-red-950 bg-red-950 text-white",
        className,
      )}
    >
      {itemStockStatusLabel(status)}
    </Badge>
  );
}
