# P10-A4 — Store NO_QTY Execution Manual E2E Script

Use a **Store** login. Confirm backend + frontend are running with seed data that includes at least one active NO_QTY agreement.

## Scenario A — Locked RS, no WO, RM available

**Setup:** Locked NO_QTY RS with RS Balance > 0, no work orders, RM coverage Ready.

1. Open **NO_QTY Execution** (`/no-qty-agreements`).
2. Confirm row shows **Action Needed = Place WO**, **Suggested WO > 0**, **RM Coverage = Ready**.
3. Click **Open Execution Workspace**.
4. Confirm URL includes `focus=execution` and `sheetId=`.
5. Confirm execution shell (context header, no planning chrome).
6. Confirm **Place WO** block is above fold with hero KPIs (RS Balance, Suggested WO, RM Coverage).
7. Click **Create Suggested WO** (or **Create Custom WO** with valid qty).
8. Confirm success toast and new row in **WO History**.

## Scenario B — WO1 exists, balance remains, RM available

**Setup:** One WO already placed; RS Balance > 0; suggested executable qty > 0.

1. Open **NO_QTY Execution** register for the SO.
2. Confirm **Action Needed** still **Place WO** (not blocked after first WO).
3. Open execution workspace.
4. Confirm **Suggested WO** reflects remaining executable qty (not full original demand).
5. Place second WO via **Create Suggested WO**.
6. Confirm WO History shows both WOs; RS Balance decreases accordingly.

## Scenario C — RM = 0

**Setup:** Locked RS with balance but no free RM / procurement pending.

1. Open **NO_QTY Execution** register.
2. Confirm **Action Needed** is **Await Procurement** or **Blocked**.
3. Confirm **Suggested WO = 0** (or display `—`).
4. Open execution workspace if link is available.
5. Confirm **Create Suggested WO** and **Create Custom WO** are disabled.

## Scenario D — RS Balance = 0, open WO pending RM issue

**Setup:** Full RS placed on WO; PMR exists with pending issue qty.

1. Open **NO_QTY Execution** register.
2. Confirm **Action Needed = Issue RM**.
3. From execution workspace WO History **Details**, or RM Control Center, reach **Material Issue**.
4. Confirm issue flow opens for the correct WO/PMR.

## Dashboard handoff (optional)

1. As Store, open **Dashboard** NO_QTY compact panel.
2. For a **Ready to Place WO** row, click **Place WO**.
3. Confirm navigation lands on execution workspace (`focus=execution` + `sheetId`), not planning RS page.

## RM Control Center handoff (optional)

1. Open RM Control Center for a NO_QTY case with **RM Received** / ready to place.
2. Click **Place WO** primary action.
3. Without sheet id in API: confirm navigation to **NO_QTY Execution** register for that SO (`/no-qty-agreements?salesOrderId=...`).
4. Open execution workspace from register row.

## Planning still separate (sanity)

1. Open **Requirement & Cycle Planning** (`/planning-dashboard`).
2. Confirm planner inbox still shows **Create RS**, **Open Current RS**, draft/finalize flows.
3. Confirm NO_QTY Execution page does **not** show planner inbox duplicate.
