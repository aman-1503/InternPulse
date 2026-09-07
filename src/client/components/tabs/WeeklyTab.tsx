import { useEffect, useState } from "react";
import type { WeeklyReport } from "../../../shared/protocol";
import type { WorkspaceState } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";
import {
  reviewWeeklyReport,
  saveWeeklyDraft,
  startWeeklyReview,
  submitWeeklyReport,
} from "../../lib/phase4b";

interface Identity {
  userId: string;
  displayName: string;
}

export function WeeklyTab({
  state,
  workspaceId,
  identity,
  devRole,
}: {
  state: WorkspaceState;
  workspaceId: string;
  identity: Identity;
  devRole: string;
}) {
  const role = state.you?.role ?? null;
  const reports = [...state.weeklyReports].sort((a, b) => b.createdAt - a.createdAt);
  const visible = role === "manager" ? reports.filter((r) => r.status === "APPROVED") : reports;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = visible.find((r) => r.id === selectedId) ?? visible[0] ?? null;

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="weekly">
      <div className="weekly-bar">
        {(role === "intern" || role === "mentor") && (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const { report } = await startWeeklyReview(workspaceId, identity, devRole);
                setSelectedId(report.id);
              })
            }
          >
            Start weekly review
          </button>
        )}
        <span className="meta">{visible.length} report(s)</span>
      </div>

      {err && <div className="banner error">{err}</div>}

      <div className="weekly-list">
        {visible.map((r) => (
          <button
            key={r.id}
            className={`weekly-chip${r.id === selected?.id ? " active" : ""}`}
            onClick={() => setSelectedId(r.id)}
          >
            {r.reportingPeriod} <span className={`badge status-${r.status}`}>{r.status}</span>
          </button>
        ))}
        {visible.length === 0 && <p className="meta">No weekly reports yet.</p>}
      </div>

      {selected && (
        <ReportPanel
          key={selected.id}
          report={selected}
          role={role}
          busy={busy}
          onSave={(content) =>
            run(() => saveWeeklyDraft(workspaceId, identity, devRole, selected.id, content))
          }
          onSubmit={() => run(() => submitWeeklyReport(workspaceId, identity, devRole, selected.id))}
          onReview={(decision, feedback) =>
            run(() =>
              reviewWeeklyReport(workspaceId, identity, devRole, selected.id, decision, feedback),
            )
          }
        />
      )}
    </div>
  );
}

function ReportPanel({
  report,
  role,
  busy,
  onSave,
  onSubmit,
  onReview,
}: {
  report: WeeklyReport;
  role: string | null;
  busy: boolean;
  onSave: (content: string) => void;
  onSubmit: () => void;
  onReview: (decision: "APPROVE" | "REQUEST_CHANGES", feedback?: string) => void;
}) {
  const editable =
    role === "intern" && (report.status === "DRAFT" || report.status === "CHANGES_REQUESTED");
  const reviewable = role === "mentor" && report.status === "SUBMITTED";
  const [draft, setDraft] = useState(report.draftContent);
  const [feedback, setFeedback] = useState("");
  const content = report.status === "APPROVED" ? (report.finalContent ?? report.draftContent) : report.draftContent;

  return (
    <div className="card report-panel">
      <div className="report-head">
        <strong>{report.reportingPeriod}</strong>
        <span className={`badge status-${report.status}`}>{report.status}</span>
        {!report.aiGenerated && <span className="badge warn">deterministic draft (AI was unavailable)</span>}
        <span className="meta">round {report.round} · created {timeAgo(report.createdAt)}</span>
      </div>

      {report.status === "CHANGES_REQUESTED" && report.mentorFeedback && (
        <div className="banner">Mentor asked for changes: {report.mentorFeedback}</div>
      )}

      {editable ? (
        <>
          <textarea
            className="report-editor"
            rows={16}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="row">
            <button disabled={busy} onClick={() => onSave(draft)}>
              Save draft
            </button>
            <button className="primary" disabled={busy} onClick={onSubmit}>
              Submit for review
            </button>
          </div>
        </>
      ) : (
        <pre className="report-view">{content || "(no content yet)"}</pre>
      )}

      {reviewable && (
        <div className="report-review">
          <label>Feedback (required for changes)</label>
          <textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => onReview("APPROVE")}>
              Approve
            </button>
            <button
              disabled={busy || !feedback.trim()}
              onClick={() => onReview("REQUEST_CHANGES", feedback.trim())}
            >
              Request changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
