import { AlertTriangle, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";

type Props = {
  message: string;
  technicalDetail?: string | null;
  showAdminDebug?: boolean;
  onRetry?: () => void | Promise<void>;
  retryLabel?: string;
  retryLoading?: boolean;
  backHref?: string;
  backLabel?: string;
  className?: string;
};

export function OperationalSystemErrorCard({
  message,
  technicalDetail,
  showAdminDebug,
  onRetry,
  retryLabel = "Retry",
  retryLoading = false,
  backHref,
  backLabel = "Back to Sales Orders",
  className,
}: Props) {
  const paragraphs = message.split(/\n\n+/).filter(Boolean);

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[620px] rounded-lg border border-amber-300/80 bg-amber-50/95 px-3 py-3 text-center shadow-sm",
        className,
      )}
      role="alert"
    >
      <AlertTriangle className="mx-auto h-6 w-6 text-amber-700" aria-hidden />
      <div className="mt-1.5 space-y-1 text-[13px] leading-snug text-slate-800">
        {paragraphs.map((p) => (
          <p key={p} className={p === paragraphs[0] ? "font-semibold text-slate-900" : ""}>
            {p}
          </p>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
        {onRetry ? (
          <Button
            type="button"
            size="sm"
            className="h-9 min-w-[9.5rem] px-4 text-[13px] font-semibold"
            disabled={retryLoading}
            onClick={() => void onRetry()}
          >
            {retryLoading ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  aria-hidden
                />
                Initializing…
              </span>
            ) : (
              retryLabel
            )}
          </Button>
        ) : null}
        {backHref ? (
          <Link
            to={backHref}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "inline-flex h-9 min-w-[9.5rem] items-center justify-center px-4 text-[13px] font-semibold no-underline",
            )}
          >
            {backLabel}
          </Link>
        ) : null}
      </div>
      {showAdminDebug && technicalDetail ? (
        <details className="mt-2.5 text-left">
          <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
            Technical details
          </summary>
          <pre className="mt-1.5 max-h-28 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-slate-700/40 bg-slate-900 p-2.5 text-left font-mono text-[10px] leading-relaxed text-slate-200">
            {technicalDetail}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
