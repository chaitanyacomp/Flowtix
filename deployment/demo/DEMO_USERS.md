# Flowtix ERP — Demonstration Users

**Default password (all demo users):** `Flowtix@Demo1`

**Password policy:** Change the password immediately after first login on any shared or customer-visible lab. There is no forced password-change flag in v1.0.0; treat this as an **operational requirement**.

**Role note:** The product `UserRole` enum is `ADMIN | STORE | PURCHASE | PRODUCTION | QA`. Personas below map onto those roles. Sales / Dispatch / Accounts / Auditor are **demonstration personas** using the closest product role — not separate schema roles.

| Username | Persona | Product role | Typical access |
|----------|---------|--------------|----------------|
| `admin@flowtix.demo` | Administrator | ADMIN | Full configuration, masters, overrides, Settings |
| `sales@flowtix.demo` | Sales Executive | ADMIN | Enquiries, quotations, sales orders, sales bills (demo) |
| `purchase@flowtix.demo` | Purchase Manager | PURCHASE | Procurement planning, RM PO, purchase bills |
| `store@flowtix.demo` | Store Manager | STORE | Stock, GRN, RM issue/return, locations |
| `production@flowtix.demo` | Production Supervisor | PRODUCTION | Work orders, production entry, RM consumption |
| `qa@flowtix.demo` | QA Engineer | QA | QC entry / reports |
| `dispatch@flowtix.demo` | Dispatch Executive | STORE | Dispatch workflows & FG movement (demo mapping) |
| `accounts@flowtix.demo` | Accounts Executive | ADMIN | Sales/purchase bills, commercial tracking (demo) |
| `auditor@flowtix.demo` | Read-Only Auditor | ADMIN | **Policy:** use for observation only; do not post transactions in demos |

## First-login instructions

1. Open `http://127.0.0.1:<PORT>/` (or the LAN URL).
2. Sign in with a demo username and `Flowtix@Demo1`.
3. Open **Settings → change password** (or Admin user management) and set a private password.
4. For customer-facing demos, disable or delete unused demo accounts after the session.

## Security

- Demo accounts are for **lab / training** only.
- Never deploy these passwords to production.
- Never paste passwords into support tickets.
