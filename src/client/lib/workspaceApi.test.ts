import { describe, expect, it } from "vitest";
import { identityQuery, withQuery, workspaceBase } from "./workspaceApi";

describe("workspaceBase", () => {
  it("routes production mode to /api/workspace/*", () => {
    expect(workspaceBase("ws-1", { kind: "production" })).toBe("/api/workspace/ws-1");
  });

  it("routes demo mode to /api/demo/workspace/* — structurally separate namespaces", () => {
    expect(workspaceBase("ws-1", { kind: "demo", userId: "u1", displayName: "A" })).toBe("/api/demo/workspace/ws-1");
  });

  it("URL-encodes the workspace id", () => {
    expect(workspaceBase("has space", { kind: "production" })).toBe("/api/workspace/has%20space");
  });
});

describe("identityQuery", () => {
  it("never sends identity query params in production — the client must not assert authoritative identity", () => {
    expect(identityQuery({ kind: "production" })).toBe("");
  });

  it("sends userId/displayName/devRole for demo mode only", () => {
    const qs = identityQuery({ kind: "demo", userId: "u-alice", displayName: "Alice", devRole: "intern" });
    const params = new URLSearchParams(qs);
    expect(params.get("userId")).toBe("u-alice");
    expect(params.get("displayName")).toBe("Alice");
    expect(params.get("devRole")).toBe("intern");
  });

  it("omits devRole from the demo query string when not provided", () => {
    const qs = identityQuery({ kind: "demo", userId: "u-alice", displayName: "Alice" });
    expect(new URLSearchParams(qs).has("devRole")).toBe(false);
  });
});

describe("withQuery", () => {
  it("appends a query string only when non-empty", () => {
    expect(withQuery("/api/x", "")).toBe("/api/x");
    expect(withQuery("/api/x", "a=1")).toBe("/api/x?a=1");
  });
});
