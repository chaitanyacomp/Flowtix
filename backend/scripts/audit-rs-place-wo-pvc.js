require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { prisma } = require("../src/utils/prisma");
const { getRequirementSheetExecutionSummary } = require("../src/services/requirementSheetExecutionService");
const { createNoQtyWorkOrderFromLockedSheet } = require("../src/services/noQtyExecutionReleaseService");

const SHEET_ID = 261; // RS-26-0001
const PVC_ITEM_ID = 76;
const PARTIAL_QTY = 2000;

(async () => {
  const before = await getRequirementSheetExecutionSummary(prisma, SHEET_ID);
  console.log("BEFORE placement:", {
    woPlaced: before.totals.woPlacedQty,
    rsBalance: before.totals.rsBalanceQty,
    pvc: before.placement.lines.find((l) => l.itemName === "PVC Angle"),
  });

  const sheet = await prisma.requirementSheet.findUnique({
    where: { id: SHEET_ID },
    include: {
      salesOrder: { include: { lines: { include: { item: true } } } },
      lines: { include: { item: true }, orderBy: { id: "asc" } },
    },
  });

  const result = await prisma.$transaction(async (tx) =>
    createNoQtyWorkOrderFromLockedSheet(tx, sheet, {
      requestedLines: [{ itemId: PVC_ITEM_ID, qty: PARTIAL_QTY }],
    }),
  );

  console.log("WO CREATION RESULT:", result);

  const after = await getRequirementSheetExecutionSummary(prisma, SHEET_ID);
  console.log("AFTER placement:", {
    woPlaced: after.totals.woPlacedQty,
    rsBalance: after.totals.rsBalanceQty,
    pvc: after.placement.lines.find((l) => l.itemName === "PVC Angle"),
    existingWoCount: after.existingWoSummary.length,
    existingWo: after.existingWoSummary,
  });

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
