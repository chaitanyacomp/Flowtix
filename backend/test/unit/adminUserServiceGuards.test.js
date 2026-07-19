const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertUserUpdateGuards,
  assertPasswordResetGuards,
} = require("../../src/services/adminUserService");

function expectGuardError(fn, code) {
  try {
    fn();
    assert.fail("expected guard to throw");
  } catch (err) {
    assert.equal(err.code, code);
    assert.equal(err.statusCode, 400);
  }
}

test("blocks self-deactivate", () => {
  expectGuardError(
    () =>
      assertUserUpdateGuards({
        actorUserId: 1,
        target: { id: 1, role: "ADMIN", isActive: true },
        patch: { isActive: false },
        otherActiveAdminCount: 2,
      }),
    "CANNOT_DEACTIVATE_SELF",
  );
});

test("allows deactivating another user when other admins remain", () => {
  assert.doesNotThrow(() =>
    assertUserUpdateGuards({
      actorUserId: 1,
      target: { id: 2, role: "STORE", isActive: true },
      patch: { isActive: false },
      otherActiveAdminCount: 1,
    }),
  );
});

test("blocks deactivating the last active ADMIN", () => {
  expectGuardError(
    () =>
      assertUserUpdateGuards({
        actorUserId: 1,
        target: { id: 2, role: "ADMIN", isActive: true },
        patch: { isActive: false },
        otherActiveAdminCount: 0,
      }),
    "LAST_ACTIVE_ADMIN",
  );
});

test("blocks demoting the last active ADMIN", () => {
  expectGuardError(
    () =>
      assertUserUpdateGuards({
        actorUserId: 1,
        target: { id: 2, role: "ADMIN", isActive: true },
        patch: { role: "STORE" },
        otherActiveAdminCount: 0,
      }),
    "LAST_ACTIVE_ADMIN",
  );
});

test("allows demoting an ADMIN when another active ADMIN exists", () => {
  assert.doesNotThrow(() =>
    assertUserUpdateGuards({
      actorUserId: 1,
      target: { id: 2, role: "ADMIN", isActive: true },
      patch: { role: "PURCHASE" },
      otherActiveAdminCount: 1,
    }),
  );
});

test("allows inactive ADMIN role change without last-admin check failure", () => {
  assert.doesNotThrow(() =>
    assertUserUpdateGuards({
      actorUserId: 1,
      target: { id: 2, role: "ADMIN", isActive: false },
      patch: { role: "STORE" },
      otherActiveAdminCount: 0,
    }),
  );
});

test("blocks resetting own password", () => {
  expectGuardError(
    () => assertPasswordResetGuards({ actorUserId: 5, targetUserId: 5 }),
    "CANNOT_RESET_OWN_PASSWORD",
  );
});

test("allows resetting another user's password", () => {
  assert.doesNotThrow(() => assertPasswordResetGuards({ actorUserId: 5, targetUserId: 9 }));
});
