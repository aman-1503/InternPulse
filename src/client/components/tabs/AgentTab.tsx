import { useCallback, useEffect, useRef, useState } from "react";
import { AGENT_QUICK_PROMPTS, AGENT_PROMPT_MAX, type AgentGroundedOn, type AgentTurn, type Role } from "../../../shared/protocol";
import { timeAgo } from "../../lib/format";
import { askAgent, getAgentHistory } from "../../lib/agentClient";
import type { WorkspaceMode } from "../../lib/workspaceApi";
import { btn, card, cn, meta, textarea } from "../../ui/primitives";
import { Banner } from "../../ui/states";

/**
 * The Progress Agent panel. Text in -> grounded answer out. All reasoning
 * happens server-side against authoritative WorkspaceDO state; this component
 * only renders the conversation.
 */
export function AgentTab({
  workspaceId,
  mode,
  role,
}: {
  workspaceId: string;
  mode: WorkspaceMode;
  role: Role | null;
}) {
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groundedMeta, setGroundedMeta] = useState<{ grounded: AgentGroundedOn; model: string; fake: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    getAgentHistory(workspaceId, mode, ac.signal).then(setTurns);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, loading]);

  const submit = useCallback(
    async (raw: string) => {
      const prompt = raw.trim();
      if (!prompt || loading) return;
      setError(null);
      setLoading(true);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const pending: AgentTurn = {
        id: `pending-${Date.now()}`,
        userId: "",
        role,
        prompt,
        answer: "",
        createdAt: Date.now(),
      };
      setTurns((t) => [...t, pending]);
      setInput("");

      try {
        const res = await askAgent(workspaceId, mode, prompt, ac.signal);
        if (res.ok) {
          setTurns((t) => t.map((x) => (x.id === pending.id ? { ...x, id: res.data.conversationId, answer: res.data.answer } : x)));
          setGroundedMeta({ grounded: res.data.groundedOn, model: res.data.model, fake: res.data.usedFakeAI });
        } else {
          setTurns((t) => t.filter((x) => x.id !== pending.id));
          setError(agentErrorText(res.error.code, res.error.error));
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setTurns((t) => t.filter((x) => x.id !== pending.id));
          setError("Network error — the agent could not be reached.");
        }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId, role, loading],
  );

  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-1">
        <h3 className="text-sm font-semibold text-text">Progress Agent</h3>
        <span className={meta}>Grounded in this workspace's current state. Read-only — it never changes anything.</span>
      </div>

      {role === null && <Banner tone="neutral">You have no role in this workspace, so the agent is unavailable.</Banner>}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {AGENT_QUICK_PROMPTS.map((q) => (
          <button key={q} className={btn("default")} disabled={loading || role === null} onClick={() => submit(q)}>
            {q}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="mb-3 max-h-96 overflow-y-auto rounded-lg border border-border bg-surface-muted/40 p-3">
        {turns.length === 0 && !loading && <p className={meta}>Ask a question, or use a quick prompt above.</p>}
        <div className="flex flex-col gap-3">
          {turns.map((turn) => (
            <div key={turn.id}>
              <div className="text-sm">
                <span className="font-medium text-accent">{turn.role ?? "you"}</span> {turn.prompt}
              </div>
              {turn.answer ? (
                <div className="mt-1 rounded-lg bg-surface p-2 text-sm shadow-sm">{turn.answer}</div>
              ) : loading ? (
                <div className={cn(meta, "mt-1 italic")}>thinking…</div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {groundedMeta && (
        <p className={cn(meta, "mb-3")}>
          grounded on {groundedMeta.grounded.activeTasks} active / {groundedMeta.grounded.doneTasks} done tasks · {groundedMeta.grounded.openBlockers} open
          blockers · {groundedMeta.grounded.updates} updates · {groundedMeta.grounded.feedback} feedback · {groundedMeta.grounded.retrievedHistory} historical ·{" "}
          {groundedMeta.grounded.retrievedDocuments} document {groundedMeta.grounded.retrievedDocuments === 1 ? "chunk" : "chunks"} · state{" "}
          {timeAgo(groundedMeta.grounded.contextGeneratedAt)} · model <code>{groundedMeta.model}</code>
          {groundedMeta.fake && " (offline stub)"}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea
          className={cn(textarea, "flex-1")}
          value={input}
          rows={2}
          maxLength={AGENT_PROMPT_MAX}
          placeholder="Ask about tasks, blockers, recent progress, mentor prep…"
          disabled={role === null}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(input);
          }}
        />
        <button className={btn("primary")} disabled={loading || !input.trim() || role === null} onClick={() => submit(input)}>
          {loading ? "…" : "Ask"}
        </button>
      </div>
    </section>
  );
}

function agentErrorText(code: string, fallback: string): string {
  switch (code) {
    case "empty_prompt":
      return "Please enter a question.";
    case "prompt_too_long":
      return `That prompt is too long (max ${AGENT_PROMPT_MAX} characters).`;
    case "unauthorized":
      return "You are not a member of this workspace.";
    case "workspace_missing":
      return "The agent could not read this workspace's state. Try again.";
    case "ai_unavailable":
      return "The AI service is currently unavailable. Try again shortly.";
    default:
      return fallback || "The agent hit an error.";
  }
}
