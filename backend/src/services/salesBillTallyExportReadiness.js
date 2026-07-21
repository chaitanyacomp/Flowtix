/**
 * Sales Bill Tally export readiness + human-readable mapping errors.
 * Presentation/validation only — does not change bill totals or GST math.
 */

const { normalizeTallyMasterCompareKey } = require("./tallyMasterImport/tallyXmlListHelpers");

const ERP_TRANSPORTATION_CHARGE_NAME = "Transportation Charges";

function money2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

function safeTrim(v) {
  const t = String(v ?? "").trim();
  return t || null;
}

function resolveConfiguredTransportationLedger({ tallyTransportationLedger, envLedger } = {}) {
  return safeTrim(tallyTransportationLedger) || safeTrim(envLedger) || null;
}

function sellerChargedFreightTaxable(payload) {
  const chargedBy = safeTrim(payload?.transportation?.chargedBy) || "OUR_COMPANY";
  if (chargedBy === "TRANSPORTER_DIRECTLY") return 0;
  return Math.abs(Number(payload?.transportation?.taxableAmount ?? 0));
}

function describeGstTreatment(payload) {
  const intra = payload?.tax?.taxIntraState;
  if (intra === true) return "Included in bill GST (intra-state CGST + SGST)";
  if (intra === false) return "Included in bill GST (inter-state IGST)";
  return "Included in bill GST (as stored on the finalized bill)";
}

/**
 * Human-readable block when seller-charged freight has no Tally ledger mapping.
 * Never expose only an internal sales-bill database id.
 */
function formatMissingTransportationLedgerError(payload) {
  const billNo =
    safeTrim(payload?.voucherNo) ||
    safeTrim(payload?.bill?.docNo) ||
    safeTrim(payload?.docNo) ||
    (payload?.salesBillId != null ? `SB-${payload.salesBillId}` : "this Sales Bill");
  const amount = money2(payload?.transportation?.amount ?? payload?.transportation?.taxableAmount ?? 0);
  const taxable = money2(payload?.transportation?.taxableAmount ?? 0);
  const transporter = safeTrim(payload?.transportation?.transporterName);
  const lines = [
    `Tally export blocked: ${ERP_TRANSPORTATION_CHARGE_NAME} is not mapped to a Tally ledger.`,
    "",
    `Bill: ${billNo}`,
    `Charge: ${ERP_TRANSPORTATION_CHARGE_NAME}`,
    `Amount: ₹${amount}${Number(taxable) > 0 && taxable !== amount ? ` (taxable ₹${taxable})` : ""}`,
    `GST treatment: ${describeGstTreatment(payload)}`,
  ];
  if (transporter) lines.push(`Transporter: ${transporter}`);
  lines.push(
    "",
    "Correction: open Map Transportation Ledger, enter the exact Tally ledger name used for freight/transportation (for example Transportation Charges, Freight Outward, Carriage Outward, or Freight & Forwarding), save, return to this bill, then Retry / Download Tally XML.",
    "Finalized bill totals are unchanged — mapping does not require cancel, edit, or re-finalize.",
  );
  return lines.join("\n");
}

const READINESS = {
  READY: "READY",
  MISSING_CUSTOMER_LEDGER_MAPPING: "MISSING_CUSTOMER_LEDGER_MAPPING",
  MISSING_SALES_LEDGER_MAPPING: "MISSING_SALES_LEDGER_MAPPING",
  MISSING_TAX_LEDGER_MAPPING: "MISSING_TAX_LEDGER_MAPPING",
  MISSING_TRANSPORTATION_LEDGER_MAPPING: "MISSING_TRANSPORTATION_LEDGER_MAPPING",
  MISSING_STOCK_ITEM_MAPPING: "MISSING_STOCK_ITEM_MAPPING",
  MISSING_UNIT_MAPPING: "MISSING_UNIT_MAPPING",
  MISSING_ROUND_OFF_LEDGER_MAPPING: "MISSING_ROUND_OFF_LEDGER_MAPPING",
  AMBIGUOUS_MASTER_MAPPING: "AMBIGUOUS_MASTER_MAPPING",
};

