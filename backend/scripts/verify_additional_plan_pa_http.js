/**
 * HTTP verify Store Pending Actions Additional Plan for July 2026.
 */
const http = require("http");

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: "127.0.0.1",
        port: 4000,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(d);
          } catch (_) {}
          resolve({ status: res.statusCode, body: d, json });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const login = await req("POST", "/api/auth/login", {
    email: "store@test.com",
    password: "123456",
  });
  const token = login.json?.token;
  if (!token) {
    console.error("login failed", login);
    process.exit(1);
  }

  const [pa, preview] = await Promise.all([
    req("GET", "/api/pending-actions", null, token),
    req("GET", "/api/monthly-planning/periods/2026-07/additional-plan/preview", null, token),
  ]);

  const actions = pa.json?.actions || [];
  const additional = actions.filter((a) =>
    /Additional Monthly Plan|additional-monthly-plan/i.test(`${a.action} ${a.id}`),
  );

  console.log(
    JSON.stringify(
      {
        pendingActionsStatus: pa.status,
        count: pa.json?.count,
        actions: actions.map((a) => ({
          id: a.id,
          action: a.action,
          documentNo: a.documentNo,
          qty: a.qty,
          quantity: a.quantity,
          href: a.href,
          type: a.type,
          metadata: a.metadata,
        })),
        additional,
        preview: {
          status: preview.status,
          canCreate: preview.json?.canCreate,
          nextPlanLabel: preview.json?.nextPlanLabel,
          totals: preview.json?.totals,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
