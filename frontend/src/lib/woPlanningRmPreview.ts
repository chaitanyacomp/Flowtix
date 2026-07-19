/**
 * Work Order Planning — live RM preview helpers.
 * Keeps quantity typing stable and avoids continuous refetch loops.
 */

export type WoPlanningQtyLine = { itemId: number; qty: number };

/** Stable signature so identical quantities do not retrigger preview. */
export function buildRmPreviewLinesSignature(lines: WoPlanningQtyLine[]): string {
  return [...lines]
    .filter((l) => l.itemId > 0 && Number.isFinite(l.qty) && l.qty > 0)
    .map((l) => ({ itemId: l.itemId, qty: Math.round(l.qty * 1e6) / 1e6 }))
    .sort((a, b) => a.itemId - b.itemId)
    .map((l) => `${l.itemId}:${l.qty}`)
    .join("|");
}

export function resolveRmPreviewLines(opts: {
  requestedLines: WoPlanningQtyLine[];
  suggestedLines: WoPlanningQtyLine[];
}): WoPlanningQtyLine[] {
  if (opts.requestedLines.length > 0) return opts.requestedLines;
  return opts.suggestedLines.filter((l) => l.qty > 0);
}

/**
 * Seed drafts only when the placement line set is new / missing keys.
 * Never overwrite a quantity the operator already has in the draft map.
 */
export function mergePlacementDraftQtys(opts: {
  previous: Record<number, string>;
  lines: Array<{ itemId: number; suggestedExecutableQty: number }>;
  formatQty: (n: number) => string;
}): { next: Record<number, string>; changed: boolean } {
  const { previous, lines, formatQty } = opts;
  const next: Record<number, string> = { ...previous };
  let changed = false;
  const lineIds = new Set<number>();

  for (const line of lines) {
    lineIds.add(line.itemId);
    if (!Object.prototype.hasOwnProperty.call(previous, line.itemId)) {
      next[line.itemId] = formatQty(Math.max(0, line.suggestedExecutableQty));
      changed = true;
    }
  }

  for (const key of Object.keys(next)) {
    const id = Number(key);
    if (!lineIds.has(id)) {
      delete next[id];
      changed = true;
    }
  }

  return { next, changed };
}

/** Preview POST is read-only feasibility — must not bump ERP refresh scopes. */
export function isRequirementSheetRmPreviewPath(path: string): boolean {
  const p = String(path || "")
    .toLowerCase()
    .split("?")[0];
  return p.includes("/requirement-sheet") && p.includes("/execution/rm-preview");
}

/**
 * Aggregate shared RM lines across multiple FG proposed quantities
 * (mirrors backend preview aggregation for frontend regression checks).
 */
export function aggregateSharedRmRequired(
  rows: Array<{ rmItemId: number; requiredQty: number }>,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const row of rows) {
    const id = Number(row.rmItemId);
    if (!(id > 0)) continue;
    const qty = Number(row.requiredQty);
    if (!Number.isFinite(qty) || !(qty > 0)) continue;
    out.set(id, Math.round(((out.get(id) ?? 0) + qty) * 1e6) / 1e6);
  }
  return out;
}
