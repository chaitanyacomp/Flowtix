const { strVal } = require("./parseTallyMastersXml");

/** @param {unknown} v */
function normalizeList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Map Tally ledger PARENT to customer (debtor) vs supplier (creditor).
 * Many companies use nested groups (e.g. "North Zone Debtors") without the word "Sundry".
 * Heuristic: parent name contains **debtor** and not **creditor** → customer; **creditor** and not **debtor** → supplier.
 *
 * @param {string} parentRaw
 * @returns {"DEBTOR" | "CREDITOR" | null}
 */
function classifySundryLedgerParent(parentRaw) {
  const p = String(parentRaw || "").toLowerCase().trim();
  if (!p) return null;
  const hasDebtor = p.includes("debtor");
  const hasCreditor = p.includes("creditor");
  if (hasCreditor && !hasDebtor) return "CREDITOR";
  if (hasDebtor && !hasCreditor) return "DEBTOR";
  return null;
}

/**
 * @param {Record<string, unknown>} ledger
 * @returns {string}
 */
function ledgerDisplayName(ledger) {
  const fromAttr = ledger && ledger["@_NAME"] != null ? String(ledger["@_NAME"]).trim() : "";
  const fromName = strVal(ledger?.NAME);
  return fromName || fromAttr;
}

/**
 * Best-effort GSTIN from common Tally tags.
 * @param {Record<string, unknown>} ledger
 * @returns {string | null}
 */
function extractGstin(ledger) {
  const keys = [
    "GSTIN",
    "PARTYGSTIN",
    "INCOMETAXNUMBER",
    "VATDEALER",
    "GSTREGISTRATIONNUMBER",
    "GSTREGISTRATIONNO",
    "GSTNUMBER",
    "GSTREGISTRATION",
  ];

  /**
   * Tally Prime nests GSTIN under LEDMAILINGDETAILS / LEDGSTREGISTRATION list blocks — not only ledger top-level.
   * @param {unknown} node
   * @param {number} depth
   */
  function scan(node, depth) {
    if (depth > 14 || node == null) return null;
    if (Array.isArray(node)) {
      for (const el of node) {
        const t = scan(el, depth + 1);
        if (t) return t;
      }
      return null;
    }
    if (typeof node !== "object") return null;
    const o = /** @type {Record<string, unknown>} */ (node);
    for (const k of keys) {
      const t = strVal(o[k]);
      if (t) return t;
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") {
        const t = scan(v, depth + 1);
        if (t) return t;
      }
    }
    return null;
  }

  const top = scan(ledger, 0);
  if (top) return top;
  return null;
}

/**
 * Flatten first ADDRESS block if present.
 * @param {Record<string, unknown>} ledger
 * @returns {{ address: string; stateText: string }}
 */
function extractAddressAndStateText(ledger) {
  let address = "";
  let stateText = "";

  const pick = (obj) => {
    if (!obj || typeof obj !== "object") return;
    const a =
      strVal(obj.ADDRESS) ||
      strVal(obj.MAILINGNAME) ||
      strVal(obj.ADDRESSLINE1) ||
      strVal(obj.STREET) ||
      strVal(obj.MAILINGADDRESS1);
    const st =
      strVal(obj.STATE) ||
      strVal(obj.STATENAME) ||
      strVal(obj.LEDSTATENAME) ||
      strVal(obj.PLACE) ||
      strVal(obj.PLACEOFTHESUPPLIER);
    if (a) address = address ? `${address}\n${a}` : a;
    if (st && !stateText) stateText = st;
  };

  const addrRoot = ledger?.["ADDRESS.LIST"] || ledger?.ADDRESS_LIST || ledger?.ADDRESS;
  if (addrRoot) {
    const blocks = Array.isArray(addrRoot) ? addrRoot : [addrRoot];
    for (const b of blocks) {
      const inner = b?.ADDRESS || b;
      if (Array.isArray(inner)) inner.forEach(pick);
      else pick(inner || b);
    }
  }

  /** Tally party masters often carry state only under LEDMAILINGDETAILS.LIST → LEDMAILINGDETAILS. */
  const mailRoot = ledger?.["LEDMAILINGDETAILS.LIST"] || ledger?.LEDMAILINGDETAILS_LIST || ledger?.LEDMAILINGDETAILS;
  const mailInner = mailRoot && typeof mailRoot === "object" ? mailRoot.LEDMAILINGDETAILS || mailRoot : null;
  for (const block of normalizeList(mailInner)) {
    pick(block);
  }

  const pin = strVal(ledger?.PINCODE) || strVal(ledger?.PINCODEMAILING);
  if (pin) address = address ? `${address}\nPIN: ${pin}` : `PIN: ${pin}`;

  if (!stateText) {
    stateText =
      strVal(ledger?.STATE) ||
      strVal(ledger?.STATENAME) ||
      strVal(ledger?.LEDSTATENAME) ||
      strVal(ledger?.STATENAMEMAILING);
  }

  return { address: address.trim(), stateText: stateText.trim() };
}

/**
 * @param {Record<string, unknown>} ledger
 * @returns {{ contact: string; email: string }}
 */
function extractContactEmail(ledger) {
  const contact =
    strVal(ledger?.MOBILE) ||
    strVal(ledger?.PHONENUMBER) ||
    strVal(ledger?.PHONE) ||
    strVal(ledger?.CONTACT) ||
    strVal(ledger?.CONTACTNUMBER) ||
    "";
  const email = strVal(ledger?.EMAIL) || strVal(ledger?.EMAILID) || strVal(ledger?.INCOMETAXMAILING) || "";
  return { contact, email };
}

/**
 * Map raw Tally LEDGER object to party fields (customer or supplier).
 *
 * @param {unknown} ledgerRaw
 * @param {"CUSTOMER" | "SUPPLIER"} kind
 * @returns {null | {
 *   tallyName: string;
 *   parentGroup: string;
 *   name: string;
 *   gst: string | null;
 *   address: string | null;
 *   stateText: string | null;
 *   contact: string | null;
 *   email: string | null;
 * }}
 */
function mapLedgerToParty(ledgerRaw, kind) {
  if (!ledgerRaw || typeof ledgerRaw !== "object") return null;
  const ledger = /** @type {Record<string, unknown>} */ (ledgerRaw);
  const parentGroup = strVal(ledger.PARENT);
  const role = classifySundryLedgerParent(parentGroup);
  if (kind === "CUSTOMER" && role !== "DEBTOR") return null;
  if (kind === "SUPPLIER" && role !== "CREDITOR") return null;

  const tallyName = ledgerDisplayName(ledger);
  if (!tallyName) return null;

  const { address, stateText } = extractAddressAndStateText(ledger);
  const { contact, email } = extractContactEmail(ledger);
  const gstRaw = extractGstin(ledger);

  return {
    tallyName,
    parentGroup,
    name: tallyName,
    gst: gstRaw || null,
    address: address || null,
    stateText: stateText || null,
    contact: contact || null,
    email: email || null,
  };
}

module.exports = {
  classifySundryLedgerParent,
  mapLedgerToParty,
  ledgerDisplayName,
  extractGstin,
};
