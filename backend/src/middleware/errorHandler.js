const { Prisma } = require("../prismaClientPackage");
const { ZodError } = require("zod");

/**
 * Maps Prisma known request errors to business-friendly messages (no raw SQL / meta leakage).
 * @param {import('@prisma/client/runtime/library').PrismaClientKnownRequestError} err
 */
function mapPrismaKnownRequest(err) {
  const code = err.code;
  if (typeof code !== "string" || !/^P\d{4}$/.test(code)) return null;

  switch (code) {
    case "P2011": {
      const meta = err.meta && typeof err.meta === "object" ? err.meta : {};
      const constraint = Array.isArray(meta.constraint) ? meta.constraint.filter((x) => typeof x === "string") : [];
      const cols = constraint.length ? constraint.join(", ") : null;
      return {
        status: 500,
        message: cols
          ? `Database schema is out of date (a required column is NULL: ${cols}). Apply Prisma migrations and regenerate the Prisma client.`
          : "Database schema is out of date (a required column is NULL). Apply Prisma migrations and regenerate the Prisma client.",
        code: "SCHEMA_MISMATCH",
      };
    }
    case "P2002":
      return {
        status: 409,
        message: "A record with this value already exists.",
        code: "DUPLICATE",
      };
    case "P2003":
      return {
        status: 409,
        message: "This record is linked to other data and cannot be deleted or updated as requested.",
        code: "FOREIGN_KEY",
      };
    case "P2025":
      return {
        status: 404,
        message: "Record not found.",
        code: "NOT_FOUND",
      };
    case "P2022": {
      const meta = err.meta && typeof err.meta === "object" ? err.meta : {};
      const col = typeof meta.column === "string" ? meta.column : null;
      return {
        status: 500,
        message: col
          ? `Database schema is out of date (missing column: ${col}). Run Prisma migrations on the server database (e.g. npx prisma migrate deploy).`
          : "Database schema is out of date. Run Prisma migrations on the server database (e.g. npx prisma migrate deploy).",
        code: "SCHEMA_MISMATCH",
      };
    }
    case "P2021": {
      const meta = err.meta && typeof err.meta === "object" ? err.meta : {};
      const tableRaw = typeof meta.table === "string" ? meta.table : "";
      const tableHint = tableRaw.replace(/^.*\./, "").trim();
      const lower = tableHint.toLowerCase();
      let message;
      if (lower.includes("materialwastagenote")) {
        message =
          "RM Wastage is not installed on this database. Apply migration 20260529140000_material_wastage_note (npx prisma migrate deploy), then npx prisma generate.";
      } else if (lower.includes("purchasebill")) {
        message =
          "Production planning setup is incomplete. Please contact administrator or apply the latest system update.";
      } else {
        message = `Database table is missing (${tableHint || "unknown"}). Apply Prisma migrations on the server (npx prisma migrate deploy).`;
      }
      return {
        status: 503,
        message,
        code: "MISSING_TABLE",
        details: tableHint
          ? {
              adminOnly: true,
              table: tableHint,
              guidance: "Apply the latest Prisma migration bundle on the server.",
            }
          : undefined,
      };
    }
    /** Raw SQL / driver failure (e.g. MySQL 1146 table missing) — meta.message has the engine text. */
    case "P2010": {
      const meta = err.meta && typeof err.meta === "object" ? err.meta : {};
      const driverMsg = typeof meta.message === "string" ? meta.message.trim() : "";
      return {
        status: 503,
        message:
          driverMsg ||
          "A database query failed. This usually means the schema is out of date (run Prisma migrations).",
        code: "RAW_QUERY_FAILED",
      };
    }
    default:
      return {
        status: 400,
        message:
          process.env.NODE_ENV === "production"
            ? "The operation could not be completed."
            : `The operation could not be completed (Prisma ${code}).`,
        code,
      };
  }
}

/**
 * @param {unknown} err
 */
