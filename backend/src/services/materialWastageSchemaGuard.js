/**
 * Detect missing MaterialWastageNote table / RM_WASTAGE enum (migration not applied).
 * RM Return must keep working with wastageQty = 0 when this module is unavailable.
 */

function tableHintFromPrismaError(err) {
  const meta = err?.meta && typeof err.meta === "object" ? err.meta : {};
  const tableRaw = typeof meta.table === "string" ? meta.table : "";
  return tableRaw.replace(/^.*\./, "").trim().toLowerCase();
}

function messageHintFromPrismaError(err) {
  const meta = err?.meta && typeof err.meta === "object" ? err.meta : {};
  const driver = typeof meta.message === "string" ? meta.message : "";
  return `${driver} ${String(err?.message || "")}`.toLowerCase();
}

function isMaterialWastageSchemaUnavailable(err) {
  if (!err || typeof err !== "object") return false;
  const code = String(err.code || "");
  const table = tableHintFromPrismaError(err);
  const msg = messageHintFromPrismaError(err);

  if (code === "P2021" && table.includes("materialwastagenote")) return true;
  if (code === "P2010" && msg.includes("materialwastagenote")) return true;
  if (/materialwastagenote/i.test(msg) && /doesn't exist|does not exist|unknown table/i.test(msg)) {
    return true;
  }
  return false;
}

const MIGRATION_GUIDANCE =
  "Apply migration backend/prisma/migrations/20260529140000_material_wastage_note (npx prisma migrate deploy) and run npx prisma generate.";

module.exports = {
  isMaterialWastageSchemaUnavailable,
  MIGRATION_GUIDANCE,
};
