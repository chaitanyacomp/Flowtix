# Installation Guide — Flowtix ERP v1.0.0

## 1. Prerequisites

| Requirement | Notes |
|-------------|--------|
| Windows 10/11 or Windows Server | Administrator rights for service & firewall |
| Node.js LTS | On PATH (`node -v`, `npm -v`) |
| MySQL 8+ | Server reachable; `mysql` / `mysqldump` on PATH recommended |
| Disk | ≥ 10 GB free on install volume |
| Network | Static IP or stable hostname for LAN clients |

Flowtix **does not** install MySQL.

## 2. Recommended path (Windows installer)

1. Open media folder **01 Setup**.
2. Run `Flowtix-ERP-Setup.exe` as Administrator.
3. Choose install directory (default `C:\FT-ERP`).
4. Before Path A (database migrate), create production configuration:

```bat
tools\configure-env.bat --home C:\FT-ERP
```

5. Complete setup prompts (optional Windows Service, optional firewall).
6. Confirm live runtime (required — wizard completion alone is not enough):

```bat
dir C:\FT-ERP\app\server.js
dir C:\FT-ERP\web\index.html
```

7. Verify:

```bat
tools\verify-install.bat --home C:\FT-ERP
```

Browser: `http://127.0.0.1:<PORT>/` and LAN `http://<hostname>:<PORT>/`.

## 3. Manual path (server ZIP)

1. Extract **04 Server\Flowtix-Server.zip**.
2. `tools\install-validate.bat --home <FT_ERP_HOME> --source <package>`
3. `tools\configure-env.bat --home <FT_ERP_HOME>`
4. `tools\setup-flowtix.bat --home <FT_ERP_HOME> --source <package> --yes`

## 4. After install

- Complete [acceptance/01_Installation_Checklist.md](./acceptance/01_Installation_Checklist.md)
- Day-2 operations: [02_Administrator_Guide.md](./02_Administrator_Guide.md) and FT-DEP-012

## 5. Safety

- Never overwrite an existing `shared\.env` without confirmation.
- Production migrate is **only** `prisma migrate deploy` (via tools).
- Uninstaller preserves customer data by default and **never** deletes MySQL.

## 6. Tally Master import (same PC)

When Tally and the Flowtix backend run on the **same** Windows PC and `http://localhost:9000` responds, a separate Tally HTTP proxy is **not** required for Master XML preview/apply. Use Admin → Tally import with the uploaded/exported masters XML as documented. If Preview returns `Cannot find module './mapLedgerToParty'`, the install is on a pre-v1.14.2 packaged build — reinstall from a rebuilt setup EXE (FT-DEP-001 §28.5.1).

**Backup tool:** From `C:\FT-ERP\tools`, run `backup-db.bat` — install home resolves to `C:\FT-ERP` automatically (v1.14.3+). Optional override: `set FT_ERP_HOME=C:\FT-ERP`. Never paste `DATABASE_URL` passwords into tickets.

**Users:** After first boot, Admin → Settings → **Users** manages STORE/PURCHASE/PRODUCTION/QA accounts (create, activate/deactivate, password reset). Seed personas (`*@test.com` / `123456`) are ensured on startup when missing.
