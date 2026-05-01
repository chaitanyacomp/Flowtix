const express = require("express");
const { prisma } = require("../utils/prisma");

const statesRouter = express.Router();

// GET /api/states
// Read-only master list for dropdowns (active only).
statesRouter.get("/", async (req, res) => {
  const rows = await prisma.state.findMany({
    where: { isActive: true },
    orderBy: [{ stateName: "asc" }],
    select: { id: true, stateName: true, stateCode: true, isActive: true },
  });
  res.json(rows);
});

module.exports = { statesRouter };