const MAPPING_STATUS = {
  MAPPED: "MAPPED",
  UNVERIFIED: "UNVERIFIED",
  MISSING: "MISSING",
  AMBIGUOUS: "AMBIGUOUS",
  PATTERN: "PATTERN",
};

/**
 * @param {{
 *   type: string;
 *   erpValue: string | null;
 *   expectedTallyMaster: string | null;
 *   mappingStatus: string;
 *   exactError: string | null;
 *   action?: string | null;
 *   tallyGuid?: string | null;
 *   xmlContext?: string | null;
 * }} row
 */
function pushRef(refs, row) {
  refs.push({
    type: row.type,
    erpValue: row.erpValue,
    expectedTallyMaster: row.expectedTallyMaster,
    mappingStatus: row.mappingStatus,
    exactError: row.exactError,
    action: row.action ?? null,
    tallyGuid: row.tallyGuid ?? null,
    xmlContext: row.xmlContext ?? null,
  });
}

/**
 * Build mandatory master-reference checklist for Sales Bill Tally voucher export.
 * Does not call Tally live — validates ERP-stored identity and required reference names.
 */
function buildSalesBillTallyMasterReferences(payload) {
  const refs = [];
  const partyLedger =
    safeTrim(payload?.customer?.partyLedgerName) || safeTrim(payload?.customer?.customerName);
  const erpParty = safeTrim(payload?.customer?.erpDisplayName) || partyLedger;
  const partyTallyName = safeTrim(payload?.customer?.tallyName);
  const partyGuid = safeTrim(payload?.customer?.tallyGuid);

  if (!partyLedger) {
    pushRef(refs, {
      type: "PARTY_LEDGER",
      erpValue: erpParty,
      expectedTallyMaster: null,
      mappingStatus: MAPPING_STATUS.MISSING,
      exactError: "Party ledger name is missing — map the customer to the exact Tally Sundry Debtor ledger NAME.",
      action: "MAP_EXISTING_MASTER",
      xmlContext: "VOUCHER/PARTYLEDGERNAME",
    });
  } else if (
    partyTallyName &&
    erpParty &&
    normalizeTallyMasterCompareKey(partyTallyName) !== normalizeTallyMasterCompareKey(erpParty) &&
    normalizeTallyMasterCompareKey(partyLedger) !== normalizeTallyMasterCompareKey(partyTallyName)
  ) {
    pushRef(refs, {
      type: "PARTY_LEDGER",
      erpValue: erpParty,
      expectedTallyMaster: partyTallyName,
      mappingStatus: MAPPING_STATUS.AMBIGUOUS,
      exactError: `ERP display name "${erpParty}" differs from stored Tally ledger "${partyTallyName}". Export must use the exact Tally NAME.`,
      action: "MAP_EXISTING_MASTER",
      tallyGuid: partyGuid,
      xmlContext: "VOUCHER/PARTYLEDGERNAME",
    });
  } else {
    pushRef(refs, {
      type: "PARTY_LEDGER",
      erpValue: erpParty,
      expectedTallyMaster: partyLedger,
      mappingStatus: partyTallyName || partyGuid ? MAPPING_STATUS.MAPPED : MAPPING_STATUS.UNVERIFIED,
      exactError:
        partyTallyName || partyGuid
          ? null
          : "No stored Tally GUID/NAME on this customer. Re-import from Tally or Map Existing Master so the voucher references the exact ledger.",
      action: partyTallyName || partyGuid ? null : "MAP_EXISTING_MASTER",
      tallyGuid: partyGuid,
      xmlContext: "VOUCHER/PARTYLEDGERNAME",
    });
  }

  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  const seenItems = new Set();
  const seenUnits = new Set();
  for (const ln of lines) {
    const itemKey = String(ln?.itemId ?? ln?.itemName ?? "");
    if (!seenItems.has(itemKey)) {
      seenItems.add(itemKey);
      const expected = safeTrim(ln?.itemName);
      const erp = safeTrim(ln?.erpItemName) || expected;
      const guid = safeTrim(ln?.tallyGuid);
      const imported = Boolean(ln?.tallyImportedAt || ln?.tallyName || guid);
      if (!expected) {
        pushRef(refs, {
          type: "STOCK_ITEM",
          erpValue: erp,
          expectedTallyMaster: null,
          mappingStatus: MAPPING_STATUS.MISSING,
          exactError: "Stock item name is missing for a bill line.",
          action: "MAP_EXISTING_MASTER",
          xmlContext: "ALLINVENTORYENTRIES.LIST/STOCKITEMNAME",
        });
      } else {
        pushRef(refs, {
          type: "STOCK_ITEM",
          erpValue: erp,
          expectedTallyMaster: expected,
          mappingStatus: imported ? MAPPING_STATUS.MAPPED : MAPPING_STATUS.UNVERIFIED,
          exactError: imported
            ? null
            : "Stock item has no stored Tally identity. Voucher will reference the name only — do not Create/Alter masters in voucher XML. Map Existing or Create Missing Master separately if Tally reports missing.",
          action: imported ? null : "MAP_EXISTING_MASTER",
          tallyGuid: guid,
          xmlContext: "ALLINVENTORYENTRIES.LIST/STOCKITEMNAME",
        });
      }
    }

    const unit = safeTrim(ln?.unit);
    const unitKey = unit || `missing-${ln?.itemId ?? ""}`;
    if (!seenUnits.has(unitKey)) {
      seenUnits.add(unitKey);
      const erpUnit = safeTrim(ln?.erpUnit) || unit;
      if (!unit) {
        pushRef(refs, {
          type: "UNIT",
          erpValue: erpUnit,
          expectedTallyMaster: null,
          mappingStatus: MAPPING_STATUS.MISSING,
          exactError: "Unit is missing on a bill line — Tally quantity/rate symbols require an exact unit.",
          action: "MAP_EXISTING_MASTER",
          xmlContext: "ALLINVENTORYENTRIES.LIST/ACTUALQTY|RATE",
        });
      } else {
        pushRef(refs, {
          type: "UNIT",
          erpValue: erpUnit,
          expectedTallyMaster: unit,
          mappingStatus: MAPPING_STATUS.MAPPED,
          exactError: null,
          xmlContext: "ALLINVENTORYENTRIES.LIST/ACTUALQTY|RATE",
        });
      }
    }
  }

  const buckets = Array.isArray(payload?.taxBuckets) ? payload.taxBuckets : [];
  if (buckets.length > 1) {
    for (const b of buckets) {
      if (safeTrim(b.salesLedger)) {
        pushRef(refs, {
          type: "SALES_LEDGER",
          erpValue: `GST ${b.gstRate}%`,
          expectedTallyMaster: safeTrim(b.salesLedger),
          mappingStatus: MAPPING_STATUS.PATTERN,
          exactError: null,
          xmlContext: "ACCOUNTINGALLOCATIONS.LIST/LEDGERNAME",
        });
      } else {
        pushRef(refs, {
          type: "SALES_LEDGER",
          erpValue: `GST ${b.gstRate}%`,
          expectedTallyMaster: null,
          mappingStatus: MAPPING_STATUS.MISSING,
          exactError: "Sales ledger name could not be resolved for a GST rate bucket.",
          xmlContext: "ACCOUNTINGALLOCATIONS.LIST/LEDGERNAME",
        });
      }
      if (Math.abs(Number(b.cgst ?? 0)) > 1e-6) {
        pushRef(refs, {
          type: "CGST_LEDGER",
          erpValue: `CGST @ GST ${b.gstRate}%`,
          expectedTallyMaster: safeTrim(b.cgstLedger),
          mappingStatus: safeTrim(b.cgstLedger) ? MAPPING_STATUS.PATTERN : MAPPING_STATUS.MISSING,
          exactError: safeTrim(b.cgstLedger) ? null : "Output CGST ledger missing for GST rate bucket.",
          xmlContext: "LEDGERENTRIES.LIST",
        });
      }
      if (Math.abs(Number(b.sgst ?? 0)) > 1e-6) {
        pushRef(refs, {
          type: "SGST_LEDGER",
          erpValue: `SGST @ GST ${b.gstRate}%`,
          expectedTallyMaster: safeTrim(b.sgstLedger),
          mappingStatus: safeTrim(b.sgstLedger) ? MAPPING_STATUS.PATTERN : MAPPING_STATUS.MISSING,
          exactError: safeTrim(b.sgstLedger) ? null : "Output SGST ledger missing for GST rate bucket.",
          xmlContext: "LEDGERENTRIES.LIST",
        });
      }
      if (Math.abs(Number(b.igst ?? 0)) > 1e-6) {
        pushRef(refs, {
          type: "IGST_LEDGER",
          erpValue: `IGST @ GST ${b.gstRate}%`,
          expectedTallyMaster: safeTrim(b.igstLedger),
          mappingStatus: safeTrim(b.igstLedger) ? MAPPING_STATUS.PATTERN : MAPPING_STATUS.MISSING,
          exactError: safeTrim(b.igstLedger) ? null : "Output IGST ledger missing for GST rate bucket.",
          xmlContext: "LEDGERENTRIES.LIST",
        });
      }
    }
  } else {
    const sales = safeTrim(payload?.tally?.ledgers?.sales);
    pushRef(refs, {
      type: "SALES_LEDGER",
      erpValue: sales,
      expectedTallyMaster: sales,
      mappingStatus: sales ? MAPPING_STATUS.PATTERN : MAPPING_STATUS.MISSING,
      exactError: sales ? null : "Sales ledger name could not be resolved for this Sales Bill.",
      xmlContext: "ACCOUNTINGALLOCATIONS.LIST/LEDGERNAME",
    });
    const cgst = Math.abs(Number(payload?.tax?.totalCgst ?? 0));
    const sgst = Math.abs(Number(payload?.tax?.totalSgst ?? 0));
    const igst = Math.abs(Number(payload?.tax?.totalIgst ?? 0));
    if (cgst > 1e-6) {
      const name = safeTrim(payload?.tally?.ledgers?.cgst);
      pushRef(refs, {
        type: "CGST_LEDGER",
        erpValue: name,
        expectedTallyMaster: name,
        mappingStatus: name ? MAPPING_STATUS.PATTERN : MAPPING_STATUS.MISSING,
        exactError: name ? null : "Output CGST ledger mapping is incomplete.",
        xmlContext: "LEDGERENTRIES.LIST",
      });
    }
    if (sgst > 1e-6) {
      const name = safeTrim(payload?.tally?.ledgers?.sgst);
      pushRef(refs, {
        type: "SGST_LEDGER",
        erpValue: name,
        expectedTallyMaster: name,
        mappingStatus: name ? MAPPING_STATUS.PATTERN : MAPPING_STATUS.MISSING,
        exactError: name ? null : "Output SGST ledger mapping is incomplete.",
        xmlContext: "LEDGERENTRIES.LIST",
      });
    }
    if (igst > 1e-6) {
      const name = safeTrim(payload?.tally?.ledgers?.igst);
      pushRef(refs, {
        type: "IGST_LEDGER",
        erpValue: name,
        expectedTallyMaster: name,
        mappingStatus: name ? MAPPING_STATUS.PATTERN : MAPPING_STATUS.MISSING,
        exactError: name ? null : "Output IGST ledger mapping is missing.",
        xmlContext: "LEDGERENTRIES.LIST",
      });
    }
  }

  const freight = sellerChargedFreightTaxable(payload);
  if (freight > 1e-6) {
    const ledger = safeTrim(payload?.transportation?.ledger);
    pushRef(refs, {
      type: "TRANSPORTATION_LEDGER",
      erpValue: ERP_TRANSPORTATION_CHARGE_NAME,
      expectedTallyMaster: ledger,
      mappingStatus: ledger ? MAPPING_STATUS.MAPPED : MAPPING_STATUS.MISSING,
      exactError: ledger ? null : formatMissingTransportationLedgerError(payload),
      action: ledger ? null : "MAP_TRANSPORTATION_LEDGER",
      xmlContext: "LEDGERENTRIES.LIST (freight)",
    });
  }

  const roundOff = Math.abs(Number(payload?.tax?.roundOffAmount ?? 0));
  if (roundOff > 1e-4) {
    const ledger = safeTrim(payload?.transportation?.roundOffLedger);
    pushRef(refs, {
      type: "ROUND_OFF_LEDGER",
      erpValue: "Round Off",
      expectedTallyMaster: ledger,
      mappingStatus: ledger ? MAPPING_STATUS.PATTERN : MAPPING_STATUS.MISSING,
      exactError: ledger ? null : "Round-off ledger name is missing.",
      xmlContext: "LEDGERENTRIES.LIST (round off)",
    });
  }

  const godown =
    safeTrim(payload?.inventoryDefaults?.godownName) ||
    safeTrim(require("../config/tally").TALLY_INVENTORY_DEFAULTS.godownName);
  pushRef(refs, {
    type: "GODOWN",
    erpValue: godown,
    expectedTallyMaster: godown,
    mappingStatus: godown ? MAPPING_STATUS.PATTERN : MAPPING_STATUS.MISSING,
    exactError: godown
      ? null
      : "Godown/location name is missing — Tally inventory allocations require an exact godown.",
    xmlContext: "BATCHALLOCATIONS.LIST/GODOWNNAME",
  });

  return refs;
}

