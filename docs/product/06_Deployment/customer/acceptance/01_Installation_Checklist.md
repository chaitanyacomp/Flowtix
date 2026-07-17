# Acceptance — Installation Checklist

| Site | Date | Version |
|------|------|---------|
| | | 1.0.0 |

- [ ] Installer / setup completed without errors
- [ ] `shared\.env` present (secrets not recorded here)
- [ ] Live `app\server.js` and `web\index.html` present under `FT_ERP_HOME` (not only under `releases\`)
- [ ] Archive intact: `releases\Flowtix-v*\app\server.js` still present after install
- [ ] `logs\installer-post.log` shows `SETUP_EXIT=0` (Batch 10) or setup log RESULT=success
- [ ] `VERSION.txt` productVersion = ________
- [ ] `verify-install` exit 0
- [ ] Localhost URL shows Flowtix login HTML
- [ ] Optional: Windows Service Running (`sc query FlowtixERP`)
- [ ] Optional: Firewall rule present
- [ ] `curl http://localhost:<PORT>/api/health` OK (PORT from `.env`, default 4000)

**Result:** Pass / Fail · **Operator:** ________
