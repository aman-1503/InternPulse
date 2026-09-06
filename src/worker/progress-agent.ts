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
import { buildMessages, fakeAnswer, groundedOn } from "./agent-context";
import { MIN_SCORE, RETRIEVAL_TOP_K, toRetrievedItem } from "./history-index";

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

    // 3. Phase 4A: semantic retrieval over workspace history (retrieval only —
    //    scoped strictly to this workspace; current state above still wins).
    let retrieved: RetrievedHistoryItem[] = [];
    if (!useFake && this.env.VECTORIZE) {
      try {
        retrieved = await this.retrieveHistory(input.workspaceId, prompt);
      } catch (err) {
        console.error("history retrieval failed (non-fatal)", err);
      }
    }

    // 4. Build grounded chat messages (current context primary, history secondary).
    const messages = buildMessages(ctx, prompt, priorTurns, retrieved);

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
      groundedOn: groundedOn(ctx, retrieved.length),
      retrieved,
      conversationId: id,
    };
  }

  /**
   * Semantic retrieval over this workspace's history. Strictly scoped by
   * namespace AND metadata filter. Returns only a small, relevant set.
   */
  private async retrieveHistory(
    workspaceId: string,
    prompt: string,
  ): Promise<RetrievedHistoryItem[]> {
    const ai = this.env.AI as unknown as {
      run: (m: string, i: { text: string }) => Promise<{ data?: number[][] }>;
    };
    const embed = await ai.run(this.env.HISTORY_EMBED_MODEL, { text: prompt });
    const vector = embed?.data?.[0];
    if (!vector || vector.length === 0) return [];

    const res = await this.env.VECTORIZE.query(vector, {
      topK: RETRIEVAL_TOP_K,
      namespace: workspaceId,
      filter: { workspaceId },
      returnMetadata: "all",
    });

    const items: RetrievedHistoryItem[] = [];
    for (const match of res.matches ?? []) {
      if (typeof match.score === "number" && match.score < MIN_SCORE) continue;
      const item = toRetrievedItem(match);
      if (item && item.entityId) items.push(item);
    }
    return items;
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
