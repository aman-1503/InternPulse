import { useEffect, useState } from "react";
import type { WeeklyReport } from "../../../shared/protocol";
import type { WorkspaceState } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";
import { overrideWeeklyReport, reviewWeeklyReport, saveWeeklyDraft, startWeeklyReview, submitWeeklyReport } from "../../lib/phase4b";
import type { WorkspaceMode } from "../../lib/workspaceApi";
import { btn, card, cn, meta, row, textarea } from "../../ui/primitives";
import { WeeklyStatusBadge, WarnBadge } from "../../ui/badges";
import { Banner } from "../../ui/states";

const LIFECYCLE = ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "RESUBMITTED", "APPROVED"] as const;

function Stepper({ status }: { status: WeeklyReport["status"] }) {
  const idx = LIFECYCLE.indexOf(status);
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {LIFECYCLE.map((s, i) => {
        const done = i < idx;
        const current = i === idx;
        return (
          <div key={s} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                  done && "bg-success text-white",
                  current && "bg-accent text-white ring-4 ring-accent-muted",
                  !done && !current && "bg-surface-muted text-muted",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={cn("whitespace-nowrap text-[11px]", current ? "font-semibold text-accent" : done ? "text-success" : "text-muted")}>
                {s.replace(/_/g, " ")}
              </span>
            </div>
            {i < LIFECYCLE.length - 1 && <span className={cn("mx-1.5 mb-4 h-px w-4 sm:w-8", done ? "bg-success" : "bg-border")} />}
          </div>
        );
      })}
    </div>
  );
}

export function WeeklyTab({
  state,
  workspaceId,
  mode,
}: {
  state: WorkspaceState;
  workspaceId: string;
  mode: WorkspaceMode;
}) {
  const role = state.you?.role ?? null;
  const visible = [...state.weeklyReports].sort((a, b) => b.createdAt - a.createdAt);

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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        {(role === "intern" || role === "mentor") && (
          <button
            className={btn("primary")}
            disabled={busy}
            onClick={() =>
              run(async () => {
                const { report } = await startWeeklyReview(workspaceId, mode);
                setSelectedId(report.id);
              })
            }
          >
            Start weekly review
          </button>
        )}
        <span className={meta}>{visible.length} report(s)</span>
      </div>

      {err && <Banner tone="danger">{err}</Banner>}

      <div className="flex flex-wrap gap-1.5">
        {visible.map((r) => (
          <button
            key={r.id}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
              r.id === selected?.id ? "border-accent bg-accent-muted text-accent" : "border-border hover:bg-surface-muted",
            )}
            onClick={() => setSelectedId(r.id)}
          >
            {r.reportingPeriod} <WeeklyStatusBadge status={r.status} />
          </button>
        ))}
        {visible.length === 0 && <p className={meta}>No weekly reports yet.</p>}
      </div>

      {selected && (
        <ReportPanel
          key={selected.id}
          report={selected}
          role={role}
          busy={busy}
          onSave={(content) => run(() => saveWeeklyDraft(workspaceId, mode, selected.id, content))}
          onSubmit={() => run(() => submitWeeklyReport(workspaceId, mode, selected.id))}
          onReview={(decision, feedback) => run(() => reviewWeeklyReport(workspaceId, mode, selected.id, decision, feedback))}
          onOverride={(decision, note) => run(() => overrideWeeklyReport(workspaceId, mode, selected.id, decision, note))}
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
  onOverride,
}: {
  report: WeeklyReport;
  role: string | null;
  busy: boolean;
  onSave: (content: string) => void;
  onSubmit: () => void;
  onReview: (decision: "APPROVE" | "REQUEST_CHANGES", feedback?: string) => void;
  onOverride: (decision: "APPROVE" | "REQUEST_CHANGES", note: string) => void;
}) {
  const editable = role === "intern" && (report.status === "DRAFT" || report.status === "CHANGES_REQUESTED");
  const reviewable = role === "mentor" && (report.status === "SUBMITTED" || report.status === "RESUBMITTED");
  const overridable = role === "manager" && (report.status === "SUBMITTED" || report.status === "RESUBMITTED");
  const [draft, setDraft] = useState(report.draftContent);
  const [feedback, setFeedback] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const content = report.status === "APPROVED" ? (report.finalContent ?? report.draftContent) : report.draftContent;

  return (
    <div className={cn(card, "flex flex-col gap-3")}>
      <div className="flex flex-wrap items-center gap-2">
        <strong>{report.reportingPeriod}</strong>
        <WeeklyStatusBadge status={report.status} />
        {!report.aiGenerated && <WarnBadge>deterministic draft (AI was unavailable)</WarnBadge>}
        <span className={meta}>
          round {report.round} · created {timeAgo(report.createdAt)}
        </span>
      </div>

      <Stepper status={report.status} />

      {report.status === "CHANGES_REQUESTED" && report.mentorFeedback && (
        <Banner tone="warning">Mentor asked for changes: {report.mentorFeedback}</Banner>
      )}
      {report.overriddenBy && (
        <Banner tone="warning">
          <strong className="uppercase tracking-wide">Manager override</strong> — {report.overriddenByName ?? report.overriddenBy} decided{" "}
          <strong>{report.status.replace(/_/g, " ")}</strong>.
        </Banner>
      )}

      {editable ? (
        <>
          <textarea className={cn(textarea, "min-h-64")} rows={16} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className={row}>
            <button className={btn("default")} disabled={busy} onClick={() => onSave(draft)}>
              Save draft
            </button>
            <button className={btn("primary")} disabled={busy} onClick={onSubmit}>
              Submit for review
            </button>
          </div>
        </>
      ) : (
        <pre className="whitespace-pre-wrap rounded-lg border border-border bg-surface-muted/40 p-3 text-sm">
          {content || "(no content yet)"}
        </pre>
      )}

      {reviewable && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <label className="text-sm font-medium">Feedback (required for changes)</label>
          <textarea className={textarea} rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          <div className={row}>
            <button className={btn("primary")} disabled={busy} onClick={() => onReview("APPROVE")}>
              Approve
            </button>
            <button className={btn("default")} disabled={busy || !feedback.trim()} onClick={() => onReview("REQUEST_CHANGES", feedback.trim())}>
              Request changes
            </button>
          </div>
        </div>
      )}

      {overridable && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning-muted/40 p-3">
          <label className="text-sm font-medium">Manager override — note required (recorded in the audit history)</label>
          <textarea className={textarea} rows={3} value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} />
          <div className={row}>
            <button className={btn("primary")} disabled={busy || !overrideNote.trim()} onClick={() => onOverride("APPROVE", overrideNote.trim())}>
              Override: Approve
            </button>
            <button className={btn("danger")} disabled={busy || !overrideNote.trim()} onClick={() => onOverride("REQUEST_CHANGES", overrideNote.trim())}>
              Override: Request changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
