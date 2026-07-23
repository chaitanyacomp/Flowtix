/**
 * Run Tally XML prepare+parse in a Worker Thread so Express polling stays responsive.
 */
const { Worker } = require("worker_threads");
const path = require("path");

const WORKER_PATH = path.join(__dirname, "tallyXmlParseWorker.js");

/**
 * @param {Buffer} buffer
 * @param {{ onProgress?: (p: Record<string, unknown>) => void }} [opts]
 */
function prepareAndParseTallyXmlInWorker(buffer, opts = {}) {
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;

  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH);
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    worker.on("message", (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "progress") {
        onProgress?.(msg);
        return;
      }
      if (msg.type === "error") {
        const err = new Error(msg.message || "Tally XML worker failed.");
        err.code = msg.code || "TALLY_XML_WORKER";
        err.statusCode = 400;
        fail(err);
        return;
      }
      if (msg.type === "result" && msg.ok) {
        if (settled) return;
        settled = true;
        worker.terminate().catch(() => {});
        resolve({
          text: msg.text,
          decodeMeta: msg.decodeMeta,
          parsed: msg.parsed,
        });
      }
    });

    worker.on("error", (err) => fail(err));
    worker.on("exit", (code) => {
      if (!settled && code !== 0) {
        fail(new Error(`Tally XML worker exited with code ${code}.`));
      }
    });

    // Structured-clone the upload bytes (keeps multer buffer usable; avoids detach races).
    worker.postMessage({
      type: "run",
      buffer: Buffer.from(buffer),
    });
  });
}

module.exports = {
  prepareAndParseTallyXmlInWorker,
  WORKER_PATH,
};
