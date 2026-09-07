/**
 * ProgressAgent — one stateful AI agent per internship/project workspace.
 *
 * Cloudflare Agents SDK (a SQLite-backed Durable Object). Addressed by the
 * workspace id, exactly like WorkspaceDO, via `getAgentByName(env.PROGRESS_AGENT,
 * workspaceId)`.
 *
 * Responsibilities:
 *  - on each question, pull a fresh BOUNDED projection of authoritative state
 *    from WorkspaceDO via DO-to-DO RPC (no HTTP, no copy of the workspace DB)
 *  - keep only lightweight conversation history in its own SQLite
 *  - call Workers AI for inference (or a deterministic offline stub)
 *
 * It never mutates workspace state and never becomes a second source of truth.
 */

import { Agent } from "agents";
import {
  AGENT_PROMPT_MAX,
  type AgentAskResponse,
  type AgentContext,
  type AgentErrorResponse,
  type AgentTurn,
  type RetrievedHistoryItem,
  type Role,
} from "../shared/protocol";
import { buildMessages, fakeAnswer, groundedOn, renderContextBlock } from "./agent-context";
import {
  MIN_SCORE,
  RETRIEVAL_TOP_K,
  renderDocumentBlock,
  renderHistoryBlock,
  toRetrievedItem,
} from "./history-index";
import {
  blockerEscalationText,
  blockerReminderText,
  deterministicWeeklyDraft,
} from "./reminders";

const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const MAX_OUTPUT_TOKENS = 512;
const HISTORY_LIMIT = 6;

interface AgentState {
  totalAsks: number;
  lastModel: string | null;
  lastAskedAt: number | null;
}

export interface AskInput {
  workspaceId: string;
  userId: string;
  displayName: string;
  role: Role | null;
  prompt: string;
}

type Row = Record<string, unknown>;

export class ProgressAgent extends Agent<Env, AgentState> {
  static initialState: AgentState = { totalAsks: 0, lastModel: null, lastAskedAt: null };

