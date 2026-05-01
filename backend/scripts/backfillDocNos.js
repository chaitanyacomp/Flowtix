/**
 * One-time backfill for missing transaction docNo values (PREFIX-YY-####).
 *
 * Usage:
 *   node scripts/backfillDocNos.js              # dry-run (default)
 *   node scripts/backfillDocNos.js --apply      # write changes + update DocSequence
 *
 * Requires DATABASE_URL (see backend .env).
 *
 * Dry-run / pre-apply: prints warnings for non-canonical docNo, duplicate docNo per table,
 * and backfill rows with missing/invalid source dates. --apply aborts before writes if
 * duplicate docNo values exist in any scoped table.
 *
 * --apply: rows with missing/invalid source date are skipped (not assigned using today's year).
 *   Dry-run still previews those rows with YY from "today" for planning visibility only.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { PrismaClient } = require("@prisma/client");
const { formatDocNo, year2FromDate } = require("../src/services/docNoService");

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");

/** Max examples printed per warning category per table (dry-run). */
const MAX_WARN_EXAMPLES = 10;

/** Must match Prisma `DocType` enum and docNoService.prefixForDocType. */
const DOC_TYPE = {
  SALES_ORDER: "SALES_ORDER",
  REQUIREMENT_SHEET: "REQUIREMENT_SHEET",
  WORK_ORDER: "WORK_ORDER",
  PRODUCTION_ENTRY: "PRODUCTION_ENTRY",
  QC_ENTRY: "QC_ENTRY",
  DISPATCH: "DISPATCH",
  SALES_BILL: "SALES_BILL",
};

/** @type {Record<string, string>} */
const PREFIX_BY_DOC_TYPE = {
  [DOC_TYPE.SALES_ORDER]: "SO",
  [DOC_TYPE.REQUIREMENT_SHEET]: "RS",
  [DOC_TYPE.WORK_ORDER]: "WO",
  [DOC_TYPE.PRODUCTION_ENTRY]: "PE",
  [DOC_TYPE.QC_ENTRY]: "QC",
  [DOC_TYPE.DISPATCH]: "D",
  [DOC_TYPE.SALES_BILL]: "SB",
};

function prefixForDocType(docType) {
  return PREFIX_BY_DOC_TYPE[docType] ?? "DOC";
}

/**
 * Canonical display form: PREFIX-YY-#### (same as docNoService / new records).
 * @param {string} prefix
 */
function expectedDocNoPatternRegex(prefix) {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc}-(\\d{2})-(\\d{4})$`);
}

/**
 * @param {string} prefix
 * @param {string | null | undefined} docNo
 */
function matchesExpectedDocNoPattern(prefix, docNo) {
  const s = docNo != null ? String(docNo).trim() : "";
  if (!s) return false;
  return expectedDocNoPatternRegex(prefix).test(s);
}

/**
 * @param {ModelConfig} cfg
 * @param {unknown} row
 * @returns {{ invalid: boolean; raw: string }}
 */
function sourceDateValidity(cfg, row) {
  const v = cfg.dateAccessor(row);
  if (v == null || v === "") {
    return { invalid: true, raw: String(v) };
  }
  const t = new Date(/** @type {any} */ (v)).getTime();
  if (!Number.isFinite(t)) {
    return { invalid: true, raw: String(v) };
  }
  return { invalid: false, raw: String(v) };
}

/** @typedef {{ name: keyof import('@prisma/client').PrismaClient; docType: string; dateAccessor: (row: any) => Date | string | null | undefined; label: string }} ModelConfig */

/** @type {ModelConfig[]} */
const MODELS = [
  { name: "salesOrder", docType: DOC_TYPE.SALES_ORDER, dateAccessor: (r) => r.createdAt, label: "SalesOrder" },
  { name: "requirementSheet", docType: DOC_TYPE.REQUIREMENT_SHEET, dateAccessor: (r) => r.createdAt, label: "RequirementSheet" },
  { name: "workOrder", docType: DOC_TYPE.WORK_ORDER, dateAccessor: (r) => r.createdAt, label: "WorkOrder" },
  { name: "productionEntry", docType: DOC_TYPE.PRODUCTION_ENTRY, dateAccessor: (r) => r.date, label: "ProductionEntry" },
  { name: "qcEntry", docType: DOC_TYPE.QC_ENTRY, dateAccessor: (r) => r.date, label: "QcEntry" },
  { name: "dispatch", docType: DOC_TYPE.DISPATCH, dateAccessor: (r) => r.date, label: "Dispatch" },
  { name: "salesBill", docType: DOC_TYPE.SALES_BILL, dateAccessor: (r) => r.billDate, label: "SalesBill" },
];

/**
 * Parse max running number per year2 from existing docNo strings for this prefix.
 * Ignores non-matching / malformed values.
 */
function maxRunningByYearFromStrings(prefix, docNoStrings) {
  /** @type {Map<number, number>} */
  const map = new Map();
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${esc}-(\\d{2})-(\\d{4})$`);
  for (const raw of docNoStrings) {
    const s = raw && String(raw).trim();
    if (!s) continue;
    const m = s.match(re);
    if (!m) continue;
    const yy = Number(m[1]);
    const run = Number(m[2]);
    if (!Number.isFinite(yy) || !Number.isFinite(run)) continue;
    map.set(yy, Math.max(map.get(yy) ?? 0, run));
  }
  return map;
}

