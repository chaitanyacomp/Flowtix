const { test } = require("node:test");
const { prisma } = require("../../src/utils/prisma");

test("live audit SO-26-0001", async () => {
  const so = await prisma.salesOrder.findFirst({
    where: { docNo: "SO-26-0001" },
    include: {
      lines: { include: { item: true } },
      customer: true,
      quotation: true,
    },
  });
  const mrs = await prisma.materialRequirement.findMany({
    where: { salesOrder: { docNo: "SO-26-0001" } },
    include: {
      workOrder: true,
      lines: {
        include: {
          rmItem: true,
          procurementLinks: { include: { rmPoLine: { include: { rmPo: true, grnLines: { include: { grn: true } } } } } },
          purchaseRequestSourceLinks: {
            include: {
              purchaseRequestLine: {
                include: {
                  purchaseRequest: true,
                  poLinks: { include: { rmPoLine: { include: { rmPo: true, grnLines: { include: { grn: true } } } } } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });
  const wos = await prisma.workOrder.findMany({
    where: { salesOrder: { docNo: "SO-26-0001" } },
    include: { lines: { include: { fgItem: true } }, salesOrder: true },
    orderBy: { id: "asc" },
  });
  console.log(JSON.stringify({ so, wos, mrs }, null, 2));
});

