const http = require("http");
const { PrismaClient } = require("@prisma/client");
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

  const dbCount = await prisma.customerReturn.count({ where: { reversedAt: null, status: "IN_QC_HOLD" } });
  const token = signAccessToken({ userId: 1, email: "debug@local", role: "ADMIN", name: "Debug" });

  const apiRes = await httpJson({
    method: "GET",
    port,
    path: "/api/customer-returns/bucket/QC_HOLD?limit=200",
    headers: { Authorization: `Bearer ${token}` },
  });

  console.log(JSON.stringify({ port, dbCountExpectedQcQueue: dbCount, auth: "signed-dev-jwt", apiRes }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

