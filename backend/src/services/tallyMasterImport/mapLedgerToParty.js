const { cleanGstinChars, isValidGstinFormat } = require("../gstinNormalize");
const {
  strVal,
  getByLocalTag,
  getListBlocks,
  joinAddressList,
  findFirstTextByTags,
  masterDisplayName,
  masterGuid,
} = require("./tallyXmlListHelpers");

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
  return masterDisplayName(ledger);
}

/**
 * Canonical Tally master-import pipeline id — returned on every preview so operators
 * can confirm the live server loaded this mapper (not a stale Node process).
 */
const TALLY_IMPORT_PIPELINE_ID = "tallyXmlListHelpers+mapLedgerToParty/v2-gstin-mailing-contact";

/**
 * Collect GSTIN candidates (for diagnostics / tests). Prefer valid format via extractGstin.
 * @param {Record<string, unknown>} ledger
 * @returns {string[]}
 */
function collectGstinCandidates(ledger) {
  const gstTags = [
    "GSTIN",
    "PARTYGSTIN",
    "LEDGERGSTIN",
    "GSTREGISTRATIONNUMBER",
    "GSTREGISTRATIONNO",
    "GSTNUMBER",
  ];
  /** @type {string[]} */
  const candidates = [];
  const pushCandidate = (raw) => {
    const t = String(raw || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t) return;
    if (!candidates.some((c) => cleanGstinChars(c) === cleanGstinChars(t))) candidates.push(t);
  };

  for (const listName of ["LEDGSTREGDETAILS", "LEDGSTREGISTRATION", "GSTDETAILS"]) {
    for (const block of getListBlocks(ledger, listName)) {
      for (const tag of gstTags) {
        const g = findFirstTextByTags(block, [tag], 6);
        if (g) pushCandidate(g);
      }
    }
  }
  for (const tag of gstTags) {
    const g = findFirstTextByTags(ledger, [tag], 14);
    if (g) pushCandidate(g);
  }
  return candidates;
}

/**
 * GSTIN only — never treat PAN (INCOMETAXNUMBER) as GSTIN.
 * Prefer LEDGSTREGDETAILS / LEDGSTREGISTRATION list blocks, then deep GSTIN tags.
 *
 * @param {Record<string, unknown>} ledger
 * @returns {string | null}
 */
function extractGstin(ledger) {
  const candidates = collectGstinCandidates(ledger);
  const valid = candidates.find((c) => isValidGstinFormat(c));
  if (valid) return valid;
  return candidates[0] || null;
}

/**
 * Dev-only diagnostic snapshot for a mapped party ledger (gated by caller).
 * @param {Record<string, unknown>} ledger
 * @param {ReturnType<typeof mapLedgerToParty>} mapped
 */
function buildPartyMapDiagnostics(ledger, mapped) {
  const mailing = extractMailingDetails(ledger);
  const contact = extractContactPhoneEmail(ledger);
  return {
    ledgerName: masterDisplayName(ledger) || mapped?.tallyName || null,
    gstinCandidates: collectGstinCandidates(ledger),
    selectedGstin: mapped?.gst ?? null,
    mailingName: mailing.mailingName || null,
    rawMailingAddressLines: mailing.address || null,
    finalMappedAddress: mapped?.address ?? null,
    contactCandidates: {
      contactDetailsName: getListBlocks(ledger, "CONTACTDETAILS")
        .map((b) => strVal(getByLocalTag(b, "NAME")))
        .filter(Boolean),
      ledgerContact: strVal(getByLocalTag(ledger, "LEDGERCONTACT")) || null,
    },
    selectedContact: mapped?.contact ?? null,
    phoneCandidates: {
      contactDetailsPhone: getListBlocks(ledger, "CONTACTDETAILS")
        .map((b) => strVal(getByLocalTag(b, "PHONENUMBER")) || strVal(getByLocalTag(b, "PHONE")) || strVal(getByLocalTag(b, "MOBILE")))
        .filter(Boolean),
      ledgerMobile: strVal(getByLocalTag(ledger, "LEDGERMOBILE")) || null,
      ledgerPhone: strVal(getByLocalTag(ledger, "LEDGERPHONE")) || null,
    },
    selectedPhone: mapped?.phone ?? null,
    // Static ids for diagnostics — require.resolve() is not valid after Batch 3 bundling
    mapperModule: "tallyMasterImport/mapLedgerToParty",
    helpersModule: "tallyMasterImport/tallyXmlListHelpers",
    pipelineId: TALLY_IMPORT_PIPELINE_ID,
  };
}

/**
 * LEDMAILINGDETAILS (Tally Prime) — mailing name, address lines, state, pin, country.
 *
 * @param {Record<string, unknown>} ledger
 * @returns {{
 *   mailingName: string;
 *   address: string;
 *   stateText: string;
 *   pincode: string;
 *   country: string;
 * }}
 */
