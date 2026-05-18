import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

/** Global ERP button scale — all tiers share h-8 operational height. */
const buttonVariants = cva(
  "erp-btn inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
  {
    variants: {
      variant: {
        default:
          "erp-btn--primary border border-blue-700/20 bg-blue-600 text-white shadow-[0_1px_2px_0_rgb(29_78_216_/0.35)] hover:border-blue-700/30 hover:bg-blue-700 hover:shadow-[0_2px_4px_0_rgb(29_78_216_/0.28)]",
        secondary:
          "erp-btn--secondary border border-slate-200 bg-slate-50 text-slate-900 shadow-sm hover:border-slate-300 hover:bg-slate-100",
        outline:
          "erp-btn--tertiary border border-slate-200/90 bg-white font-medium text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
        destructive:
          "erp-btn--danger border border-red-700/15 bg-red-600 text-white shadow-[0_1px_2px_0_rgb(220_38_38_/0.28)] hover:bg-red-700 hover:shadow-[0_2px_4px_0_rgb(220_38_38_/0.22)]",
        ghost: "erp-btn--ghost border border-transparent bg-transparent font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      },
      size: {
        default: "h-8 px-3.5 text-[13px] leading-none",
        sm: "h-8 px-3 text-[13px] leading-none",
        lg: "h-9 px-4 text-sm leading-none",
        icon: "h-8 w-8 shrink-0 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
