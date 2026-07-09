# Template — Support Escalation

| Field | Value |
|-------|-------|
| **Ticket / case ID** | |
| **Customer / Site** | |
| **Severity** | Critical / High / Medium / Low |
| **Opened** | |
| **Reporter** | |

## Symptom (no secrets)

Describe user-visible failure, URL, approximate time, and whether install/update/rollback was recent.

## Environment (safe fields only)

| Item | Value |
|------|-------|
| Product version (`VERSION.txt`) | |
| Git commit | |
| FT_ERP_HOME | |
| Service used? | Yes / No / Unknown |
| Last backup filename | |
| Last deploy type | Install / Update / Rollback / None |

## Evidence to attach (redact secrets)

- [ ] Excerpt of `logs\app\` (no `.env`)
- [ ] Relevant `logs\update.log` / `setup.log` / `rollback.log` lines
- [ ] `verify-install` output if run
- [ ] Screenshot of UI error (FT-PD-066 surfaces)
- [ ] `/health` JSON if available (no credentials)

## Forbidden in tickets

- Full `DATABASE_URL` with password
- `JWT_SECRET` or raw `shared\.env`
- Customer PII beyond what support needs

## Actions already tried

1. 
2. 

## Requested support outcome

Restore service / investigate data / guide rollback / other: _______________

## Closure (OPS-04)

| Item | Value |
|------|-------|
| Resolution summary | |
| Root cause (if Critical/High) | |
| Closed by / date | |
