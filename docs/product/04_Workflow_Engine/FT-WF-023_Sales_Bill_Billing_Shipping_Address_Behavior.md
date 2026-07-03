# FT-WF-023 — Sales Bill Billing & Shipping Address Behavior

| Field | Value |
|-------|-------|
| **Ticket** | FT-WF-023 |
| **Status** | **Implemented** (rev. 2026-07-03) |
| **Depends on** | FT-WF-021 (Pending Actions work queue), FT-WF-022 (Sales Bill workspace UI) |
| **Owner** | Commercial / Billing |
| **Audience** | Product, frontend, backend, QA |

**Related product docs:**

- [Chapter 8 — Dispatch & Billing Workflow State Machine](./Chapter_08_Dispatch_and_Billing_Workflow_State_Machine.md)
- [Chapter 6 — Dispatch & Billing Domain Specification](../03_Domain_Specifications/Chapter_06_Dispatch_and_Billing_Domain_Specification.md)
- [Sales Order commercial address service](../../../backend/src/services/salesOrderCommercialAddress.js)

---

## 1. Revision history

| Date | Summary |
|------|---------|
| 2026-07-03 | **Rev. 2** — Billing & shipping rules revised per product review: Bill To read-only; Ship To selectable only when multiple customer addresses exist; dispatch-origin preservation; audit + GST on change. |
| (prior) | FT-WF-023 placeholder — address behavior not yet specified in code. |

---

## 2. Objective

Define how **Bill To** and **Ship To** behave on the **Sales Bill** workspace so that:

- Legal invoicing party (Bill To) is inherited upstream and never edited during billing.
- Ship To can be chosen from Customer Master **only when justified** (multiple addresses, draft bill).
- Dispatch-origin Ship To is preserved for logistics traceability even when invoice Ship To differs.
- Address snapshots become immutable after finalization.
- GST recalculates when Ship To state changes tax treatment.
- FT-WF-022 layout and FT-WF-021 work-queue navigation remain unchanged.

**Out of scope for this ticket:** Sales Order amendment UX, Customer Master CRUD, Tally XML schema changes beyond using updated snapshots.

---

## 3. Business rules (normative)

### 3.1 Bill To

| Rule | Requirement |
|------|-------------|
| **BT-01** | Bill To is inherited from **Sales Order / Dispatch** commercial context at bill creation. |
| **BT-02** | Bill To is **not editable** on the Sales Bill workspace. No dropdown, no inline edit. |
| **BT-03** | Bill To is the **legal invoicing party** for GST, accounting, and receivables. |
| **BT-04** | If Bill To must change, it must be changed **upstream** (Sales Order commercial amendment / customer master correction before billing freeze), **not** during Sales Bill entry. |
| **BT-05** | UI label: **Bill To (read-only)** with name, state, GSTIN, and expandable full address. |

### 3.2 Ship To

| Rule | Requirement |
|------|-------------|
| **ST-01** | If the customer has **only one** active delivery address (or resolved Ship To is unambiguous), display Ship To as **read-only**. |
| **ST-02** | If the customer has **multiple** active delivery addresses in Customer Master, show a **dropdown** while `SalesBill.status = DRAFT`. |
| **ST-03** | User may select a different Ship To **before finalization** only. |
| **ST-04** | Initial invoice Ship To defaults to the **Dispatch / SO resolved Ship To** at bill creation (today: `resolveSalesBillCommercialSnapshots`). |
| **ST-05** | If selected invoice Ship To **differs** from the preserved **Dispatch Ship To**, show confirmation: |

> *"The selected Ship-To address differs from the Dispatch address. This change will be recorded in the audit trail. Continue?"*

| **ST-06** | On confirm: update **invoice Ship To snapshots**; **preserve** original Dispatch Ship To snapshots; write audit record (§5). |
| **ST-07** | After finalization: Ship To **cannot change**; snapshots are immutable (same as Bill To). |

### 3.3 After finalization

| Rule | Requirement |
|------|-------------|
| **AF-01** | Bill To cannot change. |
| **AF-02** | Ship To cannot change. |
| **AF-03** | All commercial address snapshots on the bill are **immutable** once `status = FINALIZED`. |
| **AF-04** | Tally export, invoice preview, and AR follow-up read **frozen invoice snapshots** only. |

### 3.4 GST

