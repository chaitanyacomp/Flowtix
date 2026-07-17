# Support Guide — Flowtix ERP v1.0.0

## Contacts (placeholders — replace per contract)

| Channel | Placeholder |
|---------|-------------|
| Support email | `support@flowtix.example` |
| Website | `https://www.flowtix.example` |
| Vendor | Chaitanya Computer Solutions |

## Before you contact support

1. Reproduce once; note exact screen / document number.
2. Run `tools\verify-install.bat --home <FT_ERP_HOME>`.
3. Run `tools\collect-diagnostics.bat --home <FT_ERP_HOME>`.
4. Fill `06 Support\templates\Support_Escalation.md`.

## Never send

- Full `shared\.env`
- Database passwords
- Unredacted customer PII beyond what the ticket needs

## Severity (guidance)

| Level | Example |
|-------|---------|
| Critical | Site down, cannot login, corrupt stock posting blocked for all users |
| High | Single module blocked (e.g. dispatch) with workaround |
| Normal | Report formatting, training questions |