function extractMailingDetails(ledger) {
  let mailingName = "";
  let address = "";
  let stateText = "";
  let pincode = "";
  let country = "";

  const blocks = getListBlocks(ledger, "LEDMAILINGDETAILS");
  for (const block of blocks) {
    if (!mailingName) {
      mailingName = strVal(getByLocalTag(block, "MAILINGNAME")) || "";
    }
    if (!address) {
      address = joinAddressList(block);
    }
    if (!stateText) {
      stateText =
        strVal(getByLocalTag(block, "STATE")) ||
        strVal(getByLocalTag(block, "STATENAME")) ||
        strVal(getByLocalTag(block, "PLACEOFSUPPLY")) ||
        "";
    }
    if (!pincode) {
      pincode = strVal(getByLocalTag(block, "PINCODE")) || strVal(getByLocalTag(block, "PINCODEMAILING")) || "";
    }
    if (!country) {
      country = strVal(getByLocalTag(block, "COUNTRY")) || strVal(getByLocalTag(block, "COUNTRYOFRESIDENCE")) || "";
    }
  }

  // Legacy / alternate top-level ADDRESS.LIST
  if (!address) {
    address = joinAddressList(ledger);
  }
  if (!stateText) {
    stateText =
      strVal(getByLocalTag(ledger, "STATE")) ||
      strVal(getByLocalTag(ledger, "STATENAME")) ||
      strVal(getByLocalTag(ledger, "LEDSTATENAME")) ||
      strVal(getByLocalTag(ledger, "PRIORSTATENAME")) ||
      "";
  }
  if (!pincode) {
    pincode = strVal(getByLocalTag(ledger, "PINCODE")) || "";
  }
  if (!country) {
    country =
      strVal(getByLocalTag(ledger, "COUNTRY")) ||
      strVal(getByLocalTag(ledger, "COUNTRYOFRESIDENCE")) ||
      "";
  }

  return {
    mailingName: mailingName.trim(),
    address: address.trim(),
    stateText: stateText.trim(),
    pincode: pincode.trim(),
    country: country.trim(),
  };
}

/**
 * Contact person + phone from CONTACTDETAILS.LIST with LEDGER* fallbacks.
 *
 * @param {Record<string, unknown>} ledger
 * @returns {{ contact: string; phone: string; email: string }}
 */
function extractContactPhoneEmail(ledger) {
  let contact = "";
  let phone = "";

  for (const block of getListBlocks(ledger, "CONTACTDETAILS")) {
    if (!contact) {
      contact = strVal(getByLocalTag(block, "NAME")) || "";
    }
    if (!phone) {
      phone =
        strVal(getByLocalTag(block, "PHONENUMBER")) ||
        strVal(getByLocalTag(block, "PHONE")) ||
        strVal(getByLocalTag(block, "MOBILE")) ||
        "";
    }
  }

  if (!contact) {
    contact =
      strVal(getByLocalTag(ledger, "LEDGERCONTACT")) ||
      strVal(getByLocalTag(ledger, "CONTACT")) ||
      "";
  }
  if (!phone) {
    phone =
      strVal(getByLocalTag(ledger, "LEDGERMOBILE")) ||
      strVal(getByLocalTag(ledger, "LEDGERPHONE")) ||
      strVal(getByLocalTag(ledger, "MOBILE")) ||
      strVal(getByLocalTag(ledger, "PHONENUMBER")) ||
      strVal(getByLocalTag(ledger, "PHONE")) ||
      "";
  }

  const email =
    strVal(getByLocalTag(ledger, "EMAIL")) ||
    strVal(getByLocalTag(ledger, "EMAILID")) ||
    findFirstTextByTags(ledger, ["EMAIL", "EMAILID"], 8) ||
    "";

  return { contact: contact.trim(), phone: phone.trim(), email: email.trim() };
}

/**
 * Compose registered office address text for ERP (no dedicated pincode/country columns).
 * @param {{ address: string; pincode: string; country: string }} m
 */
function composeRegisteredOfficeAddress(m) {
  const parts = [];
  if (m.address) parts.push(m.address);
  if (m.pincode) parts.push(m.pincode);
  if (m.country) parts.push(m.country);
  return parts.join("\n").trim();
}

/**
 * Map raw Tally LEDGER object to party fields (customer or supplier).
 *
 * @param {unknown} ledgerRaw
 * @param {"CUSTOMER" | "SUPPLIER"} kind
 * @returns {null | {
 *   tallyName: string;
 *   tallyGuid: string | null;
 *   parentGroup: string;
 *   name: string;
 *   gst: string | null;
 *   address: string | null;
 *   stateText: string | null;
 *   pincode: string | null;
 *   country: string | null;
 *   contact: string | null;
 *   phone: string | null;
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

  const mailing = extractMailingDetails(ledger);
  const { contact, phone, email } = extractContactPhoneEmail(ledger);
  const gstRaw = extractGstin(ledger);
  const name = mailing.mailingName || tallyName;
  const address = composeRegisteredOfficeAddress(mailing) || null;

  return {
    tallyName,
    tallyGuid: masterGuid(ledger),
    parentGroup,
    name,
    gst: gstRaw || null,
    address,
    stateText: mailing.stateText || null,
    pincode: mailing.pincode || null,
    country: mailing.country || null,
    contact: contact || null,
    phone: phone || null,
    email: email || null,
  };
}

module.exports = {
  classifySundryLedgerParent,
  mapLedgerToParty,
  ledgerDisplayName,
  extractGstin,
  collectGstinCandidates,
  extractMailingDetails,
  extractContactPhoneEmail,
  composeRegisteredOfficeAddress,
  buildPartyMapDiagnostics,
  TALLY_IMPORT_PIPELINE_ID,
};
