import { describe, expect, it } from "vitest";
import { parseProductionHash, workspaceHash } from "./router";

describe("parseProductionHash", () => {
  it("parses the known standalone routes", () => {
    expect(parseProductionHash("#/onboarding")).toEqual({ view: "onboarding" });
    expect(parseProductionHash("#/invitations")).toEqual({ view: "invitations" });
    expect(parseProductionHash("#/workspaces/new")).toEqual({ view: "create-workspace" });
    expect(parseProductionHash("#/admin")).toEqual({ view: "admin" });
    expect(parseProductionHash("#/settings")).toEqual({ view: "settings" });
  });

  it("parses a workspace route with no tab", () => {
    expect(parseProductionHash("#/w/abc123")).toEqual({ view: "workspace", workspaceId: "abc123", tab: undefined });
  });

  it("parses a workspace route with a tab", () => {
    expect(parseProductionHash("#/w/abc123/agent")).toEqual({ view: "workspace", workspaceId: "abc123", tab: "agent" });
  });

  it("falls back to home for anything unrecognized, including empty and #/mentions", () => {
    expect(parseProductionHash("")).toEqual({ view: "home" });
    expect(parseProductionHash("#/home")).toEqual({ view: "home" });
    expect(parseProductionHash("#/mentions")).toEqual({ view: "home" });
    expect(parseProductionHash("#/bogus")).toEqual({ view: "home" });
  });

  it("never matches a demo-prefixed hash as a workspace route (structural separation)", () => {
    expect(parseProductionHash("#/demo/w/abc123")).toEqual({ view: "home" });
  });

  it("rejects a workspace id with path-traversal-shaped characters", () => {
    expect(parseProductionHash("#/w/../../etc")).toEqual({ view: "home" });
  });
});

describe("workspaceHash", () => {
  it("builds a bare workspace hash with no tab", () => {
    expect(workspaceHash("abc")).toBe("#/w/abc");
  });

  it("builds a tabbed workspace hash", () => {
    expect(workspaceHash("abc", "settings")).toBe("#/w/abc/settings");
  });

  it("round-trips through parseProductionHash", () => {
    expect(parseProductionHash(workspaceHash("ws-1", "weekly"))).toEqual({ view: "workspace", workspaceId: "ws-1", tab: "weekly" });
  });
});
