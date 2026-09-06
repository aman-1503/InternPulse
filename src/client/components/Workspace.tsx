import { useState } from "react";
import { useWorkspace } from "../lib/useWorkspace";
import { PresenceBar } from "./Presence";
import { Board } from "./board/Board";
import { OverviewTab } from "./tabs/OverviewTab";
import { BlockersTab } from "./tabs/BlockersTab";
import { FeedbackTab } from "./tabs/FeedbackTab";
import { ActivityTab } from "./tabs/ActivityTab";
import { AgentTab } from "./tabs/AgentTab";

const TABS = ["Overview", "Board", "Blockers", "Feedback", "Activity", "Agent"] as const;
type Tab = (typeof TABS)[number];

export function Workspace({
  workspaceId,
  identity,
  devRole,
}: {
  workspaceId: string;
  identity: { userId: string; displayName: string };
  devRole: string;
}) {
  const ws = useWorkspace(workspaceId, identity, devRole);
  const [tab, setTab] = useState<Tab>("Overview");

  const role = ws.you?.role ?? null;
  const canEditBoard = role === "intern" || role === "mentor";
  const openBlockers = ws.blockers.filter((b) => b.status === "OPEN").length;

  return (
    <div className="workspace">
      <div className="workspace-head">
        <div>
          <h2>{workspaceId}</h2>
          <p className="meta">
            you are <strong>{identity.displayName}</strong> ·{" "}
            <span className={`badge role-${role ?? "none"}`}>{role ?? "observer"}</span>
            {ws.schemaVersion != null && <> · schema v{ws.schemaVersion}</>}
          </p>
        </div>
        <PresenceBar presence={ws.presence} status={ws.status} />
      </div>

      {ws.status !== "open" && (
        <div className="banner">Connection {ws.status}… realtime updates paused.</div>
      )}
      {ws.lastError && (
        <div className="banner error">
          {ws.lastError.code ? `${ws.lastError.code}: ` : ""}
          {ws.lastError.message}
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>
            {t}
            {t === "Blockers" && openBlockers > 0 && <span className="count danger">{openBlockers}</span>}
          </button>
        ))}
      </nav>

      <div className="tab-body">
        {tab === "Overview" && <OverviewTab state={ws} actions={ws.actions} />}
        {tab === "Board" && <Board tasks={ws.tasks} canEdit={canEditBoard} actions={ws.actions} />}
        {tab === "Blockers" && <BlockersTab state={ws} actions={ws.actions} />}
        {tab === "Feedback" && <FeedbackTab state={ws} actions={ws.actions} />}
        {tab === "Activity" && <ActivityTab state={ws} />}
        {tab === "Agent" && (
          <AgentTab workspaceId={workspaceId} identity={identity} devRole={devRole} role={role} />
        )}
      </div>
    </div>
  );
}
