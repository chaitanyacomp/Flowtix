const HSN_MAX_LEN = 32;

function normalizeHsnOnSave(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  return t.toUpperCase().slice(0, HSN_MAX_LEN);
}

module.exports = { HSN_MAX_LEN, normalizeHsnOnSave };

