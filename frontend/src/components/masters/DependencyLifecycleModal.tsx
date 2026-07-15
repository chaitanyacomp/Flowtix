import { ErpModal } from "../erp/ErpModal";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export type DependencySummary = {
  entityType: "BOM" | "ITEM";
  entityId: number;
  entityName: string;
  safeToDelete: boolean;
  totalDependencies: number;
  dependencies: Array<{ key: string; label: string; count: number }>;
};

export function DependencyLifecycleModal(props: {
  open: boolean;
  summary: DependencySummary | null;
  loading?: boolean;
  onClose: () => void;
  onDelete: () => void;
  onDeactivate: () => void;
}) {
  const { summary } = props;
  return (
    <ErpModal open={props.open} onClose={props.onClose} aria-labelledby="dependency-analysis-title">
      <Card className="w-full max-w-md overflow-hidden rounded-xl">
        <CardHeader><CardTitle id="dependency-analysis-title">Dependency analysis</CardTitle></CardHeader>
        <CardContent>{props.loading || !summary ? (
        <p className="text-sm text-slate-600">Checking all references…</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="font-medium text-slate-900">{summary.entityName}</div>
            <div className={summary.safeToDelete ? "text-sm text-emerald-700" : "text-sm text-amber-700"}>
              {summary.safeToDelete
                ? "Safe to delete. No business history was found."
                : `Permanent deletion is blocked by ${summary.totalDependencies} reference(s).`}
            </div>
          </div>
          {summary.dependencies.length ? (
            <div className="max-h-64 divide-y overflow-auto rounded-md border">
              {summary.dependencies.map((d) => (
                <div key={d.key} className="flex justify-between px-3 py-2 text-sm">
                  <span>{d.label}</span><strong>{d.count}</strong>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={props.onClose}>Cancel</Button>
            {!summary.safeToDelete ? <Button variant="outline" onClick={props.onDeactivate}>Mark Inactive</Button> : null}
            {summary.safeToDelete ? <Button variant="destructive" onClick={props.onDelete}>Delete permanently</Button> : null}
          </div>
        </div>
      )}</CardContent></Card>
    </ErpModal>
  );
}