function mapPrismaClientError(err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return mapPrismaKnownRequest(err);
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    const raw = typeof err.message === "string" ? err.message : "";
    // Prefer actionable message when callers already annotated the error.
    const annotated = /tally|identity|migration/i.test(raw) ? raw : null;
    // Unknown select/include fields / Invalid create invocations are server bugs —
    // never leak Prisma payloads or code fragments to the UI.
    const looksLikeServerSchemaBug = /Unknown field|Invalid `[^`]+` invocation/i.test(raw);
    if (looksLikeServerSchemaBug) {
      return {
        status: 500,
        message: "Could not complete this action. Please try again or contact Admin.",
        code: "INTERNAL_PRISMA_VALIDATION",
      };
    }
    return {
      status: 400,
      message: annotated || "The request could not be processed.",
      code: "VALIDATION",
    };
  }
  return null;
}

function errorHandler(err, req, res, next) {
  // eslint-disable-next-line no-console
  console.error(err);

  // Express / body-parser PayloadTooLargeError (default 100kb; Tally apply uses 256kb route limit).
  const isPayloadTooLarge =
    err &&
    (err.type === "entity.too.large" ||
      err.status === 413 ||
      err.statusCode === 413 ||
      /request entity too large/i.test(String(err.message || "")));
  if (isPayloadTooLarge) {
    const path = String(req.originalUrl || req.url || "");
    const tallyConfirm = /\/api\/admin\/tally-import\/apply/i.test(path);
    return res.status(413).json({
      error: {
        message: tallyConfirm
          ? "The import confirmation request was too large. No stock items were imported."
          : "The request body is too large.",
        code: tallyConfirm ? "CONFIRM_PAYLOAD_TOO_LARGE" : "PAYLOAD_TOO_LARGE",
      },
    });
  }

  if (err instanceof ZodError) {
    const isProd = process.env.NODE_ENV === "production";
    const detail = Array.isArray(err.issues)
      ? err.issues
          .map((i) => `${Array.isArray(i.path) && i.path.length ? i.path.join(".") : "request"}: ${i.message}`)
          .join("; ")
      : "";
    return res.status(400).json({
      error: {
        message:
          isProd || !detail
            ? "Please check the information you entered and try again."
            : `Validation failed: ${detail}`,
        code: "VALIDATION",
      },
    });
  }

  const prismaMapped = mapPrismaClientError(err);
  if (prismaMapped) {
    return res.status(prismaMapped.status).json({
      error: {
        message: prismaMapped.message,
        code: prismaMapped.code,
        ...(err.correlationId ? { correlationId: err.correlationId } : {}),
      },
    });
  }

  const status = err.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500;
  const isProd = process.env.NODE_ENV === "production";
  const rawMsg = String(err.message || "");

  /** MySQL ENUM / schema mismatch (e.g. stockBucket value not in DB yet) — never expose driver text to clients */
  const looksLikeDbDriverSchemaError =
    /Data truncated|Out of range value for column|Incorrect .* value.*for column|Unknown column|doesn't exist/i.test(rawMsg);

  if (status >= 500 && looksLikeDbDriverSchemaError) {
    return res.status(503).json({
      error: {
        message: "A database configuration issue prevented this action. Please contact Admin.",
        code: "DATABASE_CONFIG",
        ...(err.correlationId ? { correlationId: err.correlationId } : {}),
      },
    });
  }

  if (status >= 500 && isProd && err.expose !== true) {
    return res.status(500).json({
      error: {
        message: "Something went wrong. Please try again later.",
        code: "INTERNAL",
        ...(err.correlationId ? { correlationId: err.correlationId } : {}),
      },
    });
  }

  const errorPayload = {
    message: err.message || "Internal Server Error",
  };
  if (err.code && typeof err.code === "string") {
    errorPayload.code = err.code;
  }
  if (err.correlationId) errorPayload.correlationId = err.correlationId;
  if (err.field) errorPayload.field = err.field;
  if (err.ledgerName) errorPayload.ledgerName = err.ledgerName;
  if (err.reason) errorPayload.reason = err.reason;
  return res.status(status).json({ error: errorPayload });
}

module.exports = { errorHandler, mapPrismaKnownRequest, mapPrismaClientError };
