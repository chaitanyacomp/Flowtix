/**

 * Monthly Planning — FG Green Level row display (read-only, API-sourced).

 * Green Level is FG planning buffer — not RM minimum/low stock alerts.

 */



export const GREEN_LEVEL_HISTORY_MONTH_OPTIONS = [3, 6, 12] as const;



export type GreenLevelSource = "MANUAL" | "AUTOMATIC";



export function greenLevelBasisTooltip(historyMonths = 6, source: GreenLevelSource = "AUTOMATIC"): string {

  const m = GREEN_LEVEL_HISTORY_MONTH_OPTIONS.includes(historyMonths as (typeof GREEN_LEVEL_HISTORY_MONTH_OPTIONS)[number])

    ? historyMonths

    : 6;

  if (source === "MANUAL") {

    return `Active Green Level = Manual qty from Item Master (auto-suggested from last ${m} months RS shown for reference)`;

  }

  return `Green Level = highest monthly locked RS demand from last ${m} months`;

}



/** @deprecated Use greenLevelBasisTooltip(historyMonths) */

export const GREEN_LEVEL_BASIS_TOOLTIP = greenLevelBasisTooltip(6);



export function greenLevelNoHistoryHelper(historyMonths = 6): string {

  const m = GREEN_LEVEL_HISTORY_MONTH_OPTIONS.includes(historyMonths as (typeof GREEN_LEVEL_HISTORY_MONTH_OPTIONS)[number])

    ? historyMonths

    : 6;

  return `No ${m}-month RS history yet`;

}



export function greenLevelManualMissingHelper(): string {

  return "No manual Green Level on item master";

}



/** @deprecated Use greenLevelNoHistoryHelper(historyMonths) */

export const GREEN_LEVEL_NO_HISTORY_HELPER = greenLevelNoHistoryHelper(6);



export type FgGreenPlanningRow = {

  greenLevelQty: number;

  manualGreenLevelQty: number;

  autoSuggestedGreenLevelQty: number;

  greenLevelSource: GreenLevelSource;

  freeFgStock: number;

  greenShortage: number;

  suggestedProduction: number;

  /** True when auto-suggested green level from RS history is > 0. */

  hasAutoSuggestion: boolean;

  /** @deprecated Use hasAutoSuggestion */

  hasRsHistory: boolean;

};



export type GreenLevelCompositionItem = {

  itemId: number;

  greenShortage?: number;

  suggestedProduction?: number;

  greenTarget?: number;

  freeFgStock?: number;

};



export type GreenLevelApiItem = {

  itemId: number;

  baseQty?: number;

  greenQty?: number;

  activeGreenLevelQty?: number;

  manualGreenLevelQty?: number;

  autoSuggestedGreenLevelQty?: number;

  freeFgStock?: number;

  shortageForGreenTarget?: number;

};



function round3(value: number): number {

  if (!Number.isFinite(value)) return 0;

  return Math.round(value * 1000) / 1000;

}



function num(v: unknown): number {

  const n = Number(v);

  return Number.isFinite(n) ? n : 0;

}



export function formatGreenLevelSourceLabel(source: GreenLevelSource): string {

  return source === "AUTOMATIC" ? "Automatic" : "Manual";

}



/** Merge requirement-composition + green-levels API rows (no client-side formula). */

export function buildFgGreenPlanningRowMap(args: {

  period: string;

  compositionPeriodKey?: string | null;

  compositionItems?: GreenLevelCompositionItem[] | null;

  greenAnchorPeriodKey?: string | null;

  greenItems?: GreenLevelApiItem[] | null;

  greenLevelSource?: GreenLevelSource | null;

  extraFgItemIds?: number[];

}): Map<number, FgGreenPlanningRow> {

  const compOk = args.compositionPeriodKey === args.period;

  const greenOk = args.greenAnchorPeriodKey === args.period;

  const source: GreenLevelSource = args.greenLevelSource === "AUTOMATIC" ? "AUTOMATIC" : "MANUAL";

  const compById = new Map(

    compOk ? (args.compositionItems ?? []).map((i) => [i.itemId, i]) : [],

  );

  const greenById = new Map(greenOk ? (args.greenItems ?? []).map((i) => [i.itemId, i]) : []);

  const ids = new Set<number>([

    ...compById.keys(),

    ...greenById.keys(),

    ...(args.extraFgItemIds ?? []),

  ]);



  const map = new Map<number, FgGreenPlanningRow>();

  for (const itemId of ids) {

    const comp = compById.get(itemId);

    const green = greenById.get(itemId);

    const autoSuggestedGreenLevelQty = round3(num(green?.autoSuggestedGreenLevelQty ?? green?.baseQty));

    const hasAutoSuggestion = autoSuggestedGreenLevelQty > 0;

    map.set(itemId, {

      greenLevelQty: round3(num(green?.activeGreenLevelQty ?? green?.greenQty ?? comp?.greenTarget)),

      manualGreenLevelQty: round3(num(green?.manualGreenLevelQty)),

      autoSuggestedGreenLevelQty,

      greenLevelSource: source,

      freeFgStock: round3(num(comp?.freeFgStock ?? green?.freeFgStock)),

      greenShortage: round3(num(comp?.greenShortage ?? green?.shortageForGreenTarget)),

      suggestedProduction: round3(num(comp?.suggestedProduction)),

      hasAutoSuggestion,

      hasRsHistory: hasAutoSuggestion,

    });

  }

  return map;

}



