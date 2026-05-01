import { Button } from "../ui/button";

export type DemoSafeNoQtyContinueProps = {
  visible: boolean;
  body: string;
  actionLabel: string;
};

/** Safe-demo escape hatch: dispatches `demo:action-complete` only — no API, no persistence. */
export function DemoSafeNoQtyContinue({ visible, body, actionLabel }: DemoSafeNoQtyContinueProps) {
  if (!visible) return null;
  return (
    <div
      className="mt-3 rounded-md border border-sky-300 bg-sky-50 px-3 py-3 shadow-sm"
      role="region"
      aria-label="Demo mode shortcut"
    >
      <p className="text-[13px] leading-relaxed text-sky-950">{body}</p>
      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          size="sm"
          className="h-9 shrink-0 font-semibold"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("demo:action-complete"));
          }}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