/**
 * Existing rows with non-empty docNo (for pattern + duplicate analysis).
 * @param {import('@prisma/client').PrismaClient} db
 * @param {ModelConfig} cfg
 */
async function loadExistingIdAndDocNo(db, cfg) {
  const delegate = db[cfg.name];
  return delegate.findMany({
    where: {
      AND: [{ docNo: { not: null } }, { NOT: { docNo: "" } }],
    },
    select: { id: true, docNo: true },
    orderBy: { id: "asc" },
  });
}

/**
 * @param {{ id: number; docNo: string | null }[]} rows
 * @param {string} prefix
 * @returns {{ malformed: { id: number; docNo: string }[]; malformedCount: number; duplicateGroups: { docNo: string; ids: number[] }[]; duplicateValueCount: number }}
 */
function analyzeExistingDocNoQuality(rows, prefix) {
  const malformed = [];
  for (const r of rows) {
    const s = r.docNo != null ? String(r.docNo).trim() : "";
    if (!s) continue;
    if (!matchesExpectedDocNoPattern(prefix, s)) {
      malformed.push({ id: r.id, docNo: s });
    }
  }

  /** @type {Map<string, number[]>} */
  const byValue = new Map();
  for (const r of rows) {
    const s = r.docNo != null ? String(r.docNo).trim() : "";
    if (!s) continue;
    if (!byValue.has(s)) byValue.set(s, []);
    byValue.get(s).push(r.id);
  }
  const duplicateGroups = [...byValue.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([docNo, ids]) => ({ docNo, ids: [...ids].sort((a, b) => a - b) }));

  return {
    malformed,
    malformedCount: malformed.length,
    duplicateGroups,
    duplicateValueCount: duplicateGroups.length,
  };
}

/**
 * @param {ModelConfig} cfg
 * @param {any[]} missingRows
 * @returns {{ valid: any[]; invalid: { id: number; raw: string }[] }}
 */
function partitionMissingByValidSourceDate(cfg, missingRows) {
  const valid = [];
  /** @type {{ id: number; raw: string }[]} */
  const invalid = [];
  for (const row of missingRows) {
    const { invalid: inv, raw } = sourceDateValidity(cfg, row);
    if (inv) invalid.push({ id: row.id, raw });
    else valid.push(row);
  }
  return { valid, invalid };
}

/**
 * @param {import('@prisma/client').PrismaClient} db
 * @param {ModelConfig} cfg
 */
async function loadMissingRows(db, cfg) {
  const delegate = db[cfg.name];
  return delegate.findMany({
    where: {
      OR: [{ docNo: null }, { docNo: "" }],
    },
    orderBy: [{ id: "asc" }],
  });
}

function sortRowsByDateThenId(cfg, rows) {
  const withKey = rows.map((r) => {
    const d = cfg.dateAccessor(r);
    const t = d ? new Date(d).getTime() : 0;
    return { row: r, t: Number.isFinite(t) ? t : 0, id: r.id };
  });
  withKey.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t;
    return a.id - b.id;
  });
  return withKey.map((x) => x.row);
}

/**
 * Build assignments for one model. Does not mutate DB.
 * @returns {{ id: number; docNo: string; year2: number }[]}
 */
function buildAssignmentsForModel(cfg, missingRows, maxByYear) {
  const prefix = prefixForDocType(cfg.docType);
  /** @type {Map<number, number>} — mutable copy */
  const cursor = new Map(maxByYear);
  const sorted = sortRowsByDateThenId(cfg, missingRows);
  /** @type { { id: number; docNo: string; year2: number }[] } */
  const out = [];

  for (const row of sorted) {
    const d = cfg.dateAccessor(row);
    const dt = d ? new Date(d) : new Date();
    const year2 = year2FromDate(dt);
    const nextRun = (cursor.get(year2) ?? 0) + 1;
    cursor.set(year2, nextRun);
    const docNo = formatDocNo(prefix, year2, nextRun);
    out.push({ id: row.id, docNo, year2 });
  }
  return out;
}

