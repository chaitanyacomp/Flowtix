import * as React from "react";
import { cn } from "../../../lib/utils";
import { erpWorkflow } from "../../../lib/erpFoundationTokens";

type Tone = "neutral" | "info" | "warning" | "success";

export function ErpWorkflowBanner({
  children,
  className,
  tone = "neutral",
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  const dataTone = tone === "neutral" ? undefined : tone;
  return (
    <div
      className={cn(erpWorkflow.banner, className)}
      data-tone={dataTone}
      {...rest}
    >
      {children}
    </div>
  );
}
