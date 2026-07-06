import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/utils";
import type { ProcurementRelatedDocumentEntry } from "../../lib/procurementRelatedDocuments";

type Props = {
  documents: ProcurementRelatedDocumentEntry[];
  className?: string;
};

function DocumentValue({ doc }: { doc: ProcurementRelatedDocumentEntry }) {
  if (doc.status === "current") {
    return (
      <span className="font-semibold text-slate-900">
        {doc.displayNo}
        <span className="ml-1.5 text-xs font-medium normal-case text-slate-500">(current)</span>
      </span>
    );
  }
  if (doc.href && doc.status === "available") {
    return (
      <Link
        to={doc.href}
        className="font-semibold text-primary underline underline-offset-2"
        data-testid={`procurement-related-doc-link-${doc.kind.toLowerCase()}${doc.entityId != null ? `-${doc.entityId}` : ""}`}
      >
        {doc.displayNo}
      </Link>
    );
  }
  return <span className="font-semibold text-slate-500">{doc.displayNo}</span>;
}

export function ProcurementRelatedDocuments({ documents, className }: Props) {
  if (!documents.length) return null;

  return (
    <section
      className={cn(
        "rm-po-no-print border-b border-slate-200 bg-slate-50/60 px-4 py-3 md:px-6",
        className,
      )}
      data-testid="procurement-related-documents"
    >
      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600">Related Documents</h2>
      <dl className="mt-2 space-y-1.5">
        {documents.map((doc) => (
          <div
            key={`${doc.kind}-${doc.entityId ?? doc.displayNo}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
            data-testid={`procurement-related-doc-row-${doc.kind.toLowerCase()}${doc.entityId != null ? `-${doc.entityId}` : ""}`}
          >
            <dt className="w-[8.5rem] shrink-0 font-medium text-slate-600">{doc.label}</dt>
            <dd>
              <DocumentValue doc={doc} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