  onStart(): void {
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS conversations (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        role       TEXT,
        prompt     TEXT NOT NULL,
        answer     TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `;
  }

  /** Conversation history for one user in this workspace, chronological. */
  async history(userId: string, limit = 20): Promise<AgentTurn[]> {
    this.ensureSchema();
    const rows = this.sql<Row>`
      SELECT * FROM conversations WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows.map(toTurn).reverse();
  }

  /** Answer a question grounded in current authoritative workspace state. */
  async ask(input: AskInput): Promise<AgentAskResponse | AgentErrorResponse> {
    this.ensureSchema();

    const prompt = (input.prompt ?? "").trim();
    if (!prompt) return { error: "prompt is empty", code: "empty_prompt" };
    if (prompt.length > AGENT_PROMPT_MAX) {
      return { error: `prompt exceeds ${AGENT_PROMPT_MAX} characters`, code: "prompt_too_long" };
    }

    // 1. Fresh, bounded context from the authoritative WorkspaceDO (DO-to-DO RPC).
    let ctx: AgentContext;
    try {
      const stub = this.env.WORKSPACE_DO.get(
        this.env.WORKSPACE_DO.idFromName(input.workspaceId),
      );
      ctx = await stub.getAgentContext(input.workspaceId, input.role, input.displayName);
    } catch (err) {
      console.error("getAgentContext failed", err);
      return { error: "could not read workspace state", code: "workspace_missing" };
    }

    // 2. Recent conversation turns for this user.
    const priorRows = this.sql<Row>`
      SELECT * FROM conversations WHERE user_id = ${input.userId}
      ORDER BY created_at DESC LIMIT ${HISTORY_LIMIT}
    `;
    const priorTurns = priorRows.map(toTurn).reverse();

    const model = this.env.PROGRESS_AGENT_MODEL || DEFAULT_MODEL;
    const useFake = String(this.env.AGENT_FAKE_AI ?? "") === "1" || !this.env.AI;

    // 3. Semantic retrieval over this workspace's history + uploaded documents
    //    (retrieval only, scoped strictly to this workspace; current state wins).
    //    History and documents are queried separately so a busy history can't
    //    crowd out a relevant document (and vice versa).
    let history: RetrievedHistoryItem[] = [];
    let documents: RetrievedHistoryItem[] = [];
    if (!useFake && this.env.VECTORIZE) {
      try {
        ({ history, documents } = await this.retrieve(input.workspaceId, prompt));
      } catch (err) {
        console.error("retrieval failed (non-fatal)", err);
      }
    }
    const retrieved: RetrievedHistoryItem[] = [...history, ...documents];

    // 4. Build grounded chat messages (current context primary; history + docs supporting).
    const messages = buildMessages(ctx, prompt, priorTurns, history, documents);

    // 5. Inference — real model, or deterministic offline stub.
    let answer: string;
    if (useFake) {
      answer = fakeAnswer(ctx, prompt);
    } else {
      try {
        // Call `.run` as a method on the AI binding — it relies on `this`.
        const ai = this.env.AI as {
          run: (m: string, i: unknown) => Promise<{ response?: string }>;
        };
        const out = await ai.run(model, { messages, max_tokens: MAX_OUTPUT_TOKENS });
        answer = (out?.response ?? "").trim();
        if (!answer) return { error: "model returned no text", code: "agent_error" };
      } catch (err) {
        console.error("Workers AI call failed", err);
        return { error: "the AI service is currently unavailable", code: "ai_unavailable" };
      }
    }

    // 6. Persist the turn (lightweight; not workspace business data).
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.sql`
      INSERT INTO conversations (id, user_id, role, prompt, answer, created_at)
      VALUES (${id}, ${input.userId}, ${input.role}, ${prompt}, ${answer}, ${createdAt})
    `;
    this.setState({
      totalAsks: (this.state?.totalAsks ?? 0) + 1,
      lastModel: useFake ? "fake-ai" : model,
      lastAskedAt: createdAt,
    });

    return {
      answer,
      model: useFake ? "fake-ai" : model,
      usedFakeAI: useFake,
      role: input.role,
      groundedOn: groundedOn(ctx, history.length, documents.length),
      retrieved,
      conversationId: id,
    };
  }

  /**
   * Semantic retrieval over this workspace's history. Strictly scoped by
   * namespace AND metadata filter. Returns only a small, relevant set.
   */
  private async retrieve(
    workspaceId: string,
    prompt: string,
  ): Promise<{ history: RetrievedHistoryItem[]; documents: RetrievedHistoryItem[] }> {
    const ai = this.env.AI as unknown as {
      run: (m: string, i: { text: string }) => Promise<{ data?: number[][] }>;
    };
    const embed = await ai.run(this.env.HISTORY_EMBED_MODEL, { text: prompt });
    const vector = embed?.data?.[0];
    if (!vector || vector.length === 0) return { history: [], documents: [] };

    const base = { namespace: workspaceId, returnMetadata: "all" as const };
    const [histRes, docRes] = await Promise.all([
      this.env.VECTORIZE.query(vector, {
        ...base,
        topK: RETRIEVAL_TOP_K + 1,
        filter: { workspaceId, entityType: { $in: ["UPDATE", "BLOCKER", "FEEDBACK"] } },
      }),
      this.env.VECTORIZE.query(vector, {
        ...base,
        topK: RETRIEVAL_TOP_K,
        filter: { workspaceId, entityType: "DOCUMENT" },
      }),
    ]);

    const keep = (res: { matches?: Array<{ score: number; metadata?: Record<string, unknown> | null }> }) => {
      const out: RetrievedHistoryItem[] = [];
      for (const match of res.matches ?? []) {
        if (typeof match.score === "number" && match.score < MIN_SCORE) continue;
        const item = toRetrievedItem(match);
        if (item && item.entityId) out.push(item);
      }
      return out;
    };
    return { history: keep(histRes), documents: keep(docRes) };
  }

  // -- Phase 4B: text drafting for workflows (SUGGEST only, never mutate) ---

  private useFake(): boolean {
    return String(this.env.AGENT_FAKE_AI ?? "") === "1" || !this.env.AI;
  }

  private async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
    const ai = this.env.AI as { run: (m: string, i: unknown) => Promise<{ response?: string }> };
    const model = this.env.PROGRESS_AGENT_MODEL || DEFAULT_MODEL;
    const out = await ai.run(model, { messages, max_tokens: MAX_OUTPUT_TOKENS });
    return (out?.response ?? "").trim();
  }

