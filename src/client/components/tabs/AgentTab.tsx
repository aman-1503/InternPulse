import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENT_QUICK_PROMPTS,
  AGENT_PROMPT_MAX,
  type AgentGroundedOn,
  type AgentTurn,
  type Role,
} from "../../../shared/protocol";
import { timeAgo } from "../../lib/format";
import { askAgent, getAgentHistory } from "../../lib/agentClient";

interface Identity {
  userId: string;
  displayName: string;
}

/**
 * The Progress Agent panel. Text in -> grounded answer out. All reasoning
 * happens server-side against authoritative WorkspaceDO state; this component
 * only renders the conversation.
 */
export function AgentTab({
  workspaceId,
  identity,
  devRole,
  role,
}: {
  workspaceId: string;
  identity: Identity;
  devRole: string;
  role: Role | null;
}) {
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ grounded: AgentGroundedOn; model: string; fake: boolean } | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    getAgentHistory(workspaceId, identity, devRole, ac.signal).then(setTurns);
    return () => ac.abort();
  }, [workspaceId, identity, devRole]);

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

      // optimistic user turn
      const pending: AgentTurn = {
        id: `pending-${Date.now()}`,
        userId: identity.userId,
        role,
        prompt,
        answer: "",
        createdAt: Date.now(),
      };
      setTurns((t) => [...t, pending]);
      setInput("");

      try {
        const res = await askAgent(workspaceId, identity, devRole, prompt, ac.signal);
        if (res.ok) {
          setTurns((t) =>
            t.map((x) => (x.id === pending.id ? { ...x, id: res.data.conversationId, answer: res.data.answer } : x)),
          );
          setMeta({ grounded: res.data.groundedOn, model: res.data.model, fake: res.data.usedFakeAI });
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
    [workspaceId, identity, devRole, role, loading],
  );

  return (
    <section className="card agent">
      <div className="agent-head">
        <h3>Progress Agent</h3>
        <span className="meta">
          Grounded in this workspace's current state. Read-only — it suggests, it never changes anything.
        </span>
      </div>

      {role === null && (
        <div className="banner">
          You have no role in this workspace, so the agent is unavailable. Pick a seeded identity or a dev
          role.
        </div>
      )}

      <div className="agent-quick">
        {AGENT_QUICK_PROMPTS.map((q) => (
          <button key={q} disabled={loading || role === null} onClick={() => submit(q)}>
            {q}
          </button>
        ))}
      </div>

      <div className="agent-thread" ref={scrollRef}>
        {turns.length === 0 && !loading && (
          <p className="meta">Ask a question, or use a quick prompt above.</p>
        )}
        {turns.map((turn) => (
          <div key={turn.id} className="agent-turn">
            <div className="agent-q">
              <span className="who">{turn.role ?? "you"}</span> {turn.prompt}
            </div>
            {turn.answer ? (
              <div className="agent-a">{turn.answer}</div>
            ) : loading ? (
              <div className="agent-a thinking">thinking…</div>
            ) : null}
          </div>
        ))}
      </div>

      {error && <div className="banner error">{error}</div>}

      {meta && (
        <p className="meta agent-grounded">
          grounded on {meta.grounded.activeTasks} active / {meta.grounded.doneTasks} done tasks ·{" "}
          {meta.grounded.openBlockers} open blockers · {meta.grounded.updates} updates ·{" "}
          {meta.grounded.feedback} feedback · {meta.grounded.retrievedHistory} historical ·{" "}
          {meta.grounded.retrievedDocuments} document{" "}
          {meta.grounded.retrievedDocuments === 1 ? "chunk" : "chunks"} · state{" "}
          {timeAgo(meta.grounded.contextGeneratedAt)} · model <code>{meta.model}</code>
          {meta.fake && " (offline stub)"}
        </p>
      )}

      <div className="agent-input">
        <textarea
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
        <button className="primary" disabled={loading || !input.trim() || role === null} onClick={() => submit(input)}>
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
