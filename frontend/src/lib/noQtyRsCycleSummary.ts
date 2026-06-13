import { apiFetch } from "../services/api";

export type NoQtyRsCycleSummaryStatus = "DRAFT" | "LOCKED" | "CANCELLED";

export type NoQtyRsCycleSummaryEntry = {
  cycleId: number;
  cycleNo: number;
  sheetId: number;
  docNo: string | null;
  status: NoQtyRsCycleSummaryStatus;
  /** Sum of new requirement qty (FG lines) on the winning RS for this cycle. */
  totalNewRequirementQty: number;
  qtyByItemId: Record<number, number>;
};

type SheetListRowLike = {
  id: number;
  cycleId?: number | null;
  cycleNo?: number | null;
  version?: number | null;
  status: NoQtyRsCycleSummaryStatus;
};

type SheetDetailLike = {
  id: number;
  docNo?: string | null;
  cycleId?: number | null;
  status: NoQtyRsCycleSummaryStatus;
  lines?: Array<{ itemId: number; requirementQty?: string; newWoQty?: string }>;
};

function sheetVersionNum(v: number | null | undefined): number {
  const n = Number(v ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function cycleGroupKey(row: SheetListRowLike): number {
  if (row.cycleNo != null && Number.isFinite(Number(row.cycleNo)) && Number(row.cycleNo) > 0) {
    return Number(row.cycleNo);
  }
  if (row.cycleId != null && Number.isFinite(Number(row.cycleId))) return Number(row.cycleId);
  return row.id;
}

/** One winning RS per cycle: prefer DRAFT over LOCKED, then highest version. */
export function pickWinningSheetPerCycle(sheets: SheetListRowLike[]): SheetListRowLike[] {
  const byCycle = new Map<number, SheetListRowLike[]>();
  for (const row of sheets) {
    if (row.status === "CANCELLED") continue;
    const key = cycleGroupKey(row);
    const bucket = byCycle.get(key) ?? [];
    bucket.push(row);
    byCycle.set(key, bucket);
  }

  const winners: SheetListRowLike[] = [];
  for (const rows of byCycle.values()) {
    const sortByVersion = (a: SheetListRowLike, b: SheetListRowLike) =>
      sheetVersionNum(b.version) - sheetVersionNum(a.version) || b.id - a.id;
    const drafts = rows.filter((r) => r.status === "DRAFT").sort(sortByVersion);
    const locked = rows.filter((r) => r.status === "LOCKED").sort(sortByVersion);
    const pick = drafts[0] ?? locked[0] ?? null;
    if (pick) winners.push(pick);
  }

  return winners.sort((a, b) => {
    const na = a.cycleNo ?? cycleGroupKey(a);
    const nb = b.cycleNo ?? cycleGroupKey(b);
    return na - nb || a.id - b.id;
  });
}

function buildEntryFromDetail(listRow: SheetListRowLike, detail: SheetDetailLike): NoQtyRsCycleSummaryEntry {
  let total = 0;
  const qtyByItemId: Record<number, number> = {};
  for (const ln of detail.lines ?? []) {
    const itemId = Number(ln.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;
    const q = safeNum(ln.newWoQty ?? ln.requirementQty);
    total += q;
    qtyByItemId[itemId] = (qtyByItemId[itemId] ?? 0) + q;
  }
  return {
    cycleId: Number(listRow.cycleId ?? detail.cycleId ?? 0),
    cycleNo: Number(listRow.cycleNo ?? 0),
    sheetId: detail.id,
    docNo: detail.docNo ?? null,
    status: detail.status,
    totalNewRequirementQty: total,
    qtyByItemId,
  };
}

export function mergeLiveSheetIntoCycleSummaries(
  entries: NoQtyRsCycleSummaryEntry[],
  liveSheet: SheetDetailLike | null,
  liveListRow: SheetListRowLike | null,
): NoQtyRsCycleSummaryEntry[] {
  if (!liveSheet || !liveListRow) return entries;
  const liveEntry = buildEntryFromDetail(liveListRow, liveSheet);
  const idx = entries.findIndex((e) => e.sheetId === liveEntry.sheetId || e.cycleNo === liveEntry.cycleNo);
  if (idx >= 0) {
    const next = [...entries];
    next[idx] = liveEntry;
    return next.sort((a, b) => a.cycleNo - b.cycleNo);
  }
  return [...entries, liveEntry].sort((a, b) => a.cycleNo - b.cycleNo);
}

export async function loadNoQtyRsCycleSummaries(
  sheets: SheetListRowLike[],
  opts?: { liveSheet?: SheetDetailLike | null },
): Promise<NoQtyRsCycleSummaryEntry[]> {
  const winners = pickWinningSheetPerCycle(sheets);
  if (winners.length === 0) return [];

  const liveId = opts?.liveSheet?.id ?? null;
  const idsToFetch = winners.map((w) => w.id).filter((id) => id !== liveId);

  const fetched = await Promise.all(
    idsToFetch.map((id) => apiFetch<SheetDetailLike>(`/api/requirement-sheets/${id}`)),
  );

  const detailById = new Map<number, SheetDetailLike>();
  for (const d of fetched) detailById.set(d.id, d);
  if (opts?.liveSheet) detailById.set(opts.liveSheet.id, opts.liveSheet);

  const entries = winners.map((row) => {
    const detail = detailById.get(row.id);
    if (!detail) {
      return {
        cycleId: Number(row.cycleId ?? 0),
        cycleNo: Number(row.cycleNo ?? 0),
        sheetId: row.id,
        docNo: null,
        status: row.status,
        totalNewRequirementQty: 0,
        qtyByItemId: {},
      };
    }
    return buildEntryFromDetail(row, detail);
  });

  return entries;
}

export function totalPreviousCyclesQty(
  entries: NoQtyRsCycleSummaryEntry[],
  currentCycleNo: number | null | undefined,
): number {
  const cur = currentCycleNo != null ? Number(currentCycleNo) : NaN;
  return entries
    .filter((e) => !Number.isFinite(cur) || e.cycleNo < cur)
    .reduce((s, e) => s + e.totalNewRequirementQty, 0);
}

export function totalAllCyclesQty(entries: NoQtyRsCycleSummaryEntry[]): number {
  return entries.reduce((s, e) => s + e.totalNewRequirementQty, 0);
}

export function previousCyclesQtyForItem(
  entries: NoQtyRsCycleSummaryEntry[],
  itemId: number,
  currentCycleNo: number | null | undefined,
): number {
  const cur = currentCycleNo != null ? Number(currentCycleNo) : NaN;
  return entries
    .filter((e) => !Number.isFinite(cur) || e.cycleNo < cur)
    .reduce((s, e) => s + safeNum(e.qtyByItemId[itemId]), 0);
}

export function allCyclesQtyForItem(
  entries: NoQtyRsCycleSummaryEntry[],
  itemId: number,
  currentCycleNewReq: number,
  currentCycleNo: number | null | undefined,
): number {
  return previousCyclesQtyForItem(entries, itemId, currentCycleNo) + safeNum(currentCycleNewReq);
}

export function formatRsCycleSummaryStatus(status: NoQtyRsCycleSummaryStatus): string {
  if (status === "LOCKED") return "Locked";
  if (status === "DRAFT") return "Draft";
  return "Cancelled";
}
