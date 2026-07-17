# Operator Guide — Flowtix ERP v1.0.0

## Roles (product)

| Role | Typical work |
|------|----------------|
| ADMIN | Configuration, overrides, all modules |
| STORE | Stock, GRN, issues/returns, dispatch support |
| PURCHASE | Procurement planning, RM PO, purchase bills |
| PRODUCTION | Work orders, production entry, consumption |
| QA | QC posting and reports |

Sign-in uses email + password. Ask your administrator for an account.

## Daily path (manufacturing)

1. Check **Dashboard** / pending actions for your role.
2. Work only from **document screens** (SO → RS → WO → Production → QC → Dispatch → Bill).
3. Do not invent stock adjustments to “fix” shortages without approval.
4. Use **Activity** / document history when investigating a document.

## Printing & reports

- Document print/PDF from the document screen where offered.
- Operational reports from the Reports menu (stock, dispatch, production, QC, commercial matching).

## What operators must not do

- Edit `shared\.env` or run Prisma commands.
- Run demo seed on production.
- Share passwords or paste `.env` into chat/email.
