/**
 * After-fix benchmark: streaming parse + worker vs historical DOM.
 * Run: node scripts/profile-tally-stock-xml-after.js
 */
const fs = require("fs");
const { performance } = require("perf_hooks");
const { prepareAndParseTallyXmlInWorker } = require("../src/services/tallyMasterImport/tallyXmlParseWorkerHost");
const { prepareTallyMasterXmlFromBuffer } = require("../src/services/tallyMasterImport/tallyXmlDecode");
const { parseTallyMastersXml } = require("../src/services/tallyMasterImport/parseTallyMastersXml");

const FILE = process.argv[2] || "C:/Users/saniy/Desktop/Masters/Stock items.xml";

function mem() {
  const m = process.memoryUsage();
  return {
    rssMb: Math.round(m.rss / 1024 / 1024),
    heapUsedMb: Math.round(m.heapUsed / 1024 / 1024),
  };
}

async function main() {
  const buf = fs.readFileSync(FILE);
  console.log("file_bytes", buf.length, "mem", mem());

  // Event-loop probe during worker parse
  let ticks = 0;
  const probe = setInterval(() => {
    ticks += 1;
  }, 50);

  const progresses = [];
  const t0 = performance.now();
  const result = await prepareAndParseTallyXmlInWorker(buf, {
    onProgress: (p) => {
      progresses.push({ ...p, t: Math.round(performance.now() - t0) });
    },
  });
  const t1 = performance.now();
  clearInterval(probe);

  console.log("worker_total_ms", Math.round(t1 - t0));
  console.log("stockItems", result.parsed.stockItems.length);
  console.log("parseMode", result.parsed.parseStats?.parseMode);
  console.log("eventLoopTicks@50ms", ticks, "expected~", Math.round((t1 - t0) / 50));
  console.log("progress_samples", progresses.length);
  console.log(
    "last_progress",
    progresses[progresses.length - 1] && {
      percent: progresses[progresses.length - 1].percent,
      processed: progresses[progresses.length - 1].recordsProcessed,
      total: progresses[progresses.length - 1].recordsDetected,
      message: progresses[progresses.length - 1].message,
    },
  );
  console.log("mem_after_worker", mem());

  // Sync streaming path timing (main thread)
  const t2 = performance.now();
  const prepared = prepareTallyMasterXmlFromBuffer(buf);
  const parsed = parseTallyMastersXml(prepared.text, {
    encoding: prepared.encoding,
    sanitizedInvalidRefCount: prepared.sanitizedInvalidRefCount,
    byteLength: prepared.byteLength,
  });
  const t3 = performance.now();
  console.log("sync_streaming_ms", Math.round(t3 - t2), "stock", parsed.ok ? parsed.stockItems.length : 0);
  console.log("mem_after_sync", mem());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
