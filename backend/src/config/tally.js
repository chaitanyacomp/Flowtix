const TALLY_LEDGER_NAMES = {
  purchase: "Local Purchase @18%",
  cgst: "Input CGST @9%",
  sgst: "Input SGST @9%",
  igst: "Input IGST @18%",
  sales: "Local Sales @18%",
  outCgst: "Output CGST @9%",
  outSgst: "Output SGST @9%",
  outIgst: "Output IGST @18%",
};

/**
 * Dynamic ledger naming patterns (kept centralized; no ERP UI needed).
 * Sales Bill export uses these to build ledger names like:
 * - Local Sales @18%
 * - Output CGST @9%
 * - Output SGST @9%
 * - Interstate Sales @18%
 * - Output IGST @18%
 */
const TALLY_LEDGER_PATTERNS = {
  localSalesPrefix: "Local Sales",
  interstateSalesPrefix: "Interstate Sales",
  outputCgstPrefix: "Output CGST",
  outputSgstPrefix: "Output SGST",
  outputIgstPrefix: "Output IGST",
  // Purchase Bill export (dynamic by GST rate)
  localPurchasePrefix: "Local Purchase",
  interstatePurchasePrefix: "Interstate Purchase",
  inputCgstPrefix: "Input CGST",
  inputSgstPrefix: "Input SGST",
  inputIgstPrefix: "Input IGST",
};

module.exports = { TALLY_LEDGER_NAMES, TALLY_LEDGER_PATTERNS };

