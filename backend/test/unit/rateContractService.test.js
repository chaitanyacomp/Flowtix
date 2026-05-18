const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertEffectiveFromNotFuture,
  normalizeUtcDateOnly,
  FUTURE_EFFECTIVE_DATE_MESSAGE,
} = require("../../src/services/rateContractService");

test("assertEffectiveFromNotFuture allows today UTC", () => {
  const today = normalizeUtcDateOnly(new Date());
  const out = assertEffectiveFromNotFuture(today);
  assert.equal(out.getTime(), today.getTime());
});

test("assertEffectiveFromNotFuture rejects tomorrow UTC", () => {
  const tomorrow = normalizeUtcDateOnly(new Date());
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  assert.throws(
    () => assertEffectiveFromNotFuture(tomorrow),
    (e) => e.message === FUTURE_EFFECTIVE_DATE_MESSAGE && e.statusCode === 400,
  );
});

test("assertEffectiveFromNotFuture rejects year 2099", () => {
  assert.throws(
    () => assertEffectiveFromNotFuture(new Date("2099-01-01T00:00:00.000Z")),
    (e) => e.message === FUTURE_EFFECTIVE_DATE_MESSAGE,
  );
});
