import { useEffect, useState } from "react";
import type { WorkspaceSnapshot } from "../../shared/protocol";
import type { Membership } from "../auth/types";
import { workspaceBase, type WorkspaceMode } from "./workspaceApi";

export interface PortfolioEntry {
  membership: Membership;
  snapshot: WorkspaceSnapshot | null;
  error: string | null;
}

/**
 * Fans out one read-only snapshot fetch per membership (same "fine at this
 * scale" pattern the Worker's own /api/overview already uses server-side) so
 * role-aware home screens can show attention/task/blocker/weekly signals
 * across every workspace someone mentors/manages without holding open a
 * live WebSocket per workspace just to render a dashboard. Opening a
 * specific workspace still goes through the live, realtime useWorkspace().
 */
export function usePortfolio(memberships: Membership[], mode: WorkspaceMode) {
  const key = memberships.map((m) => m.workspaceId).join(",");
  const [entries, setEntries] = useState<PortfolioEntry[]>([]);
  const [loading, setLoading] = useState(memberships.length > 0);

  useEffect(() => {
    let live = true;
    if (memberships.length === 0) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all(
      memberships.map(async (membership): Promise<PortfolioEntry> => {
        try {
          const res = await fetch(`${workspaceBase(membership.workspaceId, mode)}/snapshot`);
          if (!res.ok) return { membership, snapshot: null, error: `unavailable (${res.status})` };
          const snapshot = (await res.json()) as WorkspaceSnapshot;
          return { membership, snapshot, error: null };
        } catch {
          return { membership, snapshot: null, error: "network error" };
        }
      }),
    ).then((results) => {
      if (!live) return;
      setEntries(results);
      setLoading(false);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode.kind]);

  return { entries, loading };
}
