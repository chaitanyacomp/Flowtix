const http = require("http");
const { PrismaClient } = require("../prisma/generated/client");
const { signAccessToken } = require("../src/utils/jwt");

const prisma = new PrismaClient();

function httpJson({ method, port, path, body, headers }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        hostname: "localhost",
        port,
        path,
        headers: {
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : null),
          ...(headers || {}),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (raw += d));
        res.on("end", () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { _raw: raw };
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  const token = signAccessToken({ userId: 1, email: "debug@local", role: "ADMIN", name: "Debug" });
  const auth = { Authorization: `Bearer ${token}` };

  // Find a returnable dispatch: LOCKED, forward, dispatchedQty > alreadyReturned
  const dispatches = await prisma.dispatch.findMany({
    where: { workflowStatus: "LOCKED", reversalOfId: null },
    orderBy: { id: "desc" },
    take: 50,
    include: { salesOrder: true },
  });
  if (!dispatches.length) throw new Error("No LOCKED dispatch rows found to create a return against.");

  let picked = null;
  for (const d of dispatches) {
    // eslint-disable-next-line no-await-in-loop
    const alreadyReturned = await prisma.customerReturn.aggregate({
      where: { dispatchId: d.id, reversedAt: null },
      _sum: { returnedQty: true },
    });
    const returned = Number(alreadyReturned._sum.returnedQty ?? 0);
    const dispatchedQty = Number(d.dispatchedQty ?? 0);
    const balance = Math.max(0, dispatchedQty - returned);
    if (balance > 1e-6) {
      picked = { dispatchId: d.id, balance };
      break;
    }
  }
  if (!picked) throw new Error("No dispatch rows with returnable balance found.");

  const beforeDb = await prisma.customerReturn.findMany({
    where: { reversedAt: null, status: "IN_QC_HOLD" },
    orderBy: { id: "desc" },
    take: 5,
  });

  const createRes = await httpJson({
    method: "POST",
    port,
    path: "/api/customer-returns",
    headers: auth,
    body: {
      dispatchId: picked.dispatchId,
      returnedQty: 1,
      reason: "QC queue proof",
      disposition: "QC_HOLD",
    },
  });

  const createdId = createRes?.json?.customerReturn?.id;
  const createdRow = createdId
    ? await prisma.customerReturn.findUnique({ where: { id: createdId } })
    : null;

  const qcApiRes = await httpJson({
    method: "GET",
    port,
    path: "/api/customer-returns/bucket/QC_HOLD?limit=200",
    headers: auth,
  });

  const afterDb = await prisma.customerReturn.findMany({
    where: { reversedAt: null, status: "IN_QC_HOLD" },
    orderBy: { id: "desc" },
    take: 5,
  });

  console.log(
    JSON.stringify(
      {
        port,
        pickedDispatch: picked,
        beforeDb_inQcHold_statusCount: beforeDb.length,
        createRes,
        createdRow,
        qcApiResCount: Array.isArray(qcApiRes.json) ? qcApiRes.json.length : null,
        qcApiResFirst: Array.isArray(qcApiRes.json) ? qcApiRes.json[0] : qcApiRes.json,
        afterDb_inQcHold_statusCount: afterDb.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

