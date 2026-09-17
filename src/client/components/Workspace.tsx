import { useEffect, useState } from "react";
import { useWorkspace } from "../lib/useWorkspace";
import { PresenceBar } from "./Presence";
import { RemindersPanel } from "./RemindersPanel";
import { AddMemberForm } from "./AddMemberForm";
import { Board } from "./board/Board";
import { OverviewTab } from "./tabs/OverviewTab";
import { BlockersTab } from "./tabs/BlockersTab";
import { FeedbackTab } from "./tabs/FeedbackTab";
import { ActivityTab } from "./tabs/ActivityTab";
import { AgentTab } from "./tabs/AgentTab";
import { WeeklyTab } from "./tabs/WeeklyTab";
import { AttachmentsTab } from "./tabs/AttachmentsTab";

const TABS = [
  "Overview",
  "Board",
  "Blockers",
  "Feedback",
  "Activity",
  "Weekly",
  "Agent",
  "Attachments",
] as const;
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
  const [projectName, setProjectName] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/demo/workspaces")
      .then((r) => r.json() as Promise<{ workspaces?: Array<{ id: string; name: string }> }>)
      .then((d) => {
        if (live) setProjectName(d.workspaces?.find((w) => w.id === workspaceId)?.name ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [workspaceId]);

  if (ws.status === "unauthorized") {
    return (
      <div className="workspace">
        <div className="card unauthorized-card">
          <h2>You don't have access to this workspace</h2>
          <p className="meta">
            {identity.displayName} is not a member of <code>{workspaceId}</code>. Ask a mentor or
            manager of that workspace to add you, or go back and pick one you belong to.
          </p>
          <button className="primary" onClick={() => (window.location.hash = "#/overview")}>
            ← Back to overview
          </button>
        </div>
      </div>
    );
  }

  const role = ws.you?.role ?? null;
  const openBlockers = ws.blockers.filter((b) => b.status !== "RESOLVED").length;
  const attentionCount = ws.attentionItems.length;
  const pendingWeekly = ws.weeklyReports.filter((r) => r.status !== "APPROVED").length;
  const commentCounts: Record<string, number> = {};
  for (const f of ws.feedback) {
    if (f.taskId) commentCounts[f.taskId] = (commentCounts[f.taskId] ?? 0) + 1;
  }

  return (
    <div className="workspace">
      <div className="workspace-head">
        <div className="workspace-title">
          <h2>{projectName ?? workspaceId}</h2>
          <p className="meta">
            <span className={`badge role-${role ?? "none"}`}>{role ?? "observer"}</span> ·{" "}
            <strong>{identity.displayName}</strong>
            <span className="dev-tag" title="Demo identity — not real authentication">
              demo identity
            </span>
          </p>
        </div>
        <div className="workspace-head-right">
          {(role === "mentor" || role === "manager") && (
            <AddMemberForm workspaceId={workspaceId} identity={identity} devRole={devRole} members={ws.members} />
          )}
          <RemindersPanel
            items={ws.attentionItems}
            reminders={ws.reminders}
            workspaceId={workspaceId}
            identity={identity}
            devRole={devRole}
            onNavigate={(t) => setTab(t as Tab)}
          />
          <PresenceBar presence={ws.presence} status={ws.status} />
        </div>
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
            {t === "Blockers" && openBlockers > 0 && (
              <span className="count danger">{openBlockers}</span>
            )}
            {t === "Weekly" && pendingWeekly > 0 && <span className="count">{pendingWeekly}</span>}
            {t === "Overview" && attentionCount > 0 && (
              <span className="count danger">{attentionCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="tab-body">
        {tab === "Overview" && <OverviewTab state={ws} actions={ws.actions} />}
        {tab === "Board" && (
          <Board
            tasks={ws.tasks}
            role={role}
            userId={identity.userId}
            commentCounts={commentCounts}
            actions={ws.actions}
          />
        )}
        {tab === "Blockers" && <BlockersTab state={ws} actions={ws.actions} />}
        {tab === "Feedback" && <FeedbackTab state={ws} actions={ws.actions} />}
        {tab === "Activity" && <ActivityTab state={ws} />}
        {tab === "Weekly" && (
          <WeeklyTab state={ws} workspaceId={workspaceId} identity={identity} devRole={devRole} />
        )}
        {tab === "Agent" && (
          <AgentTab workspaceId={workspaceId} identity={identity} devRole={devRole} role={role} />
        )}
        {tab === "Attachments" && (
          <AttachmentsTab
            state={ws}
            workspaceId={workspaceId}
            identity={identity}
            devRole={devRole}
          />
        )}
      </div>
    </div>
  );
}
