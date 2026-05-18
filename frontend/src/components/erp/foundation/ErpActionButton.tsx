import { Button, type ButtonProps } from "../../ui/button";
import { cn } from "../../../lib/utils";
import type { ErpActionTier } from "../../../lib/erpFoundationTokens";

const tierVariant: Record<ErpActionTier, NonNullable<ButtonProps["variant"]>> = {
  primary: "default",
  secondary: "secondary",
  tertiary: "outline",
  danger: "destructive",
};

export type ErpActionButtonProps = ButtonProps & {
  tier?: ErpActionTier;
};

/**
 * ERP action hierarchy — all tiers use the global h-8 button scale.
 * Primary = workflow CTA; secondary = open/continue; tertiary = reset/clear; danger = destructive.
 */
export function ErpActionButton({ tier = "primary", className, variant, size, ...rest }: ErpActionButtonProps) {
  return (
    <Button
      variant={variant ?? tierVariant[tier]}
      size={size ?? "sm"}
      className={cn("erp-type-action-button", className)}
      {...rest}
    />
  );
}
