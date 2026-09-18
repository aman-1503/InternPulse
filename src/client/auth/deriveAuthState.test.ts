import { describe, expect, it } from "vitest";
import { deriveAuthState } from "./deriveAuthState";
import type { MeUser } from "./types";

const user: MeUser = { id: "u1", email: "a@example.com", displayName: "A", accountStatus: "ACTIVE", isAdmin: false };

describe("deriveAuthState", () => {
  it("maps a network failure to network_error", () => {
    expect(deriveAuthState({ kind: "network_error" })).toEqual({ status: "network_error" });
  });

  it("maps 200 + user to authenticated, defaulting missing arrays", () => {
    expect(deriveAuthState({ kind: "response", status: 200, body: { user } })).toEqual({
      status: "authenticated",
      user,
      memberships: [],
      pendingInvitations: [],
    });
  });

  it("maps 200 without a user body to network_error rather than guessing", () => {
    expect(deriveAuthState({ kind: "response", status: 200, body: {} })).toEqual({ status: "network_error" });
  });

  it("maps 401 to unauthenticated", () => {
    expect(deriveAuthState({ kind: "response", status: 401, body: { error: "x", code: "unauthenticated" } })).toEqual({
      status: "unauthenticated",
    });
  });

  it("maps 403/account_suspended to suspended", () => {
    expect(deriveAuthState({ kind: "response", status: 403, body: { code: "account_suspended" } })).toEqual({
      status: "suspended",
    });
  });

  it("maps 403/account_disabled to disabled", () => {
    expect(deriveAuthState({ kind: "response", status: 403, body: { code: "account_disabled" } })).toEqual({
      status: "disabled",
    });
  });

  it("maps an unrecognized 403 to forbidden with the server message", () => {
    expect(deriveAuthState({ kind: "response", status: 403, body: { error: "nope" } })).toEqual({
      status: "forbidden",
      message: "nope",
    });
  });

  it("maps 409/identity_conflict to identity_conflict with the server message", () => {
    expect(deriveAuthState({ kind: "response", status: 409, body: { code: "identity_conflict", error: "dup" } })).toEqual({
      status: "identity_conflict",
      message: "dup",
    });
  });

  it("maps an unexpected 5xx to network_error rather than a wrong auth state", () => {
    expect(deriveAuthState({ kind: "response", status: 500, body: {} })).toEqual({ status: "network_error" });
  });
});
