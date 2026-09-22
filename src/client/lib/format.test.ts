import { describe, expect, it } from "vitest";
import { timeUntil } from "./format";

describe("timeUntil", () => {
  it("reports a several-day-out future timestamp in days, not as a past-tense 'ago' string", () => {
    const threeDaysFromNow = Date.now() + 3 * 24 * 60 * 60 * 1000;
    expect(timeUntil(threeDaysFromNow)).toBe("in 3d");
  });

  it("falls back to a calendar date beyond a week out (e.g. a 14-day invitation expiry)", () => {
    const fourteenDaysFromNow = Date.now() + 14 * 24 * 60 * 60 * 1000;
    expect(timeUntil(fourteenDaysFromNow)).toBe(`on ${new Date(fourteenDaysFromNow).toLocaleDateString()}`);
  });

  it("reports an already-past timestamp as expired rather than 'just now'", () => {
    expect(timeUntil(Date.now() - 1000)).toBe("expired");
  });

  it("reports a near-future timestamp in minutes/hours", () => {
    expect(timeUntil(Date.now() + 5 * 60 * 1000)).toBe("in 5m");
    expect(timeUntil(Date.now() + 3 * 60 * 60 * 1000)).toBe("in 3h");
  });
});
