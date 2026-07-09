/**
 * Analysis report print / export actions (FT-PD-066 §17 / FT-PD-065).
 * UI-only — does not change report calculations or filters.
 *
 * CSV → text/csv (.csv)
 * Excel → real Office Open XML workbook (.xlsx) via SheetJS
 * Tally XML is out of scope here (separate download paths).
 */
import * as XLSX from "xlsx";
import { Download, Printer } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export type ReportPrintExportBarProps = {
  /** Active filter summary shown on printed pages. */
  filterSummary?: string;
  onExportCsv?: () => void;
  onExportExcel?: () => void;
  csvDisabled?: boolean;
  excelDisabled?: boolean;
  className?: string;
};

export function ReportPrintExportBar({
  filterSummary,
  onExportCsv,
  onExportExcel,
  csvDisabled,
  excelDisabled,
  className,
}: ReportPrintExportBarProps) {
  return (
    <div className={cn("erp-no-print flex flex-wrap items-center gap-2", className)}>
      {onExportCsv ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          disabled={csvDisabled}
          onClick={onExportCsv}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      ) : null}
      {onExportExcel ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          disabled={excelDisabled}
          onClick={onExportExcel}
        >
          <Download className="h-3.5 w-3.5" />
          Export Excel
        </Button>
      ) : null}
      <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={() => window.print()}>
        <Printer className="h-3.5 w-3.5" />
        Print
      </Button>
      {filterSummary ? (
        <span className="erp-print-only hidden text-[11px] text-slate-600" data-print-filters={filterSummary}>
          Filters: {filterSummary}
        </span>
      ) : null}
    </div>
  );
}

/** Printed-only header block (title, timestamp, filters). Hidden on screen. */
export function ReportPrintMeta({
  title,
  filterSummary,
  kpiSummary,
}: {
  title: string;
  filterSummary?: string;
  kpiSummary?: string;
}) {
  const printedAt = new Date().toLocaleString();
  return (
    <div className="erp-print-only mb-3 hidden border-b border-slate-300 pb-2">
      <div className="text-base font-semibold text-slate-900">{title}</div>
      <div className="mt-0.5 text-[11px] text-slate-600">Printed: {printedAt}</div>
      {filterSummary ? <div className="mt-0.5 text-[11px] text-slate-600">Filters: {filterSummary}</div> : null}
      {kpiSummary ? <div className="mt-0.5 text-[11px] text-slate-600">Summary: {kpiSummary}</div> : null}
    </div>
  );
}

function escCsvCell(v: string | number | null | undefined): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

/** Force .csv extension (never .xls / .xlsx). */
export function ensureCsvFilename(filename: string): string {
  const base = filename.replace(/\.(csv|xlsx|xls)$/i, "");
  return `${base}.csv`;
}

/** Force .xlsx extension (never HTML-as-.xls). */
export function ensureXlsxFilename(filename: string): string {
  const base = filename.replace(/\.(csv|xlsx|xls)$/i, "");
  return `${base}.xlsx`;
}

/** Download CSV; empty rows → single “No records found” data line. MIME: text/csv. */
export function downloadReportCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const headerLine = headers.map(escCsvCell).join(",");
  const body =
    rows.length === 0
      ? [escCsvCell("No records found")]
      : rows.map((r) => r.map(escCsvCell).join(","));
  const blob = new Blob([[headerLine, ...body].join("\n")], { type: "text/csv; charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = ensureCsvFilename(filename);
  a.click();
  URL.revokeObjectURL(a.href);
}

export type ReportExcelSheet = {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
};

function sheetFromAoA(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): XLSX.WorkSheet {
  const data =
    rows.length === 0
      ? [headers, ["No records found"]]
      : [headers, ...rows.map((r) => r.map((c) => (c == null ? "" : c)))];
  return XLSX.utils.aoa_to_sheet(data);
}

/**
 * Download a real Excel workbook (.xlsx / OOXML).
 * Do not use .xls — that extension was previously misused for HTML blobs.
 */
export function downloadReportExcel(
  filename: string,
  title: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const wb = XLSX.utils.book_new();
  const ws = sheetFromAoA(headers, rows);
  const sheetName = (title || "Report").slice(0, 31) || "Report";
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, ensureXlsxFilename(filename), { bookType: "xlsx" });
}

/** Multi-sheet .xlsx export (e.g. detail + summary tabs). */
export function downloadReportExcelWorkbook(filename: string, sheets: ReportExcelSheet[]): void {
  const wb = XLSX.utils.book_new();
  const list = sheets.length
    ? sheets
    : [{ name: "Report", headers: ["Message"], rows: [["No records found"]] }];
  for (const s of list) {
    const name = (s.name || "Sheet").slice(0, 31);
    XLSX.utils.book_append_sheet(wb, sheetFromAoA(s.headers, s.rows), name);
  }
  XLSX.writeFile(wb, ensureXlsxFilename(filename), { bookType: "xlsx" });
}

/**
 * @deprecated Alias — previously wrote HTML with a .xls extension (Excel format warning).
 * Now generates a real .xlsx workbook.
 */
export function downloadReportExcelHtml(
  filename: string,
  title: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  downloadReportExcel(filename, title, headers, rows);
}
