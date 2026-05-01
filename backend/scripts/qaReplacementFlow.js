const http = require("http");
require("dotenv").config();

const { signAccessToken } = require("../src/utils/jwt");

function reqJson({ method, path, body, token }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: 4000,
        method,
        path,
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
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
    if (body != null) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const token = signAccessToken({ userId: 1, email: "admin@test.com", role: "ADMIN", name: "Admin" });

  const list = await reqJson({ method: "GET", path: "/api/customer-returns", token });
  if (list.status !== 200 || !Array.isArray(list.json)) {
    console.error("listCustomerReturns", list.status, list.json);
    throw new Error(`Failed to list customer returns: ${list.status}`);
  }
  const approved = list.json.find((r) => r && r.status === "APPROVED_TO_STOCK" && !r.reversedAt);
  console.log("pickedApprovedReturn", approved ? { id: approved.id, available: approved.availableForReplacementQty } : null);
  if (!approved) return;

  const rep = await reqJson({
    method: "POST",
    path: `/api/customer-returns/${approved.id}/replacement-order`,
    body: {},
    token,
  });
  console.log("replacementOrderRes", rep.status, rep.json && { created: rep.json.created, soId: rep.json.salesOrderId });
  if (!rep.json || !rep.json.salesOrderId) throw new Error("No salesOrderId returned");

  const soId = rep.json.salesOrderId;
  const so = await reqJson({ method: "GET", path: `/api/sales-orders/${soId}`, token });
  console.log("replacementSO", {
    id: so.json?.id,
    orderType: so.json?.orderType,
    customerReturnId: so.json?.customerReturnId,
    originalSalesOrderId: so.json?.originalSalesOrderId,
    originalDispatchId: so.json?.originalDispatchId,
    lines: Array.isArray(so.json?.lines) ? so.json.lines.map((l) => ({ id: l.id, itemId: l.itemId, qty: l.qty })) : null,
  });

  const lineId = Array.isArray(so.json?.lines) && so.json.lines[0] ? so.json.lines[0].id : null;
  if (!lineId) throw new Error("Replacement SO has no line");

  const over = await reqJson({
    method: "PATCH",
    path: `/api/sales-orders/${soId}/lines`,
    body: { lines: [{ lineId, qty: Number(approved.qty) + 999 }] },
    token,
  });
  console.log("overQtyPatch", over.status, over.json);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