| Rule | Requirement |
|------|-------------|
| **GST-01** | Bill To state/GSTIN **does not** change when Ship To changes. |
| **GST-02** | Changing Ship To **must** trigger GST recalculation when tax rules require it (intra-state vs inter-state, POS from Ship To per existing `resolveSalesIntraForBilling` / `resolvePlaceOfSupply`). |
| **GST-03** | Recalculation applies to **draft** bill lines only; persist updated `cgst/sgst/igst`, totals, and POS snapshots on the bill. |
| **GST-04** | If GST cannot be resolved after Ship To change, block finalize with existing validation messaging. |

### 3.5 Audit

When invoice Ship To differs from Dispatch Ship To, persist and log:

| Field | Required |
|-------|----------|
| Original Dispatch Ship To (label, address, GSTIN, state code/name) | Yes — frozen at bill create |
| Selected Invoice Ship To (same fields) | Yes — current invoice snapshots |
| User who changed it | Yes |
| Date & time | Yes |
| Reason | Optional (prompt or activity message) |

Activity log module: `SALES_BILL` (existing `/api/activity-logs`). Structured fields also stored on bill row (§6.1).

---

## 4. UI specification (FT-WF-022 Commercial section)

Maintain existing FT-WF-022 **Commercial** section layout inside **Bill details**.

```
Commercial
┌─────────────────────────────┬─────────────────────────────┐
│ Bill To (read-only)         │ Ship To                     │
│ Name, state, GSTIN          │ [read-only OR dropdown]     │
│ [View address]              │ [View address]              │
└─────────────────────────────┴─────────────────────────────┘
```

| State | Bill To | Ship To |
|-------|---------|---------|
| Draft, 1 address | Read-only | Read-only |
| Draft, 2+ addresses | Read-only | Dropdown of active `CustomerDeliveryAddress` rows |
| Finalized / Cancelled | Read-only | Read-only |

**Dropdown behavior:**

- Options: active customer delivery addresses (`label`, state code, default marker).
- Default selection: invoice Ship To already on bill (initially = dispatch/SO resolved).
- On change: if different from `dispatchShipTo*` snapshots → confirmation modal (ST-05) → API update → refresh bill + totals.
- No Ship To editing on `SalesBillNewPage` (bill not yet materialized); address selection starts on edit workspace after draft creation.

**Work queue (FT-WF-021):** No change to queue header, navigation, or export prompt. Ship To dropdown state resets per bill when queue advances (normal page navigation).

---

## 5. Current implementation audit (as-is, 2026-07-03)

### 5.1 What exists today

| Area | Current behavior | Gap vs FT-WF-023 |
|------|------------------|------------------|
| **Bill creation** | `resolveSalesBillCommercialSnapshots` copies SO frozen Bill To / Ship To / POS into `SalesBill.*Snapshot` fields. | No separate **Dispatch Ship To** preservation. |
| **Bill To UI** | Read-only display from snapshots (FT-WF-022). | **Aligned** with BT-01–BT-05. |
| **Ship To UI** | Read-only + “View/Hide address” toggle. No dropdown. | **Missing** ST-02, ST-03, ST-05. |
| **Ship To API** | No `PATCH` ship-to on sales bill; draft `PUT` only updates `billNo`, `billDate`, `remarks`. | **Missing** update endpoint. |
| **Dispatch model** | No dedicated ship-to snapshots on `Dispatch`; Ship To resolved via **Sales Order** (`shipToAddressId`, SO snapshots). | “Dispatch Ship To” = **SO-resolved ship-to at bill create** (document in spec). |
| **Customer addresses** | `CustomerDeliveryAddress` master; SO edit has Ship To dropdown (`SalesOrdersPage`). | Reuse loader pattern for Sales Bill. |
| **GST** | Computed at create/finalize from bill + customer state; POS from ship snapshots. | Need **recompute on Ship To change** in draft (GST-02). |
| **Audit** | Generic activity logs on bill create/update/finalize/export. | No structured ship-to change event with both addresses. |
| **After finalize** | UI `readOnly`; backend rejects non-finalize updates. | **Aligned** with AF-01–AF-03. |

### 5.2 Data model today (`SalesBill`)

Invoice snapshots only (no dispatch-origin copy):

- `billToAddressSnapshot`, `billToGstinSnapshot`
- `shipToLabelSnapshot`, `shipToAddressSnapshot`, `shipToGstinSnapshot`, `shipToStateNameSnapshot`, `shipToStateCodeSnapshot`
- `posStateNameSnapshot`, `posStateCodeSnapshot`, `posSourceSnapshot`

---

## 6. Proposed implementation blueprint (for dev — not yet built)

