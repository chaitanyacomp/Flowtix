# Flowtix ERP — Demo Walkthrough

Use after `seed-demo-environment.js`. Sign in as the persona noted for each step.

## 1. Dashboard & navigation

- Login: `admin@flowtix.demo`
- Confirm company name on documents/settings: **DankelTek Precision Components Pvt Ltd**
- Open Dashboard — widgets should reflect seeded stock / open SOs after operational posting

## 2. Masters

| Module | What to show |
|--------|----------------|
| Customers | Precision Auto Components; Western Rail Engineering Works |
| Suppliers | Polymer Traders India; Metal Forms India |
| Items | FG-Housing Cover HC-240, FG-Mounting Bracket MB-110, RM-PP / CRCA / M6 Screw |
| BOM | BOM-26-DEMO-0001 / 0002 (Approved) |
| Locations | LOC-RM-STORE, LOC-FG-STORE, LOC-PROD-FLOOR, LOC-DISPATCH |
| Stock | Opening balances on RM & FG |

## 3. Sales — NORMAL order

- Open **SO-26-DEMO-0001** (Precision Auto)
- Show customer PO qty vs planned qty (5% buffer)
- Continue: Requirement Sheet → Monthly / product planning → create WOs as needed

## 4. Sales — NO_QTY order

- Open **SO-26-DEMO-NQ-0001** (Western Rail)
- Show rate capture and cycle-oriented planning (NO_QTY workflow)
- Walk RS cycles, recovery, and close rules per product guides (do not invent shortcuts)

## 5. Procurement

- Persona: `purchase@flowtix.demo`
- From planning shortages, create RM Purchase Orders to Polymer Traders / Metal Forms
- Receive GRN into LOC-RM-STORE (`store@flowtix.demo`)

## 6. Production & materials

- Persona: `production@flowtix.demo` / `store@flowtix.demo`
- Issue RM to production, post production entry, returns/wastage as applicable

## 7. QC

- Persona: `qa@flowtix.demo`
- Post QC for produced FG; show accepted vs rejected routes

## 8. Dispatch & billing

- Persona: `dispatch@flowtix.demo` / `accounts@flowtix.demo`
- Create dispatch against SO / QC pool
- Create Sales Bill; show print / Tally export if licensed for the demo site

## 9. Reports

Open representative reports: stock ledger, dispatch summary, production / QC, customer SO–RS, activity log.

## 10. Operations verification

- `GET /health` → ok
- `tools\verify-install.bat --home <FT_ERP_HOME>`
- Multi-browser: two roles simultaneously on LAN URL

This walkthrough exercises every major module. Seeded documents establish masters and commercial anchors; workflow engines remain the source of truth for posting.
