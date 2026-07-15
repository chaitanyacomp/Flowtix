require("dotenv").config();
const fs = require("fs");
const http = require("http");
const { signAccessToken } = require("../src/utils/jwt");

const token = signAccessToken({
  userId: 1,
  email: "admin@test.com",
  role: "ADMIN",
  name: "Admin",
});
const file = fs.readFileSync(require("path").join(__dirname, "../test/fixtures/tally/Master.xml"));
const boundary = `----tally${Date.now()}`;
const optionsJson = JSON.stringify({
  defaultItemType: "FG",
  duplicateAction: "SKIP",
  fallbackStateId: 1,
});

const head = Buffer.from(
  [
    `--${boundary}`,
    `Content-Disposition: form-data; name="options"`,
    "",
    optionsJson,
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="Master.xml"`,
    "Content-Type: application/xml",
    "",
    "",
  ].join("\r\n"),
  "utf8",
);
const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
const body = Buffer.concat([head, file, tail]);

const req = http.request(
  {
    hostname: "127.0.0.1",
    port: 4000,
    path: "/api/admin/tally-import/preview",
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length,
    },
  },
  (res) => {
    let data = "";
    res.on("data", (c) => {
      data += c;
    });
    res.on("end", () => {
      const j = JSON.parse(data);
      const tata = (j.customers || []).find(
        (c) => String(c.tallyName || c.mapped?.name || "").toUpperCase() === "TATA",
      );
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            status: res.statusCode,
            pipelineId: j.runtime?.pipelineId,
            pid: j.runtime?.pid,
            mapperModule: j.runtime?.mapperModule,
            tata: tata && {
              action: tata.proposedAction,
              status: tata.status,
              gst: tata.mapped?.gst,
              gstin: tata.mapped?.gstin,
              contact: tata.mapped?.contact,
              contactPerson: tata.mapped?.contactPerson,
              phone: tata.mapped?.phone,
              address: tata.mapped?.address,
              state: tata.mapped?.state,
              pincode: tata.mapped?.pincode,
              warnings: tata.warnings,
            },
            partyDiagnostics: j.partyDiagnostics,
          },
          null,
          2,
        ),
      );
    });
  },
);
req.on("error", (e) => {
  console.error(e);
  process.exit(1);
});
req.write(body);
req.end();
