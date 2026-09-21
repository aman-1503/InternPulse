import { useEffect, useState } from "react";
import { useWorkspace } from "../lib/useWorkspace";
import type { WorkspaceMode } from "../lib/workspaceApi";
import { workspaceHash, navigate } from "../router";
import { PresenceBar } from "../components/Presence";
import { RemindersPanel } from "../components/RemindersPanel";
import { AddMemberForm } from "../components/AddMemberForm";
import { Board } from "../components/board/Board";
import { OverviewTab } from "../components/tabs/OverviewTab";
import { BlockersTab } from "../components/tabs/BlockersTab";
import { FeedbackTab } from "../components/tabs/FeedbackTab";
import { ActivityTab } from "../components/tabs/ActivityTab";
import { AgentTab } from "../components/tabs/AgentTab";
import { WeeklyTab } from "../components/tabs/WeeklyTab";
import { AttachmentsTab } from "../components/tabs/AttachmentsTab";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { RoleBadge } from "../ui/badges";
import { badge, badgeTones, btn, cn, meta, pageTitle } from "../ui/primitives";
import { Banner, EmptyState, LoadingScreen } from "../ui/states";

const TABS = ["Overview", "Board", "Blockers", "Feedback", "Activity", "Weekly", "Agent", "Attachments"] as const;
type Tab = (typeof TABS)[number];
const TAB_SLUG: Record<Tab, string> = {
  Overview: "overview",
  Board: "board",
  Blockers: "blockers",
  Feedback: "feedback",
  Activity: "activity",
  Weekly: "weekly",
  Agent: "agent",
  Attachments: "attachments",
};
const SLUG_TAB: Record<string, Tab> = Object.fromEntries(TABS.map((t) => [TAB_SLUG[t], t]));

/**
 * Single workspace shell, shared by production and demo — identity/base-URL
 * differences are entirely captured by `mode` (see lib/workspaceApi.ts).
 */
export function WorkspaceView({
  workspaceId,
  mode,
  urlTab,
  workspaceName,
  demoBadge,
  onBack,
}: {
  workspaceId: string;
  mode: WorkspaceMode;
  urlTab?: string;
  workspaceName?: string | null;
  demoBadge?: boolean;
  onBack: () => void;
}) {
  const ws = useWorkspace(workspaceId, mode);
  const [tab, setTab] = useState<Tab>(() => (urlTab && SLUG_TAB[urlTab] ? SLUG_TAB[urlTab] : "Overview"));
  const showSettings = urlTab === "settings";

  useEffect(() => {
    if (urlTab && SLUG_TAB[urlTab]) setTab(SLUG_TAB[urlTab]);
  }, [urlTab]);

  // workspaceHash() always builds the PRODUCTION "#/w/..." form. Pushing
  // that while mounted under DemoApp would produce a hash that no longer
  // starts with "#/demo" — Root's hashchange listener would then unmount
  // the entire demo tree and mount ProductionApp (a real user just
  // clicking a tab in the demo experience would get bounced to the
  // "Sign-in required" screen). Demo needs its own "#/demo/w/..." form.
  const inWorkspaceHash = (tabSlug?: string) =>
    mode.kind === "demo"
      ? `#/demo/w/${workspaceId}${tabSlug ? `/${tabSlug}` : ""}`
      : workspaceHash(workspaceId, tabSlug);

  const selectTab = (t: Tab) => {
    setTab(t);
    navigate(inWorkspaceHash(TAB_SLUG[t]));
  };

  if (ws.status === "unauthorized") {
    return (
      <div className="p-4">
        <EmptyState
          title="You don't have access to this workspace"
          description="Ask a mentor or manager of that workspace to add you, or go back to one you belong to."
          action={
            <button className={cn(btn("primary"), "mt-2")} onClick={onBack}>
              ← Back
            </button>
          }
        />
      </div>
    );
  }

  if (ws.status === "connecting" && !ws.you) {
    return <LoadingScreen label="Loading workspace…" />;
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
    <div className="flex flex-col gap-3 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>{workspaceName ?? workspaceId}</h1>
          <p className={cn(meta, "mt-0.5 flex flex-wrap items-center gap-2")}>
            <RoleBadge role={role} /> <strong className="text-text">{ws.you?.displayName}</strong>
            {demoBadge && (
              <span className={badge(badgeTones.warning)} title="Demo identity — not real authentication">
                demo identity
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode.kind === "demo" && (role === "mentor" || role === "manager") && (
            <AddMemberForm workspaceId={workspaceId} mode={mode} members={ws.members} />
          )}
          {(role === "mentor" || role === "manager") && (
            <button className={btn("default")} onClick={() => navigate(inWorkspaceHash("settings"))}>
              Settings
            </button>
          )}
          <RemindersPanel items={ws.attentionItems} onNavigate={(t) => selectTab(t as Tab)} />
          <PresenceBar presence={ws.presence} status={ws.status} />
        </div>
      </div>

      {ws.status !== "open" && <Banner>Connection {ws.status}… realtime updates paused.</Banner>}
      {ws.lastError && (
        <Banner tone="danger">
          {ws.lastError.code ? `${ws.lastError.code}: ` : ""}
          {ws.lastError.message}
        </Banner>
      )}

      {showSettings ? (
        <div className="flex flex-col gap-3">
          <button className={cn(btn("ghost"), "self-start")} onClick={() => navigate(inWorkspaceHash())}>
            ← Back to workspace
          </button>
          <WorkspaceSettings
            workspaceId={workspaceId}
            workspaceName={workspaceName ?? workspaceId}
            members={ws.members}
            canManage={mode.kind === "production" && (role === "mentor" || role === "manager")}
          />
        </div>
      ) : (
        <>
          <nav className="tabs-scroll flex gap-1 border-b border-border" role="tablist">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={t === tab}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  t === tab
                    ? "border-accent text-accent"
                    : "border-transparent text-muted hover:border-border hover:text-text",
                )}
                onClick={() => selectTab(t)}
              >
                {t}
                {t === "Blockers" && openBlockers > 0 && <CountDot n={openBlockers} />}
                {t === "Weekly" && pendingWeekly > 0 && <CountDot n={pendingWeekly} tone="neutral" />}
                {t === "Overview" && attentionCount > 0 && <CountDot n={attentionCount} />}
              </button>
            ))}
          </nav>

          <div className="pt-1">
            {tab === "Overview" && <OverviewTab state={ws} actions={ws.actions} />}
            {tab === "Board" && (
              <Board tasks={ws.tasks} role={role} userId={ws.you?.userId ?? ""} commentCounts={commentCounts} actions={ws.actions} />
            )}
            {tab === "Blockers" && <BlockersTab state={ws} actions={ws.actions} />}
            {tab === "Feedback" && <FeedbackTab state={ws} actions={ws.actions} />}
            {tab === "Activity" && <ActivityTab state={ws} />}
            {tab === "Weekly" && <WeeklyTab state={ws} workspaceId={workspaceId} mode={mode} />}
            {tab === "Agent" && <AgentTab workspaceId={workspaceId} mode={mode} role={role} />}
            {tab === "Attachments" && <AttachmentsTab state={ws} workspaceId={workspaceId} mode={mode} />}
          </div>
        </>
      )}
    </div>
  );
}

function CountDot({ n, tone = "danger" }: { n: number; tone?: "danger" | "neutral" }) {
  return <span className={badge(tone === "danger" ? badgeTones.danger : badgeTones.neutral)}>{n}</span>;
}
