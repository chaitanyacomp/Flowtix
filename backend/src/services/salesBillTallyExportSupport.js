const { prisma } = require("../utils/prisma");
const { logActivity } = require("./activityLogService");
const {
  ACTIVITY_MODULES,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
} = require("../constants/activityLogConstants");
const { displaySalesBillNo } = require("../utils/docNoLabels");

const companyStateSelectForTallyExport = {
  companyGstin: true,
  companyState: true,
  tallyTransportationLedger: true,
  companyStateRef: { select: { id: true, stateName: true, stateCode: true } },
};

async function loadCompanyStateForTallyExport(db = prisma) {
  return db.appSetting.findUnique({
    where: { id: 1 },
    select: companyStateSelectForTallyExport,
  });
}

/**
 * Log EXPORT_FAILED at most once per identical error for a bill (avoids spam on repeated retries).
 */
async function logSalesBillExportFailureOnce({ user, bill, errMsg, dispatchId = null, extras = {} }) {
  const sbDoc = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
  const errKey = String(errMsg).slice(0, 240);
  try {
    const recent = await prisma.activityLog.findFirst({
      where: {
        entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
        entityId: bill.id,
        action: ACTIVITY_ACTIONS.EXPORT_FAILED,
      },
      orderBy: { createdAt: "desc" },
      select: { metadataJson: true },
    });
    const prev = recent?.metadataJson && typeof recent.metadataJson === "object" ? recent.metadataJson.error : null;
    if (prev != null && String(prev) === errKey) {
      return false;
    }
  } catch {
    /* still attempt to log */
  }
  await logActivity({
    user,
    module: ACTIVITY_MODULES.SALES_BILL,
    entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
    entityId: bill.id,
    docNo: sbDoc,
    action: ACTIVITY_ACTIONS.EXPORT_FAILED,
    message: `Sales Bill ${sbDoc} Tally export failed`,
    metadata: {
      error: errKey,
      ...(dispatchId != null ? { dispatchId } : {}),
      ...extras,
    },
  });
  return true;
}

module.exports = {
  companyStateSelectForTallyExport,
  loadCompanyStateForTallyExport,
  logSalesBillExportFailureOnce,
};