function assertNoDuplicateDocNos(label, assignments, existingSet) {
  const seen = new Set(existingSet);
  for (const a of assignments) {
    if (seen.has(a.docNo)) {
      throw new Error(`${label}: proposed docNo ${a.docNo} already exists or is duplicated in batch.`);
    }
    seen.add(a.docNo);
  }
}

/**
 * @param {import('@prisma/client').PrismaClient} tx
 */
async function applyAssignments(tx, cfg, assignments) {
  const delegate = tx[cfg.name];
  for (const a of assignments) {
    await delegate.update({
      where: { id: a.id },
      data: { docNo: a.docNo },
    });
  }
}

/**
 * After backfill, next running number for (docType, year2) is maxRun+1.
 * DocSequence.nextNumber must be maxRun+1 so the next allocateDocNo produces maxRun+1 as running (see docNoService).
 * @param {import('@prisma/client').PrismaClient} tx
 */
async function syncDocSequences(tx) {
  for (const cfg of MODELS) {
    const prefix = prefixForDocType(cfg.docType);
    const rows = await tx[cfg.name].findMany({
      where: {
        AND: [{ docNo: { not: null } }, { NOT: { docNo: "" } }],
      },
      select: { docNo: true },
    });
    const strings = rows.map((r) => r.docNo).filter((s) => s && String(s).trim() !== "");
    const maxByYear = maxRunningByYearFromStrings(prefix, strings);

    for (const [year2, maxRun] of maxByYear.entries()) {
      const neededNext = maxRun + 1;
      const existing = await tx.docSequence.findUnique({
        where: { docType_year2: { docType: cfg.docType, year2 } },
      });
      const nextNumber = Math.max(existing?.nextNumber ?? 0, neededNext);
      await tx.docSequence.upsert({
        where: { docType_year2: { docType: cfg.docType, year2 } },
        create: { docType: cfg.docType, year2, nextNumber },
        update: { nextNumber },
      });
    }
  }
}

/**
 * Ensures migrations adding `docNo` were applied (MySQL).
 * @param {import('@prisma/client').PrismaClient} db
 */
async function assertDocNoColumnsInDatabase(db) {
  const rows = await db.$queryRaw`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'SalesOrder'
      AND COLUMN_NAME = 'docNo'
  `;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      "Database column SalesOrder.docNo not found. Apply Prisma migrations first: npx prisma migrate deploy",
    );
  }
}

async function countTotals() {
  let checked = 0;
  let missing = 0;
  for (const cfg of MODELS) {
    const total = await prisma[cfg.name].count();
    const miss = await prisma[cfg.name].count({
      where: { OR: [{ docNo: null }, { docNo: "" }] },
    });
    checked += total;
    missing += miss;
  }
  return { checked, missing };
}

/**
 * @param {string} label
 * @param {{ malformed: { id: number; docNo: string }[]; malformedCount: number; duplicateGroups: { docNo: string; ids: number[] }[]; duplicateValueCount: number }} quality
 * @param {{ id: number; raw: string }[]} invalidDates
 * @param {string} dateHint
 */
function printTableWarnings(label, quality, invalidDates, dateHint) {
  const hasAny =
    quality.malformedCount > 0 || quality.duplicateValueCount > 0 || invalidDates.length > 0;
  if (!hasAny) {
    console.log(`  ${label}: (no data-quality warnings)`);
    return;
  }

  console.log(`  ${label}:`);

  if (quality.malformedCount > 0) {
    console.log(
      `    [non-canonical docNo] ${quality.malformedCount} row(s) do not match expected PREFIX-YY-#### for this table (they are ignored when computing the next sequence from existing values).`,
    );
    console.log(`      Examples (up to ${MAX_WARN_EXAMPLES}):`);
    for (const ex of quality.malformed.slice(0, MAX_WARN_EXAMPLES)) {
      console.log(`        id ${ex.id}: "${ex.docNo}"`);
    }
  }

  if (quality.duplicateValueCount > 0) {
    console.log(
      `    [duplicate docNo] ${quality.duplicateValueCount} distinct docNo value(s) appear on more than one row.`,
    );
    console.log(`      Examples (up to ${MAX_WARN_EXAMPLES}):`);
    for (const g of quality.duplicateGroups.slice(0, MAX_WARN_EXAMPLES)) {
      console.log(`        "${g.docNo}" → row ids: ${g.ids.join(", ")}`);
    }
  }

  if (invalidDates.length > 0) {
    console.log(
      APPLY
        ? `    [invalid/missing source date] ${invalidDates.length} backfill row(s) have null/invalid ${dateHint}; --apply will skip these (no docNo assigned). Dry-run preview above still shows hypothetical docNo using current year for planning.`
        : `    [invalid/missing source date] ${invalidDates.length} backfill row(s) have null/invalid ${dateHint}; dry-run preview uses current date for YY. With --apply, these rows would be skipped (not assigned today's year).`,
    );
    console.log(`      Examples (up to ${MAX_WARN_EXAMPLES}):`);
    for (const ex of invalidDates.slice(0, MAX_WARN_EXAMPLES)) {
      console.log(`        id ${ex.id}: source=${ex.raw === "" ? "(empty)" : ex.raw}`);
    }
  }
}

