import { useCallback, useEffect, useRef, useState } from "react";
import { AGENT_QUICK_PROMPTS, AGENT_PROMPT_MAX, type AgentGroundedOn, type AgentTurn, type Role } from "../../../shared/protocol";
import { timeAgo } from "../../lib/format";
import { askAgent, getAgentHistory } from "../../lib/agentClient";
import type { WorkspaceMode } from "../../lib/workspaceApi";
import { btn, card, cn, meta, metaXs, textarea } from "../../ui/primitives";
import { Banner } from "../../ui/states";
import { SparkleIcon } from "../../ui/icons";

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
    <section className={cn(card, "flex flex-col")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-muted text-accent">
            <SparkleIcon className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-text">Progress Agent</h3>
            <p className={metaXs}>Grounded in this workspace's current state · read-only</p>
          </div>
        </div>
      </div>

      {role === null && <Banner tone="neutral">You have no role in this workspace, so the agent is unavailable.</Banner>}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {AGENT_QUICK_PROMPTS.map((q) => (
          <button key={q} className={cn(btn("default"), "rounded-full")} disabled={loading || role === null} onClick={() => submit(q)}>
            {q}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="mb-3 max-h-96 min-h-48 overflow-y-auto rounded-lg border border-border bg-surface-muted/40 p-3">
        {turns.length === 0 && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-1 py-6 text-center">
            <SparkleIcon className="h-5 w-5 text-muted" />
            <p className={cn(meta, "font-medium text-text")}>Ask the Progress Agent anything about this workspace</p>
            <p className={metaXs}>It can summarize progress, surface blockers, or help you prep for a 1:1 — grounded in real workspace data.</p>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {turns.map((turn) => (
            <div key={turn.id} className="flex flex-col gap-1.5">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-accent px-3 py-2 text-sm text-white shadow-sm">{turn.prompt}</div>
              </div>
              {turn.answer ? (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-border bg-surface px-3 py-2 text-sm shadow-sm">
                    {turn.answer}
                  </div>
                </div>
              ) : loading ? (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-border bg-surface px-3 py-2.5">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
                  </div>
                </div>
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
        <p className={cn(metaXs, "mb-3 border-t border-border pt-2")}>
          Grounded on {groundedMeta.grounded.activeTasks} active / {groundedMeta.grounded.doneTasks} done tasks · {groundedMeta.grounded.openBlockers} open
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
