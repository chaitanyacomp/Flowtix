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
