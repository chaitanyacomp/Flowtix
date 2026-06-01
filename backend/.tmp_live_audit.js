const { prisma } = require("./src/utils/prisma");

async function main() {
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
          procurementLinks: {
            include: {
              rmPoLine: {
                include: {
                  rmPo: true,
                  grnLines: { include: { grn: true } },
                },
              },
            },
          },
          purchaseRequestSourceLinks: {
            include: {
              purchaseRequestLine: {
                include: {
                  purchaseRequest: true,
                  poLinks: {
                    include: {
                      rmPoLine: {
                        include: {
                          rmPo: true,
                          grnLines: { include: { grn: true } },
                        },
                      },
                    },
                  },
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
    include: {
      lines: { include: { fgItem: true } },
      salesOrder: true,
    },
    orderBy: { id: "asc" },
  });

  const prs = await prisma.purchaseRequest.findMany({
    where: {
      lines: {
        some: {
          sourceLinks: {
            some: {
              materialRequirementLine: {
                materialRequirement: { salesOrder: { docNo: "SO-26-0001" } },
              },
            },
          },
        },
      },
    },
    include: {
      lines: {
        include: {
          sourceLinks: {
            include: {
              materialRequirementLine: {
                include: { materialRequirement: true },
              },
            },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const pos = await prisma.rmPurchaseOrder.findMany({
    where: {
      lines: {
        some: {
          procurementLinks: {
            some: {
              purchaseRequestLine: {
                purchaseRequest: {
                  lines: {
                    some: {
                      sourceLinks: {
                        some: {
                          materialRequirementLine: {
                            materialRequirement: { salesOrder: { docNo: "SO-26-0001" } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    include: {
      lines: {
        include: {
          procurementLinks: {
            include: {
              purchaseRequestLine: {
                include: {
                  purchaseRequest: true,
                  sourceLinks: {
                    include: {
                      materialRequirementLine: {
                        include: { materialRequirement: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      grns: { include: { lines: true } },
    },
    orderBy: { id: "asc" },
  });

  console.log(JSON.stringify({ so, wos, mrs, prs, pos }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