  /**
   * One-sentence reminder/escalation wording. Falls back to a deterministic
   * template if Workers AI is unavailable — a reminder is never skipped.
   */
  async draftBlockerReminder(
    workspaceId: string,
    blockerId: string,
    audience: "intern" | "mentor" | "manager",
  ): Promise<{ text: string; usedAI: boolean }> {
    const stub = this.env.WORKSPACE_DO.get(this.env.WORKSPACE_DO.idFromName(workspaceId));
    const blocker = await stub.getBlocker(blockerId);
    if (!blocker) {
      return { text: "A blocker referenced by a reminder no longer exists.", usedAI: false };
    }
    const template =
      audience === "manager"
        ? blockerEscalationText(blocker)
        : blockerReminderText(blocker, audience);

    if (this.useFake()) return { text: template, usedAI: false };
    try {
      const text = await this.chat([
        {
          role: "system",
          content:
            "Write ONE concise in-app reminder sentence. Do not claim any action was taken or that the blocker was resolved. No greeting, no sign-off.",
        },
        {
          role: "user",
          content: `Audience: ${audience}. Blocker (status ${blocker.status}, ${Math.max(
            0,
            Math.floor((Date.now() - blocker.createdAt) / 86_400_000),
          )}d old): ${blocker.description}`,
        },
      ]);
      return text ? { text, usedAI: true } : { text: template, usedAI: false };
    } catch (err) {
      console.error("draftBlockerReminder AI failed, using template", err);
      return { text: template, usedAI: false };
    }
  }

  /**
   * Weekly report draft: current authoritative context + RAG history. On AI
   * failure, returns a clearly-marked deterministic draft (aiGenerated:false).
   */
  async draftWeeklyReport(
    workspaceId: string,
    reportingPeriod: string,
  ): Promise<{ content: string; aiGenerated: boolean }> {
    this.ensureSchema();
    const stub = this.env.WORKSPACE_DO.get(this.env.WORKSPACE_DO.idFromName(workspaceId));
    const ctx: AgentContext = await stub.getAgentContext(workspaceId, null, "Weekly review");

    if (this.useFake()) {
      return { content: deterministicWeeklyDraft(reportingPeriod, ctx), aiGenerated: false };
    }

    let history: RetrievedHistoryItem[] = [];
    let documents: RetrievedHistoryItem[] = [];
    try {
      if (this.env.VECTORIZE) {
        ({ history, documents } = await this.retrieve(
          workspaceId,
          "weekly progress: accomplishments, current blockers, resolved blockers, mentor feedback, project documents, next steps",
        ));
      }
    } catch (err) {
      console.error("weekly retrieval failed (non-fatal)", err);
    }

    try {
      const content = await this.chat([
        {
          role: "system",
          content: [
            "Write a concise weekly progress report in Markdown for one internship workspace.",
            `Reporting period: ${reportingPeriod}.`,
            "Sections: ## Completed, ## In progress, ## Current open blockers, ## Historical context, ## Suggested next steps.",
            "CURRENT WORKSPACE STATE below is authoritative. HISTORICAL CONTEXT is older background retrieved by search and may be stale. DOCUMENT KNOWLEDGE is supporting reference from uploaded files.",
            "Clearly distinguish CURRENT open blockers from historical RESOLVED blockers — never present a resolved blocker as currently open.",
            "Do not invent tasks, blockers, names, dates or numbers. Do not rate anyone. Do not claim any action was taken.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "CURRENT WORKSPACE STATE (authoritative):",
            renderContextBlock(ctx),
            "",
            "HISTORICAL CONTEXT (retrieved; may be outdated):",
            renderHistoryBlock(history, ctx.generatedAt),
            "",
            "DOCUMENT KNOWLEDGE (uploaded files; supporting reference):",
            renderDocumentBlock(documents, ctx.generatedAt),
          ].join("\n"),
        },
      ]);
      if (!content) throw new Error("empty draft");
      return { content, aiGenerated: true };
    } catch (err) {
      console.error("draftWeeklyReport AI failed, using deterministic draft", err);
      return { content: deterministicWeeklyDraft(reportingPeriod, ctx), aiGenerated: false };
    }
  }
}

function toTurn(r: Row): AgentTurn {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    role: (r.role as Role | null) ?? null,
    prompt: String(r.prompt),
    answer: String(r.answer),
    createdAt: Number(r.created_at),
  };
}
