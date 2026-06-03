// Gate test for the /internal founders-only dashboard.
//
// requireAdmin() (src/lib/require-admin.ts) is a thin server wrapper:
//   const { user } = await getSupabaseWithUser();
//   if (!canAccessAdmin(user)) notFound();   // 404, fail-closed
//   return user;
//
// The security decision is entirely in canAccessAdmin(), which we exercise here
// directly. getSupabaseWithUser()/notFound() are Next request-scoped APIs that
// cannot run outside a server request, so testing the pure decision proves the
// gate: a false result is exactly what triggers notFound() in requireAdmin().
//
// Run: node --test tests/unit/require-admin.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canAccessAdmin } from "../../src/lib/admin-emails.ts";

test("DENIES a non-admin email", () => {
  assert.equal(canAccessAdmin({ email: "stranger@example.com" }), false);
});

test("DENIES a missing user (null)", () => {
  assert.equal(canAccessAdmin(null), false);
});

test("DENIES a user with no email", () => {
  assert.equal(canAccessAdmin({ email: null }), false);
  assert.equal(canAccessAdmin({}), false);
});

test("ALLOWS the founder admin emails", () => {
  assert.equal(canAccessAdmin({ email: "noahhanning03@gmail.com" }), true);
  assert.equal(canAccessAdmin({ email: "lucasturcuato@gmail.com" }), true);
});

test("ALLOWS admin email case-insensitively", () => {
  assert.equal(canAccessAdmin({ email: "NoahHanning03@Gmail.com" }), true);
});

test("DENIES a lookalike that is not exactly allowlisted", () => {
  assert.equal(canAccessAdmin({ email: "noahhanning03@gmail.com.evil.com" }), false);
  assert.equal(canAccessAdmin({ email: "noahhanning03+x@gmail.com" }), false);
});
