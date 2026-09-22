import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import { invitationErrorMessage } from "./inviteErrors";

describe("invitationErrorMessage", () => {
  it("gives a clear message for each known backend code", () => {
    expect(invitationErrorMessage(new ApiError("x", 403, "email_mismatch"))).toMatch(/different email/);
    expect(invitationErrorMessage(new ApiError("x", 409, "expired"))).toMatch(/expired/);
    expect(invitationErrorMessage(new ApiError("x", 409, "not_pending"))).toMatch(/no longer pending/);
    expect(invitationErrorMessage(new ApiError("x", 404, "not_found"))).toMatch(/could not be found/);
  });

  it("falls back to the server message for an unrecognized ApiError code", () => {
    expect(invitationErrorMessage(new ApiError("something odd", 400, "weird_code"))).toBe("something odd");
  });

  it("falls back to a generic network message for a non-ApiError failure", () => {
    expect(invitationErrorMessage(new TypeError("fetch failed"))).toMatch(/Network error/);
  });
});
