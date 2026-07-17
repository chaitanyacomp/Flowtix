# Flowtix ERP — Demo Package

| Field | Value |
|-------|-------|
| **Product** | Flowtix ERP v1.0.0 |
| **Audience** | Sales demos, partner labs, training |
| **Safety** | Never run against a live customer database |

## Contents

| File | Purpose |
|------|---------|
| `seed-demo-environment.js` | Seeds demo company, masters, BOM, stock, sample SOs, demo users |
| `DEMO_USERS.md` | Accounts, roles, passwords, permission map |
| `DEMO_WALKTHROUGH.md` | Module-by-module demonstration path |
| `README.md` | This file |

## How to load the demo (lab)

1. Install Flowtix on a **lab** Windows host (or local MySQL).
2. Ensure `shared\.env` / `DATABASE_URL` points at the **demo** database.
3. From the repository (developer) or a machine with backend sources:

```bat
cd backend
npx prisma migrate deploy
set DEMO_SEED_CONFIRM=YES
node ..\deployment\demo\seed-demo-environment.js
```

4. Sign in with credentials from `DEMO_USERS.md`.
5. Follow `DEMO_WALKTHROUGH.md`.

## What the seed creates

- Demo company profile (DankelTek Precision Components)
- Locations (RM / FG / Production / Dispatch)
- Customers & suppliers (realistic Indian manufacturing parties)
- FG + RM items with HSN / GST
- Two approved BOMs
- Opening stock ledger
- One NORMAL sales order and one NO_QTY sales order
- Nine demonstration users

Transactional steps after the seed (RS, planning, PO, GRN, WO, production, QC, dispatch, billing) are completed through the UI so workflow engines stay authoritative — see the walkthrough.
