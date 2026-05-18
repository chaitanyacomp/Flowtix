import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { cn } from "../../../lib/utils";
import { erpSection } from "../../../lib/erpFoundationTokens";

type ErpSectionCardProps = {
  title?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
};

/** Standard section card padding + border — use for dashboard / ops panels. */
export function ErpSectionCard({ title, children, className, contentClassName }: ErpSectionCardProps) {
  return (
    <Card className={cn(erpSection.card, className)}>
      {title ? (
        <CardHeader className={cn(erpSection.cardHeader, "pb-2 pt-3")}>
          <CardTitle className="erp-type-section-title">{title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent className={cn(erpSection.cardBody, title ? "pt-0" : "pt-3", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
