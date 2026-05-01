function normalizeGstinOnSave(raw) {
  if (raw == null) return null;
  const t = String(raw).trim().toUpperCase();
  if (!t) return null;
  return t.slice(0, 15);
}

module.exports = { normalizeGstinOnSave };