/**
 * @param {{ label: string; duplicateGroups: { docNo: string; ids: number[] }[]; duplicateValueCount: number }[]} problems
 */
function throwIfDuplicateDocNosForApply(problems) {
  if (problems.length === 0) return;
  const lines = [
    "Apply aborted: duplicate non-empty docNo values exist in at least one table.",
    "Fix duplicates in the database before running with --apply.",
    "",
  ];
  for (const p of problems) {
    lines.push(`${p.label}: ${p.duplicateValueCount} duplicate docNo value(s). Examples:`);
    for (const g of p.duplicateGroups.slice(0, MAX_WARN_EXAMPLES)) {
      lines.push(`  "${g.docNo}" → ids: ${g.ids.join(", ")}`);
    }
    lines.push("");
  }
  throw new Error(lines.join("\n"));
}

function dateFieldHintFor(cfg) {
  if (cfg.name === "salesOrder" || cfg.name === "requirementSheet" || cfg.name === "workOrder") return "createdAt";
  if (cfg.name === "salesBill") return "billDate";
  return "date";
}

async function verifyNoNullDocNos() {
  /** @type {Record<string, number>} */
  const stillNull = {};
  for (const cfg of MODELS) {
    const n = await prisma[cfg.name].count({
      where: { OR: [{ docNo: null }, { docNo: "" }] },
    });
    if (n > 0) stillNull[cfg.label] = n;
  }
  return stillNull;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}\n`);

  await assertDocNoColumnsInDatabase(prisma);

  let totals;
  try {
    totals = await countTotals();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("docNo") || msg.includes("Unknown argument")) {
      console.error(
        "Prisma Client may be out of date (no docNo on models). Run: npx prisma generate\n" +
          "Then ensure migrations are applied: npx prisma migrate deploy\n",
      );
    }
    throw e;
  }
  console.log("Overview (all scoped tables):");
  console.log(`  Total records checked (sum of row counts): ${totals.checked}`);
  console.log(`  Total records needing backfill (docNo null/empty): ${totals.missing}`);
  console.log("");

  /** @type { { label: string; existingNonNull: number; missingBefore: number; assignedPreview: number; applyWrite: number; applySkippedInvalidDate: number; sample: { id: number; before: string; after: string }[]; sampleApply: { id: number; docNo: string }[] }[] } */
  const report = [];

  /** @type { Map<string, { id: number; docNo: string }[]> } */
  const allAssignmentsByLabel = new Map();

  let totalSkippedInvalidSourceDate = 0;

  /** @type { { label: string; quality: ReturnType<typeof analyzeExistingDocNoQuality>; invalidDates: { id: number; raw: string }[]; dateHint: string }[] } */
  const warningRows = [];

  /** @type { { label: string; duplicateGroups: { docNo: string; ids: number[] }[]; duplicateValueCount: number }[] } */
  const duplicateApplyProblems = [];

  for (const cfg of MODELS) {
    const prefix = prefixForDocType(cfg.docType);
    const existingRows = await loadExistingIdAndDocNo(prisma, cfg);
    const existingStrings = existingRows
      .map((r) => r.docNo)
      .filter((s) => s != null && String(s).trim() !== "");
    const quality = analyzeExistingDocNoQuality(existingRows, prefix);
    if (quality.duplicateValueCount > 0) {
      duplicateApplyProblems.push({
        label: cfg.label,
        duplicateGroups: quality.duplicateGroups,
        duplicateValueCount: quality.duplicateValueCount,
      });
    }

    const maxByYear = maxRunningByYearFromStrings(prefix, existingStrings);
    const missingRows = await loadMissingRows(prisma, cfg);
    const { valid: validMissing, invalid: invalidDates } = partitionMissingByValidSourceDate(cfg, missingRows);
    totalSkippedInvalidSourceDate += invalidDates.length;

    warningRows.push({ label: cfg.label, quality, invalidDates, dateHint: dateFieldHintFor(cfg) });

    const assignmentsPreview = buildAssignmentsForModel(cfg, missingRows, maxByYear);
    const assignmentsApply = buildAssignmentsForModel(cfg, validMissing, maxByYear);

    const existingSet = new Set(existingStrings.map((s) => String(s).trim()).filter(Boolean));
    assertNoDuplicateDocNos(cfg.label, assignmentsPreview, existingSet);
    if (APPLY) {
      assertNoDuplicateDocNos(`${cfg.label} (apply)`, assignmentsApply, existingSet);
    }

    const sample = assignmentsPreview.slice(0, 5).map((a) => ({
      id: a.id,
      before: "(null or empty)",
      after: a.docNo,
    }));

    report.push({
      label: cfg.label,
      existingNonNull: existingStrings.length,
      missingBefore: missingRows.length,
      assignedPreview: assignmentsPreview.length,
      applyWrite: assignmentsApply.length,
      applySkippedInvalidDate: invalidDates.length,
      sample,
      sampleApply: APPLY
        ? assignmentsApply.slice(0, 5).map((a) => ({ id: a.id, docNo: a.docNo }))
        : [],
    });
    allAssignmentsByLabel.set(
      cfg.label,
      (APPLY ? assignmentsApply : assignmentsPreview).map((a) => ({ id: a.id, docNo: a.docNo })),
    );
  }

  console.log("Per-table summary:");
  for (const r of report) {
    console.log(`  ${r.label}:`);
    console.log(`    existing with docNo: ${r.existingNonNull}`);
    console.log(`    needing backfill:   ${r.missingBefore}`);
    console.log(`    assignments (preview, all missing rows): ${r.assignedPreview}`);
    if (APPLY) {
      console.log(`    apply will write: ${r.applyWrite} row(s)`);
      console.log(`    apply will skip (invalid/missing source date): ${r.applySkippedInvalidDate} row(s)`);
    }
    if (r.sample.length) {
      console.log(`    sample preview (id → docNo, includes invalid-date rows in sequence):`);
      for (const s of r.sample) {
        console.log(`      ${s.id}: ${s.before} → ${s.after}`);
      }
    }
    if (APPLY && r.sampleApply.length) {
      console.log(`    sample apply (id → docNo, valid source date only — used for writes):`);
      for (const s of r.sampleApply) {
        console.log(`      ${s.id}: ${s.docNo}`);
      }
    }
    console.log("");
  }

  console.log("=== Data quality warnings ===");
  console.log(
    APPLY
      ? "Note: if any table lists [duplicate docNo], apply will abort after this section (no writes)."
      : "(Advisory — dry-run does not modify the database. Duplicates would block --apply.)\n",
  );
  for (const w of warningRows) {
    printTableWarnings(w.label, w.quality, w.invalidDates, w.dateHint);
    console.log("");
  }

  if (!APPLY) {
    console.log("Dry-run complete. Re-run with --apply to write changes.");
    return;
  }

  throwIfDuplicateDocNosForApply(duplicateApplyProblems);

  await prisma.$transaction(
    async (tx) => {
      for (const cfg of MODELS) {
        const assignments = allAssignmentsByLabel.get(cfg.label) ?? [];
        if (assignments.length) {
          await applyAssignments(tx, cfg, assignments);
        }
      }
      await syncDocSequences(tx);
    },
    { maxWait: 60_000, timeout: 600_000 },
  );

  console.log("Apply complete.\n");

  const totalBackfilled = report.reduce((s, r) => s + r.applyWrite, 0);
  const stillByTable = await verifyNoNullDocNos();
  const totalStillMissing = Object.values(stillByTable).reduce((a, b) => a + b, 0);

  console.log("=== Apply summary ===");
  console.log(`Rows backfilled: ${totalBackfilled}`);
  console.log(`Rows skipped (invalid/missing source date): ${totalSkippedInvalidSourceDate}`);
  console.log(`Rows still missing docNo: ${totalStillMissing}`);
  if (totalStillMissing > 0) {
    console.log("  Per table (still null/empty):");
    for (const [k, v] of Object.entries(stillByTable)) {
      console.log(`    ${k}: ${v}`);
    }
  }
  if (totalSkippedInvalidSourceDate !== totalStillMissing) {
    console.log(
      "\nNote: skipped-invalid and still-missing counts differ if other processes changed data, or if some rows were not in the backfill scope.",
    );
  }

  console.log("\nNext steps: fix source dates for skipped rows and re-run, or assign docNo manually. Spot-check GET APIs and UI lists.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
