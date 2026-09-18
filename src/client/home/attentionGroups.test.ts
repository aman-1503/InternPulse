import { describe, expect, it } from "vitest";
import type { AttentionItem, WorkspaceSnapshot } from "../../shared/protocol";
import type { Membership } from "../auth/types";
import type { PortfolioEntry } from "../lib/usePortfolio";
import { byReasons, flattenAttention } from "./attentionGroups";

function attentionItem(overrides: Partial<AttentionItem>): AttentionItem {
  return {
    id: "a1",
    recipientUserId: null,
    recipientRole: "mentor",
    reason: "BLOCKER_WAITING_ON_YOU",
    title: "t",
    message: "m",
    entityType: "BLOCKER",
    entityId: "b1",
    createdAt: 1,
    navigate: { tab: "blockers", entityId: "b1" },
    ...overrides,
  };
}

function membership(workspaceId: string): Membership {
  return { workspaceId, workspaceName: `Name-${workspaceId}`, slug: workspaceId, role: "mentor" };
}

function entry(workspaceId: string, items: AttentionItem[]): PortfolioEntry {
  return {
    membership: membership(workspaceId),
    snapshot: { attentionItems: items } as unknown as WorkspaceSnapshot,
    error: null,
  };
}

describe("flattenAttention", () => {
  it("flattens across workspaces, tagging each row with its workspace, sorted newest first", () => {
    const entries: PortfolioEntry[] = [
      entry("ws-a", [attentionItem({ id: "old", createdAt: 1 })]),
      entry("ws-b", [attentionItem({ id: "new", createdAt: 100 })]),
    ];
    const rows = flattenAttention(entries);
    expect(rows.map((r) => r.item.id)).toEqual(["new", "old"]);
    expect(rows[0].workspaceId).toBe("ws-b");
    expect(rows[0].workspaceName).toBe("Name-ws-b");
  });

  it("skips workspaces with no snapshot (e.g. a failed fetch)", () => {
    const entries: PortfolioEntry[] = [
      { membership: membership("ws-c"), snapshot: null, error: "unavailable (500)" },
    ];
    expect(flattenAttention(entries)).toEqual([]);
  });
});

describe("byReasons", () => {
  it("filters to only the requested reasons", () => {
    const entries: PortfolioEntry[] = [
      entry("ws-a", [
        attentionItem({ id: "1", reason: "BLOCKER_WAITING_ON_YOU" }),
        attentionItem({ id: "2", reason: "ESCALATION" }),
      ]),
    ];
    const rows = flattenAttention(entries);
    expect(byReasons(rows, ["ESCALATION"]).map((r) => r.item.id)).toEqual(["2"]);
    expect(byReasons(rows, ["BLOCKER_WAITING_ON_YOU", "ESCALATION"])).toHaveLength(2);
    expect(byReasons(rows, ["MENTIONED"])).toHaveLength(0);
  });
});
