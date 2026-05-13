const { PrismaClient } = require("../prismaClientPackage");

const prisma = new PrismaClient();

module.exports = { prisma };

