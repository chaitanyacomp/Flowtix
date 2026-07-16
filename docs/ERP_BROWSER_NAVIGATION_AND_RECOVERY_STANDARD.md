# ERP Browser Navigation and Recovery Standard

**Owner:** Frontend platform / UX architecture  
**Status:** Active  
**Applies to:** All Flowtix ERP SPA routes (Admin, Store, Purchase, Production, QA, Dispatch)  
**Related:** [UI Design System §14](./product/06_UI_and_Experience_Architecture/Chapter_07_FT_ERP_UI_UX_Design_System.md) (navigation); [§17.7 Report Grid UX](./product/06_UI_and_Experience_Architecture/Chapter_07_FT_ERP_UI_UX_Design_System.md) (Analysis reports — read-only; URL filters restore on refresh); `frontend/src/lib/authReturnPath.ts`, `frontend/src/hooks/useUnsavedChangesGuard.ts`, `frontend/src/lib/erpBackNavigation.ts`

---

## 1. Session restoration policy

| Event | Required behaviour |
|-------|-------------------|
| Refresh while authenticated | Restore same route from URL; reload **server** data. |
| Close tab / reopen ERP | Login if token missing/expired; otherwise deep URL restores page. |
| Token / session expired (401) | Clear auth; hard redirect to `/login?returnTo=<safe path>`; show session-expired message. |
| Successful login | Navigate to `returnTo` when safe; else `/dashboard`. Use `replace: true`. |
| Intentional logout | Clear token/user and post-login return path; `navigate("/login", { replace: true })`. |

**Safe return paths:** relative paths starting with `/`, not `/login`, not protocol-relative or absolute URLs. Helpers: `isSafeInternalReturnPath`, `resolvePostLoginDestination`.

**Do not** store passwords, tokens, or finalized transaction payloads in `localStorage` beyond the auth token/user already used by the SPA.

---

## 2. Unsaved form policy

| Mechanism | When |
|-----------|------|
| `beforeunload` | Only while a registered form is dirty (`useUnsavedChangesGuard`). |
| In-app confirm | Sidebar NavLink, ERP Back, and other leave actions via `DirtyFormProvider` / `confirmLeave`. |
| After save / cancel / submit / reset / finalize | Dirty flag **must** clear; no warning. |

**Operational draft persistence (allowed):**

- Backend drafts (RS DRAFT, bill drafts, etc.) remain authoritative.
- `sessionStorage` drafts (e.g. production report) only for same-tab refresh recovery; must be labeled **Recovered draft** and must never override a confirmed server record.

**Forbidden:** silently restoring stale client drafts over newer server data; using `localStorage` for transactional forms.

Wired surfaces:

| Surface | Dirty signal |
|---------|----------------|
| Requirement Sheet | `needsRecalc` on draft |
| Monthly Planning | unsaved production plan rows |
| BOM | workspace draft ≠ baseline |
| Production Report | local draft edits / recovered draft |
| Customers / Suppliers / Items | master modal open (`showForm`) |
| Locations | form ≠ baseline |
| Enquiries | create panel or edit modal open |
| Sales Bill edit | draft header/rate deltas |
| Stock adjustment | qty/reason/confirm/reverse in progress |
| Material Issue | touched issue qty or waive form |
| QC Entry | qty/reason drafts or reverse modal |
| Dispatch | partial qty entry in progress |

**Intentionally excluded (document why):**

| Surface | Reason |
|---------|--------|
| Read-only reports / dashboards | No editable transactional draft |
| Locked RS / finalized bills | Not editable; dirty N/A |
| Quotations list (approved rows) | Edit locked; create uses `/quotations/new` (wire separately if draft UX expands) |
| Feasibility panel | Decision actions are immediate POST; no long-lived client draft |
| Recovery Keep/Waive (when modal already confirms) | Prefer existing in-modal discard confirms until shared baseline lands |
| GRN / RM PO line modals | Already use `window.confirm` discard; migrate to shared guard in follow-up |
| Demo utilities / DB cleanup | Admin utility; hard reload intentional after destructive ops |

---

## 3. Browser Back / Forward policy

- Prefer **canonical routes** with document IDs / query context (`erpBackNavigation`, `returnTo`, `from`, `source`).
- Do **not** rely on `navigate(-1)` / `history.back()` for post-workflow success exits.
- Logout then Back must not show protected data (history entry replaced; unauthenticated gate redirects to login).
- Forward / revisit of a success URL must **load current server state**; mutations must be idempotent or blocked when already completed.
- Wrong flow type (Regular vs NO_QTY) is a product defect — preserve `soType`, `source=no_qty_so`, cycle/WO ids in links.

---

## 3A. Analysis / Reports back navigation (FT-UI-REPORT-018)

| Entry | Required back control |
|-------|------------------------|
| Opened from Analysis catalog (`/reports`) | **Back to Reports** → `/reports` |
| Opened from Dashboard with `from\|source=dashboard` | Back to Dashboard (allowed) |
| Standalone deep link with no context | Report default: **Back to Reports** |

**Rules:**