export function resolveFgGreenPlanningRow(

  fgItemId: number,

  map: Map<number, FgGreenPlanningRow>,

  contextReady: boolean,

): FgGreenPlanningRow & { loading: boolean } {

  const row = map.get(fgItemId);

  if (row) return { ...row, loading: false };

  if (!contextReady) {

    return {

      greenLevelQty: 0,

      manualGreenLevelQty: 0,

      autoSuggestedGreenLevelQty: 0,

      greenLevelSource: "MANUAL",

      freeFgStock: 0,

      greenShortage: 0,

      suggestedProduction: 0,

      hasAutoSuggestion: false,

      hasRsHistory: false,

      loading: true,

    };

  }

  return {

    greenLevelQty: 0,

    manualGreenLevelQty: 0,

    autoSuggestedGreenLevelQty: 0,

    greenLevelSource: "MANUAL",

    freeFgStock: 0,

    greenShortage: 0,

    suggestedProduction: 0,

    hasAutoSuggestion: false,

    hasRsHistory: false,

    loading: false,

  };

}



export function greenLevelQtyCellContent(

  row: FgGreenPlanningRow,

  historyMonths = 6,

): {

  display: string;

  helper: string | null;

} {

  if (row.greenLevelQty > 0) {

    return {

      display: row.greenLevelQty.toLocaleString(undefined, { maximumFractionDigits: 3 }),

      helper: null,

    };

  }

  if (row.greenLevelSource === "MANUAL" && row.manualGreenLevelQty <= 0) {

    return { display: "0", helper: greenLevelManualMissingHelper() };

  }

  if (row.greenLevelSource === "AUTOMATIC" && !row.hasAutoSuggestion) {

    return { display: "0", helper: greenLevelNoHistoryHelper(historyMonths) };

  }

  return {

    display: row.greenLevelQty.toLocaleString(undefined, { maximumFractionDigits: 3 }),

    helper: null,

  };

}



export function greenLevelPlanningSubtext(row: FgGreenPlanningRow): string | null {

  if (row.loading) return null;

  const manual = row.manualGreenLevelQty.toLocaleString(undefined, { maximumFractionDigits: 3 });

  const auto = row.autoSuggestedGreenLevelQty.toLocaleString(undefined, { maximumFractionDigits: 3 });

  return `Manual ${manual} · Auto ${auto} · ${formatGreenLevelSourceLabel(row.greenLevelSource)}`;

}



/** Test-friendly snapshot of visible green-level fields on a planning row. */

export function productionPlanGreenLevelFieldsVisible(

  row: FgGreenPlanningRow,

  historyMonths = 6,

): {

  greenLevelQty: number;

  manualGreenLevelQty: number;

  autoSuggestedGreenLevelQty: number;

  greenLevelSource: GreenLevelSource;

  freeFgStock: number;

  greenShortage: number;

  suggestedProduction: number;

  noHistoryHelper: string | null;

} {

  const cell = greenLevelQtyCellContent(row, historyMonths);

  return {

    greenLevelQty: row.greenLevelQty,

    manualGreenLevelQty: row.manualGreenLevelQty,

    autoSuggestedGreenLevelQty: row.autoSuggestedGreenLevelQty,

    greenLevelSource: row.greenLevelSource,

    freeFgStock: row.freeFgStock,

    greenShortage: row.greenShortage,

    suggestedProduction: row.suggestedProduction,

    noHistoryHelper: cell.helper,

  };

}



export function formatGreenPlanningQty(value: number, loading: boolean): string {

  if (loading) return "…";

  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });

}


