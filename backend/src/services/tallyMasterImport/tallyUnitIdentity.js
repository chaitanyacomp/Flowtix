const MAX_UNIT_CODE_LENGTH = 16;

const FAMILY_ALIASES = new Map([
  ["kg", "KG"],
  ["kgs", "KG"],
  ["kilogram", "KG"],
  ["kilograms", "KG"],
  ["no", "NOS"],
  ["nos", "NOS"],
  ["number", "NOS"],
  ["numbers", "NOS"],
  ["pc", "NOS"],
  ["pcs", "NOS"],
  ["piece", "NOS"],
  ["pieces", "NOS"],
  ["ft", "LFT"],
  ["foot", "LFT"],
  ["feet", "LFT"],
  ["linearft", "LFT"],
  ["linearfoot", "LFT"],
  ["linearfeet", "LFT"],
  ["sqf", "SQFT"],
  ["sqft", "SQFT"],
  ["squareft", "SQFT"],
  ["squarefoot", "SQFT"],
  ["squarefeet", "SQFT"],
  ["sqmt", "SQM"],
  ["sqm", "SQM"],
  ["sqmtr", "SQM"],
  ["sqmtrs", "SQM"],
  ["sqmeter", "SQM"],
  ["sqmeters", "SQM"],
  ["sqmetre", "SQM"],
  ["sqmetres", "SQM"],
  ["squaremeter", "SQM"],
  ["squaremeters", "SQM"],
  ["squaremetre", "SQM"],
  ["squaremetres", "SQM"],
  ["m", "MTR"],
  ["mtr", "MTR"],
  ["mtrs", "MTR"],
  ["meter", "MTR"],
  ["meters", "MTR"],
  ["metre", "MTR"],
  ["metres", "MTR"],
  ["ltr", "LTR"],
  ["ltrs", "LTR"],
  ["liter", "LTR"],
  ["liters", "LTR"],
  ["litre", "LTR"],
  ["litres", "LTR"],
  ["kl", "KL"],
  ["klr", "KL"],
  ["kiloliter", "KL"],
  ["kiloliters", "KL"],
  ["kilolitre", "KL"],
  ["kilolitres", "KL"],
]);

function compactUnitToken(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function unitFamily(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const segments = [text, ...text.split(/[-/]/)];
  const families = new Set();
  for (const segment of segments) {
    const family = FAMILY_ALIASES.get(compactUnitToken(segment));
    if (family) families.add(family);
  }
  return families.size === 1 ? [...families][0] : null;
}

function equivalentUnitKeys(row) {
  // tallyUnitSymbol is immutable audit evidence, not operational identity. It may
  // intentionally preserve a contradictory legacy symbol corrected on the ERP row.
  const values = [row?.unitName, row?.unitCode, row?.tallyName];
  const keys = new Set();
  for (const value of values) {
    const compact = compactUnitToken(value);
    if (compact) keys.add(`literal:${compact}`);
    const family = unitFamily(value);
    if (family) keys.add(`family:${family}`);
  }
  return keys;
}

function unitsAreEquivalent(a, b) {
  const aKeys = equivalentUnitKeys(a);
  return [...equivalentUnitKeys(b)].some((key) => aKeys.has(key));
}

function normalizeUnitCode(raw, fallbackName) {
  const original = String(raw ?? "").trim();
  const family = unitFamily(original) || unitFamily(fallbackName);
  if (family) return { unitCode: family, originalSymbol: original || null, shortened: original.length > MAX_UNIT_CODE_LENGTH };

  const cleaned = original.toUpperCase().replace(/\s+/g, " ").trim();
  if (!cleaned) return { unitCode: null, originalSymbol: null, shortened: false };
  if (cleaned.length <= MAX_UNIT_CODE_LENGTH) {
    return { unitCode: cleaned, originalSymbol: original, shortened: false };
  }

  const firstPart = cleaned.split(/[-/]/).map((part) => part.replace(/[^A-Z0-9]/g, "")).find(Boolean);
  const acronym = cleaned
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("");
  const short = (firstPart && firstPart.length <= MAX_UNIT_CODE_LENGTH ? firstPart : acronym).slice(0, MAX_UNIT_CODE_LENGTH);
  return { unitCode: short || cleaned.replace(/[^A-Z0-9]/g, "").slice(0, MAX_UNIT_CODE_LENGTH), originalSymbol: original, shortened: true };
}

function findEquivalentUnit(units, candidate) {
  const matches = (units || []).filter((unit) => unitsAreEquivalent(unit, candidate));
  if (!matches.length) return null;
  const family = unitFamily(candidate?.unitName) || unitFamily(candidate?.unitCode);
  const preferred = {
    NOS: { name: "nos", code: "nos" },
    KG: { name: "kg", code: "kg" },
    LTR: { name: "ltr", code: "ltr" },
    MTR: { name: "meter", code: "mtr" },
    LFT: { name: "linearfeet", code: "ft" },
    SQFT: { name: "sqft", code: "sqft" },
    SQM: { name: "sqmeter", code: "sqm" },
    KL: { name: "kilolitre", code: "kl" },
  }[family];
  return matches.sort((a, b) => {
    const rank = (row) => {
      let score = 0;
      if (preferred && compactUnitToken(row.unitName) === preferred.name) score -= 4;
      if (preferred && compactUnitToken(row.unitCode) === preferred.code) score -= 2;
      if (row.isActive === false) score += 1;
      return score;
    };
    return rank(a) - rank(b) || Number(a.id ?? Number.MAX_SAFE_INTEGER) - Number(b.id ?? Number.MAX_SAFE_INTEGER);
  })[0];
}

function cleanUnitCreateError() {
  return {
    reason: "An equivalent ERP unit was created by another import at the same time.",
    correctiveAction: "Retry the import; the existing unit will be reused.",
  };
}

module.exports = {
  MAX_UNIT_CODE_LENGTH,
  compactUnitToken,
  unitFamily,
  equivalentUnitKeys,
  unitsAreEquivalent,
  normalizeUnitCode,
  findEquivalentUnit,
  cleanUnitCreateError,
};