function assessSalesBillTallyExportReadiness(payload) {
  const issues = [];
  const masterReferences = buildSalesBillTallyMasterReferences(payload);

  if (!safeTrim(payload?.customer?.customerName) && !safeTrim(payload?.customer?.partyLedgerName)) {
    issues.push({
      code: READINESS.MISSING_CUSTOMER_LEDGER_MAPPING,
      label: "Missing Customer Ledger Mapping",
      message: "Tally export blocked: customer / party ledger name is missing on this Sales Bill.",
      action: "MAP_EXISTING_MASTER",
    });
  }

  const buckets = Array.isArray(payload?.taxBuckets) ? payload.taxBuckets : [];
  const salesOk =
    buckets.length > 1
      ? buckets.every((b) => safeTrim(b.salesLedger))
      : Boolean(safeTrim(payload?.tally?.ledgers?.sales));
  if (!salesOk) {
    issues.push({
      code: READINESS.MISSING_SALES_LEDGER_MAPPING,
      label: "Missing Sales Ledger Mapping",
      message: "Tally export blocked: sales ledger name could not be resolved for this Sales Bill.",
    });
  }

  const cgst = Math.abs(Number(payload?.tax?.totalCgst ?? 0));
  const sgst = Math.abs(Number(payload?.tax?.totalSgst ?? 0));
  const igst = Math.abs(Number(payload?.tax?.totalIgst ?? 0));
  const taxIntraState = payload?.tax?.taxIntraState;
  if (buckets.length > 1) {
    for (const b of buckets) {
      const needCgst = Math.abs(Number(b.cgst ?? 0)) > 1e-6;
      const needSgst = Math.abs(Number(b.sgst ?? 0)) > 1e-6;
      const needIgst = Math.abs(Number(b.igst ?? 0)) > 1e-6;
      if (needCgst && !safeTrim(b.cgstLedger)) {
        issues.push({
          code: READINESS.MISSING_TAX_LEDGER_MAPPING,
          label: "Missing Tax Ledger Mapping",
          message: "Tally export blocked: Output CGST ledger is missing for a GST rate bucket.",
        });
        break;
      }
      if (needSgst && !safeTrim(b.sgstLedger)) {
        issues.push({
          code: READINESS.MISSING_TAX_LEDGER_MAPPING,
          label: "Missing Tax Ledger Mapping",
          message: "Tally export blocked: Output SGST ledger is missing for a GST rate bucket.",
        });
        break;
      }
      if (needIgst && !safeTrim(b.igstLedger)) {
        issues.push({
          code: READINESS.MISSING_TAX_LEDGER_MAPPING,
          label: "Missing Tax Ledger Mapping",
          message: "Tally export blocked: Output IGST ledger is missing for a GST rate bucket.",
        });
        break;
      }
    }
  } else if (taxIntraState === true) {
    if ((cgst > 1e-6 && !safeTrim(payload?.tally?.ledgers?.cgst)) || (sgst > 1e-6 && !safeTrim(payload?.tally?.ledgers?.sgst))) {
      issues.push({
        code: READINESS.MISSING_TAX_LEDGER_MAPPING,
        label: "Missing Tax Ledger Mapping",
        message: "Tally export blocked: intra-state tax ledger mapping is incomplete.",
      });
    }
  } else if (taxIntraState === false) {
    if (igst > 1e-6 && !safeTrim(payload?.tally?.ledgers?.igst)) {
      issues.push({
        code: READINESS.MISSING_TAX_LEDGER_MAPPING,
        label: "Missing Tax Ledger Mapping",
        message: "Tally export blocked: inter-state IGST ledger mapping is missing.",
      });
    }
  }

  const freight = sellerChargedFreightTaxable(payload);
  if (freight > 1e-6 && !safeTrim(payload?.transportation?.ledger)) {
    issues.push({
      code: READINESS.MISSING_TRANSPORTATION_LEDGER_MAPPING,
      label: "Missing Transportation Ledger Mapping",
      message: formatMissingTransportationLedgerError(payload),
      chargeName: ERP_TRANSPORTATION_CHARGE_NAME,
      amount: money2(payload?.transportation?.amount ?? freight),
      taxableAmount: money2(freight),
      gstTreatment: describeGstTreatment(payload),
      transporterName: safeTrim(payload?.transportation?.transporterName),
      action: "MAP_TRANSPORTATION_LEDGER",
    });
  }

  for (const ref of masterReferences) {
    if (ref.mappingStatus === MAPPING_STATUS.MISSING) {
      if (ref.type === "STOCK_ITEM") {
        issues.push({
          code: READINESS.MISSING_STOCK_ITEM_MAPPING,
          label: "Missing Stock Item Mapping",
          message: ref.exactError || "Tally export blocked: a stock item reference is missing.",
          action: ref.action,
        });
      } else if (ref.type === "UNIT") {
        issues.push({
          code: READINESS.MISSING_UNIT_MAPPING,
          label: "Missing Unit Mapping",
          message: ref.exactError || "Tally export blocked: a unit reference is missing.",
          action: ref.action,
        });
      } else if (ref.type === "ROUND_OFF_LEDGER") {
        issues.push({
          code: READINESS.MISSING_ROUND_OFF_LEDGER_MAPPING,
          label: "Missing Round Off Ledger Mapping",
          message: ref.exactError || "Tally export blocked: round-off ledger is missing.",
        });
      }
    }
    if (ref.mappingStatus === MAPPING_STATUS.AMBIGUOUS) {
      issues.push({
        code: READINESS.AMBIGUOUS_MASTER_MAPPING,
        label: "Ambiguous Master Mapping",
        message: ref.exactError || "Tally export blocked: a master mapping is ambiguous.",
        action: ref.action,
      });
    }
  }

  const primary = issues[0] || null;
  const blockingRefs = masterReferences.filter(
    (r) => r.mappingStatus === MAPPING_STATUS.MISSING || r.mappingStatus === MAPPING_STATUS.AMBIGUOUS,
  );
  return {
    ready: issues.length === 0,
    status: primary ? primary.code : READINESS.READY,
    label: primary ? primary.label : "Ready",
    issues,
    primaryIssue: primary,
    masterReferences,
    blockingMasterCount: blockingRefs.length,
  };
}

module.exports = {
  ERP_TRANSPORTATION_CHARGE_NAME,
  READINESS,
  MAPPING_STATUS,
  resolveConfiguredTransportationLedger,
  sellerChargedFreightTaxable,
  formatMissingTransportationLedgerError,
  buildSalesBillTallyMasterReferences,
  assessSalesBillTallyExportReadiness,
};