- Analysis catalog tiles **SHALL** append `from=reports` (or `source=reports`) via `withReportsReturnContext` — including Receivables / Payables bill hubs.
- Surfaces using `PageSmartBackLink` / `ReportPageHeader` resolve `from=reports` to **Back to Reports**.
- **SHALL NOT** show **Back to Dashboard** for Analysis-opened report surfaces.
- Do not reuse the query key `from` for date filters on the same URL as navigation context (use `dateFrom` / `dateTo`).

Related: [FT-PD-066 §17.15](./product/06_UI_and_Experience_Architecture/Chapter_07_FT_ERP_UI_UX_Design_System.md).

---

## 4. Canonical navigation policy

- Use React Router `Link` / `navigate` for in-app moves.
- Avoid `window.location.href` / `assign` / `reload` except intentional full reload (e.g. post DB cleanup) or auth failure hard redirect.
- Pending Actions and Dashboard CTAs must open the correct business context (NO_QTY vs Regular, RS cycle, WO).

---

## 5. Deep-link policy

- URLs encode document id, cycle, intent, and source where applicable.
- Unauthenticated deep link → login with `returnTo` → original route after login.
- Unauthorized role → `/dashboard` (or access-denied messaging where already implemented); no redirect loops.

---

## 6. Duplicate submission policy

- Primary workflow buttons disable while the request is pending (`useMutationLock` or local `saving`/`busy` flags).
- Backend: prefer idempotent finalize / confirm / approve / release / dispatch (existing idempotency keys and “already …” 409 responses).
- Refreshing a success view must not recreate the transaction.

---

## 7. Initial loading standard

- Preserve application shell (sidebar, header).
- Page content: skeleton / `ErpPageLoader` / `useStablePageLoad` **initialLoading** — no empty-state flash before first fetch.
- Distinguish **initial loading**, **background refreshing**, **mutation pending**.

---

## 8. Background refresh standard

- Keep previous stable data visible during refresh (`useStablePageData` / `refreshing`).
- Cancel or ignore obsolete responses (generation counters / AbortSignal).
- Do not replace the whole page with a spinner for small updates.

---

## 9. Flicker prevention standard

- Token presence is resolved from storage before protected content; avoid Login flash when already authed (login page redirects when `isAuthed`).
- Unknown routes redirect to dashboard/login (`path="*"`).
- Prefer fixed column widths for operational tables; stable React keys (not array index for mutable rows).
- Respect `prefers-reduced-motion` / `motion-safe:` for sidebar width transitions.
- Do not classify StrictMode double-effects or Vite HMR flicker as production defects without a production-build check.

---

## 10. Route-level test checklist

For each route / role:

1. Open while authed → content loads without blank shell.  
2. Hard refresh → same route + server data.  
3. Deep link while logged out → login → return.  
4. Session expiry mid-page → login with returnTo.  
5. Logout → Back does not expose prior page data.  
6. Dirty form → refresh/tab close warns; after save does not.  
7. Dirty form → sidebar/Back confirms.  
8. Double-click Create/Approve/Finalize → one server effect.  
9. Back from completed workflow → canonical list/record, not resubmittable success form.  
10. NO_QTY vs Regular context preserved on Pending Action / Back.

---

## 11. List-state restoration

- Prefer **URL search params** for filters, search, tabs, pagination, sort (`useUrlQueryState` / `useDebouncedUrlStringParam`).
- Optional **session scroll** via `useListScrollRestoration` (path-scoped, consume-once).
- Never restore modal/`action`/`openInvoice`/`draftDispatchId` keys (`sanitizeListSearchParams`).
- Business routing must remain driven by document IDs in the URL, not transient `location.state` alone.

## 12. Hard navigation allowlist

| Occurrence | Keep? | Reason |
|------------|-------|--------|
| `api.ts` / `apiDownload.ts` `location.replace(login…)` | Yes | Auth failure must clear SPA state |
| `DatabaseCleanupPage` `location.reload()` | Yes | Post destructive reset needs full remount |
| `ProductionPage` reading `window.location.pathname` | Yes | Read-only URL compare for hygiene |
| SPA `navigate` / `Link` elsewhere | Required | Default for in-app moves |

## 13. Dispatch recovery notes

- Initial load uses `salesOrdersBootDone` before “Dispatch complete”.
- Finalize/prepare Idempotency-Keys reuse until success; cleared only after confirmed success; in-flight set cleared in `finally`.

---

## Implementation map

| Concern | Primary files |
|---------|----------------|
| Return path | `frontend/src/lib/authReturnPath.ts`, `App.tsx` Login / `RequireAuthLayout`, `api.ts` |
| Dirty forms | `DirtyFormContext`, `useUnsavedChangesGuard`, page wiring (incl. quotations, SO create/edit, WO, GRN modal, purchase bill draft, RM returns) |
| List restore | `listNavigationState.ts`, `useListScrollRestoration.ts`, SO/WO URL query |
| WO Tracking report filters | URL `flow=REGULAR\|NO_QTY`, `includeClosed=1` on `/reports/work-order-tracking` (shareable; Active Only default) |
| Mutation lock | `useMutationLock` |
| Back targets | `erpBackNavigation.ts`, `ERPBackNavigation.tsx` |
| Stable load | `useStablePageLoad.ts`, `useStablePageData.ts` |
