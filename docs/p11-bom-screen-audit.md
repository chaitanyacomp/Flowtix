# P11 Proposal — BOM Screen Field Audit

Audit date: 2026-05-29 (P10-A7). No implementation — preparation for P11 simplification.

## Goal

Operators should mainly enter: **FG Item**, **Weight**, **Material %**, **Wastage %**. System calculates remaining planning values.

## Current BOM page (`frontend/src/pages/BomsPage.tsx`)

### Operator-entered fields (master / header)

| Field | Purpose |
|-------|---------|
| FG Item | Finished good the BOM produces |
| BOM type | STANDARD / APPROXIMATE / CUSTOMER_SPECIFIC |
| FG weight + unit | Batch weight basis for mix math |
| Process loss % | Planning wastage on process |
| QC loss % | Planning wastage on QC |
| Suggested FG planning buffer % | Optional planning buffer (downstream monthly planning) |
| Normalization mode | How mix % is normalized across lines |
| Output qty | Legacy/output basis (often 1) |
| Remarks, effective from | Document metadata |
| Revision label / effective dating | Multi-revision control |

### Operator-entered fields (lines)

| Field | Purpose |
|-------|---------|
| RM / SFG / Consumable item | Component |
| Component type | RM vs semi-finished vs consumable |
| Mix % or base qty | Material share (mode-dependent) |
| Notes | Line notes |

### System-calculated / read-only fields

| Field | Source |
|-------|--------|
| `planning` (BomPlanningResult) | `computedBomSummary` / backend explosion |
| RM required per FG / per 1000 / per 10000 FG | Derived from weight + mix + loss |
| Effective qty per line | Normalization + child BOM roll-up |
| Component summary counts | RM/SFG/consumable tallies, SFG warnings |
| Approval warnings | Pre-approve validation |
| Doc no, revision no, status | Lifecycle |
| Child BOM link availability | SFG explosion readiness |
| Locked state after APPROVED | Edit guard |

### Technical / internal (should stay out of operator UX in P11)

| Field | Notes |
|-------|-------|
| `normalizationMode` | Needed for math; could default and hide |
| `baseQty` precision | Schema-level; not operator-facing |
| Child BOM revision pointers | SFG explosion plumbing |
| `outputQty` | Often redundant if weight-driven |
| Revision/effective-from admin fields | Supervisor-only |

## P11 simplification direction (proposal only)

1. **Primary form:** FG Item, Weight (g/kg), per-line Material %, Process/QC wastage %.
2. **Hide by default:** normalization mode, output qty, revision admin, raw baseQty entry when mix-% mode is default.
3. **Show as calculated preview:** RM kg per FG, scaled RM for 1000/10000 FG, mix total check, SFG warnings.
4. **Keep supervisor path:** multi-revision, customer-specific BOM type, archive/inactivate.

## Related backend services (for P11 design)

- `backend/src/services/bomWeightPlanning.js`
- `backend/src/services/bomComponentService.js`
- `backend/src/services/bomExplosionService.js`
- `frontend/src/lib/bomMath.ts`
