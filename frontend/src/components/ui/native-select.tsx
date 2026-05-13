import * as React from "react";
import { cn } from "../../lib/utils";

export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

/** Native &lt;select&gt; styled to match {@link Input} height (h-10) and borders for commercial filter rows. */
const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(({ className, ...props }, ref) => {
  return (
    <select
      ref={ref}
      className={cn(
        "flex h-10 w-full min-w-0 cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
