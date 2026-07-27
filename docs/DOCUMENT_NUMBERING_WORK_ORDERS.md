# Document numbering standard — Work Orders

## Purpose

Define the canonical Work Order (`WorkOrder.docNo`) format so UI, search, reports, printouts, APIs, and deep links all show the same business identity.

## Formats

### New Work Orders (flow-wise)

| Flow | Series | Format | Example |
|------|--------|--------|---------|
| Regular SO (`NORMAL` / `REPLACEMENT`) | `WORK_ORDER_REGULAR` | `WO-R-YY-####` | `WO-R-26-0001` |
| NO_QTY | `WORK_ORDER_NO_QTY` | `WO-NQ-YY-####` | `WO-NQ-26-0001` |
| Green Level | `WORK_ORDER_GREEN_LEVEL` | `WO-GL-YY-####` | `WO-GL-26-0001` |

- `YY` = calendar year of allocation (`year2`, same basis as SO/RS/other doc series).
- `####` = zero-padded running number starting at `0001` **per flow and year**.
- Sequences are independent: allocating Regular WOs does not advance NO_QTY or Green Level counters.

### Legacy Work Orders (preserved)

| Series | Format | Example |
|--------|--------|---------|
| Shared pre–flow-wise (`WORK_ORDER`) | `WO-YY-####` | `WO-26-0001` |

Existing rows keep their `docNo`. **Do not auto-renumber.** Search, filters, and displays must accept both legacy and flow-wise forms.

## Flow resolution rules

1. Resolve flow from the authoritative Sales Order `orderType` (or the Green Level create path).
2. Never infer flow from stock source, prior WO history, or which screen opened create.
3. Regular create uses `resolveWorkOrderFlowFromSalesOrderType(orderType)`.
4. NO_QTY placement uses `WORK_ORDER_FLOW.NO_QTY`.
5. Green Level placement uses `WORK_ORDER_FLOW.GREEN_LEVEL`.

## Uniqueness and allocation

- `WorkOrder.docNo` remains globally unique (`@unique`, `VarChar(32)`).
- Allocation is atomic via `DocSequence` upsert inside the create transaction (`allocateWorkOrderDocNo`).
- Flow prefixes never collide with legacy `WO-YY-####`.

## Display and integration

- Prefer `displayWorkOrderNo(id, docNo)` / backend `displayWorkOrderNo` — always show `docNo` when present.
- Routes and APIs continue to key by numeric `workOrderId`; `docNo` is the user-facing label in lists, dropdowns, printouts, activity logs, and reports.
- Substring search on `docNo` continues to work for both formats.

## Migration / deployment

1. Apply Prisma migration `20260727180000_work_order_flow_doc_numbering` (extends `DocSequence.docType` enum).
2. Run `npm run prisma:generate --prefix backend` after pull.
3. No data rewrite of existing `WorkOrder.docNo` values.
4. Optional: `backfillDocNos.js` treats flow-wise WO numbers as valid; it must not rewrite legacy or flow numbers that already match a known pattern.

## Testing

See `backend/test/unit/workOrderFlowDocNumbering.test.js`:

- First and next number per flow
- Concurrent allocation uniqueness
- Calendar-year rollover
- Legacy compatibility helpers
- Strict flow isolation
