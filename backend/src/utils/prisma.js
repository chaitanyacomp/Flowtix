const { PrismaClient } = require("../prismaClientPackage");
const { incrementPrismaQueryCount } = require("./prismaQueryMetrics");

const prisma = new PrismaClient();

prisma.$use(async (params, next) => {
  incrementPrismaQueryCount();
  return next(params);
});

module.exports = { prisma };

