/**
 * Preview mapping helpers for Tally STOCKITEM → ERP ItemType and Unit aliases.
 * Does not invent unsupported ItemType enums (PACKING / SCRAP stay EXCLUDE or nearest supported).
 */

const { normalizeUnitKey } = require("../unitMaster");

/** @typedef {"RM" | "FG" | "SFG" | "CONSUMABLE" | "EXCLUDE"} ErpImportItemType */
/** @typedef {"RM" | "FG" | "SFG" | "CONSUMABLE" | "PACKING" | "SCRAP" | "EXCLUDE"} MappingChoice */

/**
 * Canonical ERP types currently supported on Item.itemType for this import.
 * PACKING / SCRAP are preview choices only — apply maps them safely (see resolveErpItemType).
 */
const SUPPORTED_ERP_ITEM_TYPES = /** @type {const} */ (["RM", "FG", "SFG", "CONSUMABLE"]);

/**
 * Suggested mapping from Tally stock group (exact / keyword).
 * @type {{ match: RegExp | string; choice: MappingChoice; note: string }[]}
 */
const GROUP_MAPPING_RULES = [
  { match: /^labour\s*charges$/i, choice: "EXCLUDE", note: "Service ledger — never import as inventory" },
  { match: /^computer\s*software$/i, choice: "EXCLUDE", note: "Non-inventory / service" },
  { match: /labour|service\s*charges|job\s*work/i, choice: "EXCLUDE", note: "Service-like group" },
  { match: /^plastic\s*scrap$/i, choice: "SCRAP", note: "SCRAP ItemType not in schema — import excluded unless remapped" },
  { match: /\bscrap\b/i, choice: "SCRAP", note: "SCRAP not a supported ItemType — exclude by default" },
  { match: /^packing\s*material/i, choice: "PACKING", note: "PACKING not in ItemType — applies as CONSUMABLE if approved" },
  { match: /\bpacking\b/i, choice: "PACKING", note: "Applies as CONSUMABLE if approved" },
  { match: /^consumable/i, choice: "CONSUMABLE", note: "Maps to ItemType CONSUMABLE" },
  { match: /semi[-\s]?finish/i, choice: "SFG", note: "Maps to ItemType SFG (semi-finished)" },
  { match: /^raw\s*material/i, choice: "RM", note: "Maps to ItemType RM" },
  { match: /^finished\s*goods?$/i, choice: "FG", note: "Maps to ItemType FG" },
  { match: /finished\s*goods|finish\s*goods|\bfg\b/i, choice: "FG", note: "Finished goods hint" },
  { match: /raw\s*material|\brm\b/i, choice: "RM", note: "Raw material hint" },
];

/**
 * Tally unit symbol / name → preferred ERP unit name (Nos / Kg / …).
 * Unknown units stay unresolved until the operator maps or excludes them.
 */
const UNIT_ALIAS_TO_ERP = {
  "no.": "Nos",
  no: "Nos",
  nos: "Nos",
  pcs: "Nos",
  pc: "Nos",
  "kg.": "Kg",
  kg: "Kg",
  kgs: "Kg",
  mtrs: "Meter",
  mtr: "Meter",
  meter: "Meter",
  metre: "Meter",
  metres: "Meter",
  ltrs: "Ltr",
  ltr: "Ltr",
  litre: "Ltr",
  liters: "Ltr",
  "not applicable": null,
  "n/a": null,
};

/**
 * @param {string | null | undefined} parentGroup
 * @returns {string}
 */
