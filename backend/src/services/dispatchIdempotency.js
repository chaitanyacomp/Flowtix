/**
 * Idempotency-Key handling inside the same Prisma transaction as dispatch writes.
 */

const crypto = require("crypto");

const STALE_IN_PROGRESS_MS = 2 * 60 * 1000;

const ROUTE_KEYS = {
  POST_DISPATCHES: "dispatch.postDispatches",
  POST_DISPATCH_LOCK: "dispatch.postDispatchLock",
  POST_REVERSE: "dispatch.postReverse",
};

function normalizeIdempotencyKey(headerValue) {
  if (headerValue == null || typeof headerValue !== "string") return null;
  const t = headerValue.trim();
  if (!t || t.length > 200) return null;
  return t;
}

/**
 * Stable string for idempotency body hashing: plain objects/arrays/primitives only (Zod-parsed JSON bodies).
 * Keys sorted at every object level; array order is preserved. Undefined object properties are omitted (JSON-like).
 * Does not support Map/Set/Date/BigInt — extend if those appear in request bodies.
 */
function stableStringifyForIdempotency(value) {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringifyForIdempotency(v)).join(",")}]`;
  }
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringifyForIdempotency(value[k])}`).join(",")}}`;
}

function hashRequestBody(obj) {
  const s = stableStringifyForIdempotency(obj);
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * After row locks: claim key or return replay payload.
 * @returns {Promise<{ replay: false } | { replay: true, status: number, body: object }>}
 */
async function claimOrReplayDispatchIdempotency(tx, { userId, routeKey, idempotencyKey, requestBodyHash }) {
  if (!idempotencyKey) {
    return { replay: false };
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const existing = await tx.idempotencyRecord.findUnique({
      where: {
        userId_routeKey_idempotencyKey: {
          userId,
          routeKey,
          idempotencyKey,
        },
      },
    });

    if (existing) {
      if (existing.requestBodyHash !== requestBodyHash) {
        const err = new Error("Idempotency-Key was reused with a different request body.");
        err.statusCode = 409;
        err.code = "IDEMPOTENCY_BODY_MISMATCH";
        throw err;
      }
      if (existing.responseStatus != null && existing.responseBody != null) {
        return {
          replay: true,
          status: existing.responseStatus,
          body: JSON.parse(existing.responseBody),
        };
      }
      const age = Date.now() - new Date(existing.createdAt).getTime();
      if (age > STALE_IN_PROGRESS_MS) {
        await tx.idempotencyRecord.delete({ where: { id: existing.id } });
        continue;
      }
      // Same HTTP status as some business conflicts (409) — clients should use error.code === "IDEMPOTENCY_IN_PROGRESS".
      const err = new Error(
        "This Idempotency-Key is already being processed; wait for the first request to finish or retry later.",
      );
      err.statusCode = 409;
      err.code = "IDEMPOTENCY_IN_PROGRESS";
      throw err;
    }

    try {
      await tx.idempotencyRecord.create({
        data: {
          userId,
          routeKey,
          idempotencyKey,
          requestBodyHash,
          expiresAt,
        },
      });
      return { replay: false };
    } catch (e) {
      if (e?.code === "P2002") {
        continue;
      }
      throw e;
    }
  }

  const err = new Error("Could not claim idempotency key; retry the request.");
  err.statusCode = 409;
  err.code = "IDEMPOTENCY_CLAIM_FAILED";
  throw err;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function completeDispatchIdempotency(tx, { userId, routeKey, idempotencyKey, responseStatus, body }) {
  if (!idempotencyKey) return;
  const responseBody = JSON.stringify(body);
  await tx.idempotencyRecord.update({
    where: {
      userId_routeKey_idempotencyKey: {
        userId,
        routeKey,
        idempotencyKey,
      },
    },
    data: {
      responseStatus,
      responseBody,
    },
  });
}

module.exports = {
  ROUTE_KEYS,
  normalizeIdempotencyKey,
  hashRequestBody,
  claimOrReplayDispatchIdempotency,
  completeDispatchIdempotency,
};
