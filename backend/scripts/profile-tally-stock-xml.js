/**
 * One-off profiler for Stock items.xml — run:
 *   node scripts/profile-tally-stock-xml.js
 */
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

const FILE = process.argv[2] || "C:/Users/saniy/Desktop/Masters/Stock items.xml";

function mem() {
  const m = process.memoryUsage();
  return {
    rssMb: Math.round(m.rss / 1024 / 1024),
    heapUsedMb: Math.round(m.heapUsed / 1024 / 1024),
    externalMb: Math.round(m.external / 1024 / 1024),
  };
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error("Missing file:", FILE);
    process.exit(1);
  }
  const {
    decodeTallyXmlBuffer,
    sanitizeInvalidXml10CharRefs,
    assertCompleteTallyXmlEnvelope,
  } = require("../src/services/tallyMasterImport/tallyXmlDecode");
  const { parseTallyMastersXml } = require("../src/services/tallyMasterImport/parseTallyMastersXml");
  const { mapStockItemToItem } = require("../src/services/tallyMasterImport/mapStockItemToItem");

  console.log("File:", FILE);
  console.log("Size bytes:", fs.statSync(FILE).size);
  console.log("mem start", mem());

  const t0 = performance.now();
  const buf = fs.readFileSync(FILE);
  const tRead = performance.now();
  console.log("read_ms", Math.round(tRead - t0), mem());

  const decoded = decodeTallyXmlBuffer(buf);
  const tDecode = performance.now();
  console.log("decode_ms", Math.round(tDecode - tRead), "encoding", decoded.encoding, "chars", decoded.text.length, mem());

  const complete = assertCompleteTallyXmlEnvelope(decoded.text);
  const tEnv = performance.now();
  console.log("envelope_ms", Math.round(tEnv - tDecode), "ok", complete.ok);

  const sanitized = sanitizeInvalidXml10CharRefs(decoded.text);
  const tSan = performance.now();
  console.log(
    "sanitize_ms",
    Math.round(tSan - tEnv),
    "invalidRefs",
    sanitized.sanitizedInvalidRefCount,
    mem(),
  );

  // Drop original decoded string reference if different (sanitize may keep same if no change)
  // Force GC opportunity
  if (global.gc) global.gc();

  // Event-loop responsiveness probe during parse
  let ticks = 0;
  const probe = setInterval(() => {
    ticks += 1;
  }, 50);

  const tParse0 = performance.now();
  const parsed = parseTallyMastersXml(sanitized.text, {
    encoding: decoded.encoding,
    sanitizedInvalidRefCount: sanitized.sanitizedInvalidRefCount,
    byteLength: decoded.byteLength,
  });
  const tParse1 = performance.now();
  clearInterval(probe);
  console.log(
    "parse_ms",
    Math.round(tParse1 - tParse0),
    "ok",
    parsed.ok,
    "stockItems",
    parsed.stockItems?.length,
    "eventLoopTicks@50ms",
    ticks,
    "expectedTicks~",
    Math.round((tParse1 - tParse0) / 50),
    mem(),
  );

  const items = parsed.stockItems || [];
  const tMap0 = performance.now();
  let mapped = 0;
  for (const raw of items) {
    mapStockItemToItem(raw, {});
    mapped += 1;
  }
  const tMap1 = performance.now();
  console.log("map_once_ms", Math.round(tMap1 - tMap0), "mapped", mapped, mem());

  const tMap2 = performance.now();
  for (const raw of items) {
    mapStockItemToItem(raw, {});
  }
  const tMap3 = performance.now();
  console.log("map_twice_extra_ms", Math.round(tMap3 - tMap2), mem());

  console.log("TOTAL_ms", Math.round(tMap3 - t0));
  console.log(
    JSON.stringify(
      {
        read_ms: Math.round(tRead - t0),
        decode_ms: Math.round(tDecode - tRead),
        sanitize_ms: Math.round(tSan - tEnv),
        parse_ms: Math.round(tParse1 - tParse0),
        map_once_ms: Math.round(tMap1 - tMap0),
        eventLoopBlocked: ticks < Math.max(1, Math.round((tParse1 - tParse0) / 50) * 0.2),
        ticks,
        stockItems: items.length,
        peakApprox: mem(),
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
