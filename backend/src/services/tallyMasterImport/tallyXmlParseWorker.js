/**
 * Worker thread entry: decode + sanitize + parse Tally masters off the Express event loop.
 * Messages:
 *   parent → { type: "run", buffer: ArrayBuffer|Buffer, byteOffset?, byteLength? }
 *   worker → { type: "progress", ... } | { type: "result", ok, ... } | { type: "error", message, code? }
 */
const { parentPort, workerData } = require("worker_threads");
const { prepareTallyMasterXmlFromBuffer } = require("./tallyXmlDecode");
const { parseTallyMastersXml } = require("./parseTallyMastersXml");

function post(msg) {
  parentPort.postMessage(msg);
}

function bufferFromMessage(msg) {
  if (Buffer.isBuffer(msg.buffer)) return msg.buffer;
  if (msg.buffer instanceof ArrayBuffer) {
    return Buffer.from(msg.buffer, msg.byteOffset || 0, msg.byteLength || msg.buffer.byteLength);
  }
  if (msg.buffer instanceof Uint8Array) {
    return Buffer.from(msg.buffer.buffer, msg.buffer.byteOffset, msg.buffer.byteLength);
  }
  if (msg.buffer && msg.buffer.type === "Buffer" && Array.isArray(msg.buffer.data)) {
    return Buffer.from(msg.buffer.data);
  }
  throw new Error("Worker expected a Buffer/ArrayBuffer upload payload.");
}

async function run(msg) {
  const buf = bufferFromMessage(msg);
  post({
    type: "progress",
    phase: "decoding",
    percent: 8,
    message: "Decoding XML (UTF-16 / UTF-8)…",
    bytesTotal: buf.length,
    bytesDecoded: 0,
  });

  let prepared;
  try {
    prepared = prepareTallyMasterXmlFromBuffer(buf);
  } catch (e) {
    post({
      type: "error",
      message: e instanceof Error ? e.message : String(e),
      code: e?.code || "TALLY_XML_DECODE",
    });
    return;
  }

  post({
    type: "progress",
    phase: "decoding",
    percent: 18,
    message: `Decoded ${prepared.encoding}; sanitized ${prepared.sanitizedInvalidRefCount.toLocaleString("en-IN")} invalid reference(s)…`,
    bytesTotal: prepared.byteLength,
    bytesDecoded: prepared.byteLength,
    sanitizedInvalidRefCount: prepared.sanitizedInvalidRefCount,
    encoding: prepared.encoding,
  });

  const decodeMeta = {
    encoding: prepared.encoding,
    sanitizedInvalidRefCount: prepared.sanitizedInvalidRefCount,
    byteLength: prepared.byteLength,
  };

  const parsed = parseTallyMastersXml(prepared.text, decodeMeta, {
    onProgress: (p) => {
      post({ type: "progress", ...p });
    },
  });

  if (!parsed.ok) {
    post({ type: "error", message: parsed.error || "Invalid XML.", code: "XML_PARSE" });
    return;
  }

  post({
    type: "result",
    ok: true,
    text: prepared.text,
    decodeMeta,
    parsed: {
      ok: true,
      ledgers: parsed.ledgers,
      stockItems: parsed.stockItems,
      units: parsed.units,
      stockGroups: parsed.stockGroups,
      godowns: parsed.godowns,
      voucherTypes: parsed.voucherTypes,
      warnings: parsed.warnings,
      parseStats: parsed.parseStats,
    },
  });
}

if (workerData && workerData.autorun) {
  run(workerData).catch((e) => {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  });
} else {
  parentPort.on("message", (msg) => {
    if (!msg || msg.type !== "run") return;
    run(msg).catch((e) => {
      post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    });
  });
}
