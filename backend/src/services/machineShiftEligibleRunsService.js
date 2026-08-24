/**
 * Machine-scoped eligible run picker for Shift Production (read-only).
 * Reuses assertWorkOrderRunUsable — same rules as startRunSegment.
 */

const { prisma } = require("../utils/prisma");
const { domainError } = require("./machineShiftSessionErrors");
const { assertWorkOrderRunUsable } = require("./machineShiftSessionRunSegmentService");
const { normalizePositiveInt } = require("./machineShiftSessionService");

function flowLabelFromWorkOrder(wo) {
  const source = String(wo?.sourceType ?? "").toUpperCase();
  if (source === "GREEN_LEVEL_REPLENISHMENT") return "Green Level";
  const orderType = String(wo?.salesOrder?.orderType ?? "").toUpperCase();
  if (orderType === "NO_QTY") return "NO_QTY";
  if (orderType === "NORMAL" || orderType === "REGULAR" || !orderType) {
    return source === "CUSTOMER_REQUIREMENT" ? "Regular SO" : "Work Order";
  }
  return orderType.replace(/_/g, " ");
}

/**
 * List production runs eligible to start on this machine's shift session.
 * @param {number} machineId
 * @param {import('@prisma/client').PrismaClient} [db]
 * @returns {Promise<{ machine: object, runs: object[] }>}
 */
async function listEligibleRunsForMachine(machineId, db = prisma) {
  const id = normalizePositiveInt(machineId, "MACHINE_ID_INVALID", "Machine is required.");

  const machine = await db.machine.findUnique({
    where: { id },
    select: { id: true, machineCode: true, machineName: true, isActive: true },
  });
  if (!machine) {
    throw domainError(404, "MACHINE_NOT_FOUND", "Machine was not found.");
  }

  const allocations = await db.workOrderProductionRunAllocation.findMany({
    where: { machineId: id, isActive: true },
    orderBy: [{ workOrderId: "asc" }, { runSequence: "asc" }, { id: "asc" }],
    include: {
      workOrder: {
        select: {
          id: true,
          docNo: true,
          status: true,
          sourceType: true,
          salesOrder: { select: { orderType: true } },
        },
      },
      fgItem: { select: { id: true, itemName: true, hsnCode: true } },
      machine: { select: { id: true, machineCode: true, machineName: true } },
    },
  });

  const runs = [];
  for (const row of allocations) {
    try {
      await assertWorkOrderRunUsable(db, {
        runAllocationId: row.id,
        sessionMachineId: id,
      });
    } catch (e) {
      if (e && typeof e === "object" && e.expose === true) {
        continue;
      }
      throw e;
    }

    runs.push({
      workOrderId: row.workOrderId,
      workOrderNo: row.workOrder?.docNo ?? null,
      runAllocationId: row.id,
      runSequence: row.runSequence,
      itemId: row.fgItemId,
      itemCode: row.fgItem?.hsnCode ?? null,
      itemName: row.fgItem?.itemName ?? null,
      machine: {
        id: row.machine?.id ?? machine.id,
        machineCode: row.machine?.machineCode ?? machine.machineCode,
        machineName: row.machine?.machineName ?? machine.machineName,
      },
      productionFlow: flowLabelFromWorkOrder(row.workOrder),
      workOrderStatus: row.workOrder?.status ?? null,
    });
  }

  return {
    machine: {
      id: machine.id,
      machineCode: machine.machineCode,
      machineName: machine.machineName,
    },
    runs,
  };
}

module.exports = {
  listEligibleRunsForMachine,
  flowLabelFromWorkOrder,
};
