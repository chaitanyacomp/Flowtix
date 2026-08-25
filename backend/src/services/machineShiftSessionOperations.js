/**
 * Public Step 2A + 2B + 2C surface for Machine Shift Session operations (services only; no routes).
 */

const session = require("./machineShiftSessionService");
const operators = require("./machineShiftSessionOperatorService");
const runSegments = require("./machineShiftSessionRunSegmentService");
const downtime = require("./machineShiftDowntimeService");
const report = require("./machineShiftProductionReportService");
const lifecycle = require("./machineShiftSessionLifecycleService");
const adjustment = require("./machineShiftReportAdjustmentService");
const numbering = require("./machineShiftSessionNumbering");
const errors = require("./machineShiftSessionErrors");

module.exports = {
  // Start / helpers
  startShiftSession: session.startShiftSession,
  findOpenSessionForMachine: session.findOpenSessionForMachine,
  requireOpenSession: session.requireOpenSession,
  normalizeSessionDate: session.normalizeSessionDate,
  SESSION_STATUS: session.SESSION_STATUS,
  withShiftSessionTx: session.withShiftSessionTx,

  // Operators
  joinSessionOperator: operators.joinSessionOperator,
  leaveSessionOperator: operators.leaveSessionOperator,
  changePrimaryOperator: operators.changePrimaryOperator,
  listBusyOperatorsAcrossOpenSessions: operators.listBusyOperatorsAcrossOpenSessions,
  SYSTEM_LEAVE_REASON: operators.SYSTEM_LEAVE_REASON,

  // Run segments
  startRunSegment: runSegments.startRunSegment,
  closeRunSegment: runSegments.closeRunSegment,
  SEGMENT_STATUS: runSegments.SEGMENT_STATUS,
  SYSTEM_CLOSE_REASON: runSegments.SYSTEM_CLOSE_REASON,
  resolveRunSegmentCloseReason: runSegments.resolveRunSegmentCloseReason,
  assertWorkOrderRunUsable: runSegments.assertWorkOrderRunUsable,

  // Eligible runs / open downtime (Step 4A reads)
  listEligibleRunsForMachine: require("./machineShiftEligibleRunsService").listEligibleRunsForMachine,
  getOpenDowntimeForMachine: require("./machineShiftOpenDowntimeService").getOpenDowntimeForMachine,

  // Downtime
  pauseForDowntime: downtime.pauseForDowntime,
  resumeFromDowntime: downtime.resumeFromDowntime,
  continueDowntimeIntoSession: downtime.continueDowntimeIntoSession,
  durationMinutesFromTimestamps: downtime.durationMinutesFromTimestamps,

  // Report (Step 2B)
  REPORT_VERSION_STATUS: report.REPORT_VERSION_STATUS,
  saveShiftReportDraft: report.saveShiftReportDraft,
  submitShiftReport: report.submitShiftReport,
  returnShiftReport: report.returnShiftReport,
  verifyShiftReport: report.verifyShiftReport,
  ensureEditableDraftVersion: report.ensureEditableDraftVersion,

  // Shift Over + reopen + cancel (Step 2B)
  REOPEN_STATUS: lifecycle.REOPEN_STATUS,
  assessShiftSessionCancelEligibility: lifecycle.assessShiftSessionCancelEligibility,
  cancelShiftSession: lifecycle.cancelShiftSession,
  completeShiftOver: lifecycle.completeShiftOver,
  requestShiftSessionReopen: lifecycle.requestShiftSessionReopen,
  approveShiftSessionReopen: lifecycle.approveShiftSessionReopen,
  denyShiftSessionReopen: lifecycle.denyShiftSessionReopen,

  // Historical adjustment (Step 2C)
  ADJUSTMENT_STATUS: adjustment.ADJUSTMENT_STATUS,
  requestShiftReportAdjustment: adjustment.requestShiftReportAdjustment,
  approveShiftReportAdjustment: adjustment.approveShiftReportAdjustment,
  denyShiftReportAdjustment: adjustment.denyShiftReportAdjustment,
  applyShiftReportAdjustment: adjustment.applyShiftReportAdjustment,

  // Numbering / errors
  allocateShiftSessionNo: numbering.allocateShiftSessionNo,
  peekNextShiftSessionNo: numbering.peekNextShiftSessionNo,
  domainError: errors.domainError,
  mapShiftSessionPersistenceError: errors.mapShiftSessionPersistenceError,
};