### 6.1 Schema addition (migration)

Add to `SalesBill`:

```text
dispatchShipToLabelSnapshot       VARCHAR(128)  -- frozen at create
dispatchShipToAddressSnapshot   TEXT
dispatchShipToGstinSnapshot     VARCHAR(15)
dispatchShipToStateNameSnapshot VARCHAR(128)
dispatchShipToStateCodeSnapshot VARCHAR(2)

shipToAddressId                 INT NULL FK → CustomerDeliveryAddress  -- selected master row (draft)
shipToChangedAt                 DateTime NULL
shipToChangedById               INT NULL FK → User
shipToChangeReason              TEXT NULL
```

**Backfill:** For existing bills, set `dispatchShipTo*` = current `shipTo*` (best-effort; no historical dispatch divergence).

### 6.2 Bill create (`createBillFromDispatch`)

1. Resolve commercial view (unchanged).
2. Copy resolved Ship To into **both** `shipTo*` and `dispatchShipTo*`.
3. Set `shipToAddressId` from SO `shipToAddressId` or resolved delivery address id.

### 6.3 API

| Method | Path | When | Body |
|--------|------|------|------|
| `GET` | `/api/sales-bills/:id/ship-to-options` | Draft | Returns active `CustomerDeliveryAddress[]` for bill customer + current selection + `dispatchShipTo` summary |
| `PATCH` | `/api/sales-bills/:id/ship-to` | Draft only | `{ shipToAddressId: number, reason?: string }` |

**PATCH logic:**

1. Validate bill `DRAFT`, address belongs to customer, address `isActive`.
2. If new address resolves to same snapshots as `dispatchShipTo*` → apply without confirmation flag (optional UX skip).
3. Else require frontend confirmation (backend may accept `confirmed: true` guard).
4. Update `shipTo*` + `pos*` snapshots from master row via existing `resolveCommercialView` helpers.
5. **Do not** mutate `dispatchShipTo*`.
6. Recompute line taxes + bill totals (`computeLineTaxSplit`, `sumTotals`).
7. Set `shipToChangedAt/ById/Reason`; append activity log with both addresses.

**Finalize guard:** Reject `PATCH` ship-to when not `DRAFT` (AF-02).

### 6.4 Frontend (`SalesBillEditPage` Commercial section)

1. On load (draft): fetch `ship-to-options`.
2. If `addresses.length <= 1` → read-only Ship To (ST-01).
3. If `addresses.length > 1` → `<select>` bound to `shipToAddressId`; on change → diff check → `ErpModal` confirm → `PATCH`.
4. Show subtle hint when invoice Ship To ≠ dispatch Ship To: *“Differs from dispatch delivery address”*.
5. Remove any future Bill To edit controls (none today).

### 6.5 GST recalculation

Reuse:

- `resolveSalesIntraForBilling` / `resolvePlaceOfSupply` from `salesOrderCommercialAddress.js`
- `computeLineTaxSplit` + `sumTotals` from `salesBillService.js`

Trigger on successful `PATCH` ship-to (GST-02). Bill To snapshots unchanged (GST-01).

### 6.6 Tests (acceptance)

| ID | Scenario |
|----|----------|
| T-01 | Bill create: `dispatchShipTo*` equals initial `shipTo*`. |
| T-02 | Single address customer: no dropdown; PATCH ship-to returns 409 or options length 1. |
| T-03 | Multi-address: PATCH updates invoice snapshots only; dispatch snapshots unchanged. |
| T-04 | Ship To change to different state recalculates IGST vs CGST/SGST. |
| T-05 | Finalized bill: PATCH ship-to rejected. |
| T-06 | Activity log contains user, timestamp, both address summaries. |
| T-07 | Work queue: open bill 2 of 3, change Ship To, finalize, export — queue unaffected. |

---

## 7. Explicit non-goals

- Editing Bill To on Sales Bill.
- Changing Ship To after finalize (even for Admin).
- Modifying Dispatch or SO records from Sales Bill.
- Replacing SO amendment workflow for Bill To corrections.

---

## 8. Sign-off checklist (before merge)

- [ ] Product accepts §3 business rules
- [ ] Schema migration reviewed
- [ ] API contract reviewed with frontend
- [ ] GST recalculation path verified on interstate ship-to
- [ ] Activity log message format agreed with operations
- [ ] FT-WF-021 / FT-WF-022 regression smoke on billing queue + layout

---

*End of FT-WF-023 specification (rev. 2). Implementation to follow in a separate change set.*
