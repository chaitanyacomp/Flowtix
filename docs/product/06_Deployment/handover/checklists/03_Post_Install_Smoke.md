# Checklist 03 — Post-Install Smoke (FT-PD-066)

| Site | URL | Date | Tester |
|------|-----|------|--------|
| | | | |

Minimum functional smoke after install or update. Use licensed modules only. Do **not** invent alternate navigation.

## Access

- [ ] Login / session works for Admin
- [ ] Dashboard or home shell loads
- [ ] No Vite/dev-server indicators in production UI

## Masters / ops (site-relevant)

- [ ] Open one master read-only (Item / Customer / Supplier — as licensed)
- [ ] Open one operational workspace (SO / WO / Stock — as licensed)
- [ ] One Analysis / report opens if Reports licensed
- [ ] No obvious API 500 on primary navigation

## Integrity spot-check

- [ ] Known sample record readable (if pilot data exists)
- [ ] No blanked company settings after deploy

## Fail path

If Fail: stop go-live; choose rollback mode ([06](./06_Rollback_Verification.md)); notify Business Owner.

**Result:** Pass / Fail  

**Business Owner informed:** Yes / No