function normalizeGroupKey(parentGroup) {
  return String(parentGroup || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * @param {string | null | undefined} tallyGroup
 * @returns {{ suggested: MappingChoice; note: string }}
 */
function suggestGroupMapping(tallyGroup) {
  const raw = String(tallyGroup || "").trim();
  if (!raw) {
    return { suggested: "EXCLUDE", note: "Blank stock group — exclude until classified" };
  }
  for (const rule of GROUP_MAPPING_RULES) {
    if (typeof rule.match === "string") {
      if (normalizeGroupKey(raw) === normalizeGroupKey(rule.match)) {
        return { suggested: rule.choice, note: rule.note };
      }
    } else if (rule.match.test(raw)) {
      return { suggested: rule.choice, note: rule.note };
    }
  }
  return { suggested: "EXCLUDE", note: "Unknown group — exclude until reviewed" };
}

/**
 * Map a preview MappingChoice to a creatable Prisma ItemType, or null if excluded / unsupported.
 * @param {MappingChoice | string | null | undefined} choice
 * @returns {"RM" | "FG" | "SFG" | "CONSUMABLE" | null}
 */
function resolveErpItemType(choice) {
  const c = String(choice || "")
    .trim()
    .toUpperCase();
  if (c === "RM" || c === "FG" || c === "SFG" || c === "CONSUMABLE") return c;
  if (c === "PACKING") return "CONSUMABLE";
  if (c === "SCRAP" || c === "EXCLUDE" || c === "SEMI_FINISHED") {
    if (c === "SEMI_FINISHED") return "SFG";
    return null;
  }
  return null;
}

/**
 * @param {string | null | undefined} tallyUnit
 * @returns {{ aliasKey: string; suggestedErpUnitName: string | null; unresolved: boolean }}
 */
function suggestUnitMapping(tallyUnit) {
  const raw = String(tallyUnit || "").trim();
  const aliasKey = normalizeUnitKey(raw);
  if (!aliasKey) {
    return { aliasKey: "", suggestedErpUnitName: null, unresolved: true };
  }
  if (Object.prototype.hasOwnProperty.call(UNIT_ALIAS_TO_ERP, aliasKey)) {
    const suggested = UNIT_ALIAS_TO_ERP[aliasKey];
    return {
      aliasKey,
      suggestedErpUnitName: suggested,
      unresolved: suggested == null,
    };
  }
  // Exact Nos / Kg already normalized
  if (aliasKey === "nos" || aliasKey === "kg" || aliasKey === "meter" || aliasKey === "ltr" || aliasKey === "box") {
    const pretty =
      aliasKey === "nos"
        ? "Nos"
        : aliasKey === "kg"
          ? "Kg"
          : aliasKey === "meter"
            ? "Meter"
            : aliasKey === "ltr"
              ? "Ltr"
              : "Box";
    return { aliasKey, suggestedErpUnitName: pretty, unresolved: false };
  }
  return { aliasKey, suggestedErpUnitName: null, unresolved: true };
}

/**
 * Build group mapping rows from stock item parent groups.
 * @param {Iterable<{ parentGroup?: string | null; tallyStockGroup?: string | null }>} mappedItems
 * @param {Record<string, MappingChoice> | null | undefined} overrides groupKey → choice
 */
function buildGroupMappingTable(mappedItems, overrides) {
  /** @type {Map<string, { tallyGroup: string; count: number }>} */
  const counts = new Map();
  for (const it of mappedItems || []) {
    const display = String(it.parentGroup || "").trim() || "(blank)";
    const key = normalizeGroupKey(it.parentGroup) || "(blank)";
    const cur = counts.get(key) || { tallyGroup: display === "(blank)" ? "" : String(it.parentGroup || "").trim(), count: 0 };
    cur.count += 1;
    if (!cur.tallyGroup && display !== "(blank)") cur.tallyGroup = String(it.parentGroup || "").trim();
    counts.set(key, cur);
  }

  const rows = [...counts.entries()]
    .map(([groupKey, v]) => {
      const suggestion = suggestGroupMapping(v.tallyGroup);
      const override = overrides && typeof overrides === "object" ? overrides[groupKey] : undefined;
      const choice = /** @type {MappingChoice} */ (override || suggestion.suggested);
      const erpType = resolveErpItemType(choice);
      return {
        groupKey,
        tallyGroup: v.tallyGroup || "(blank)",
        detectedCount: v.count,
        suggested: suggestion.suggested,
        choice,
        erpItemType: erpType,
        importAction: erpType ? "IMPORT" : "EXCLUDE",
        note: suggestion.note,
      };
    })
    .sort((a, b) => b.detectedCount - a.detectedCount || a.tallyGroup.localeCompare(b.tallyGroup));

  return rows;
}

/**
 * Build unit mapping rows from distinct Tally BASEUNITS values.
 * @param {Iterable<{ baseUnit?: string | null }>} mappedItems
 * @param {Record<string, string | null> | null | undefined} overrides aliasKey → erp unit name or "" to exclude
 * @param {Array<{ id: number; unitName: string; unitCode: string | null }>} erpUnits
 */
function buildUnitMappingTable(mappedItems, overrides, erpUnits) {
  /** @type {Map<string, { sourceUnit: string; count: number }>} */
  const counts = new Map();
  for (const it of mappedItems || []) {
    const sourceUnit = String(it.baseUnit || "").trim();
    const aliasKey = normalizeUnitKey(sourceUnit) || "(blank)";
    const cur = counts.get(aliasKey) || { sourceUnit, count: 0 };
    cur.count += 1;
    if (!cur.sourceUnit && sourceUnit) cur.sourceUnit = sourceUnit;
    counts.set(aliasKey, cur);
  }

  const erpByKey = new Map(
    (erpUnits || []).map((u) => [normalizeUnitKey(u.unitName), u]),
  );

  return [...counts.entries()]
    .map(([aliasKey, v]) => {
      const suggestion = suggestUnitMapping(v.sourceUnit);
      const override =
        overrides && typeof overrides === "object" && Object.prototype.hasOwnProperty.call(overrides, aliasKey)
          ? overrides[aliasKey]
          : undefined;
      const proposedName =
        override === undefined ? suggestion.suggestedErpUnitName : override === "" || override == null ? null : String(override);
      const erp = proposedName ? erpByKey.get(normalizeUnitKey(proposedName)) || null : null;
      const unresolved = !proposedName || !erp;
      return {
        aliasKey,
        sourceUnit: v.sourceUnit || "(blank)",
        detectedCount: v.count,
        suggestedErpUnitName: suggestion.suggestedErpUnitName,
        proposedErpUnitName: proposedName,
        proposedErpUnitId: erp ? erp.id : null,
        unresolved,
        importAction: unresolved ? "EXCLUDE_OR_MAP" : "MAP",
      };
    })
    .sort((a, b) => b.detectedCount - a.detectedCount || a.sourceUnit.localeCompare(b.sourceUnit));
}

module.exports = {
  SUPPORTED_ERP_ITEM_TYPES,
  GROUP_MAPPING_RULES,
  UNIT_ALIAS_TO_ERP,
  normalizeGroupKey,
  suggestGroupMapping,
  resolveErpItemType,
  suggestUnitMapping,
  buildGroupMappingTable,
  buildUnitMappingTable,
};
