/**
 * Phase 4A history-index queue consumer.
 *
 * For each compact `history.index` event: re-read the CURRENT authoritative
 * entity from WorkspaceDO, embed it with Workers AI, and upsert into Vectorize.
 * If the entity is gone, remove any stale vector. Never invents data, never
 * writes workspace state.
 */

import {
  INDEXABLE_ENTITY_TYPES,
  type HistoryIndexEvent,
  type WorkflowEventMessage,
} from "../shared/protocol";
import { toMetadata, vectorId } from "./history-index";

const WORKSPACE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

type EmbeddingRunner = {
  run: (model: string, input: { text: string | string[] }) => Promise<{ data?: number[][] }>;
};

export async function handleHistoryIndexBatch(
  batch: MessageBatch<HistoryIndexEvent>,
  env: Env,
): Promise<void> {
  // Same gate as the Progress Agent's model: offline / no creds => no-op.
  const disabled = String(env.AGENT_FAKE_AI ?? "") === "1" || !env.VECTORIZE || !env.AI;

  for (const message of batch.messages) {
    const evt = message.body;

    if (
      !evt ||
      !WORKSPACE_ID_RE.test(evt.workspaceId ?? "") ||
      !INDEXABLE_ENTITY_TYPES.includes(evt.entityType) ||
      typeof evt.entityId !== "string" ||
      evt.entityId.length === 0
    ) {
      console.warn("history-index: malformed event, dropping", evt);
      message.ack();
      continue;
    }

    if (disabled) {
      console.log(`history-index: skipped (offline) ${evt.entityType} ${evt.entityId}`);
      message.ack();
      continue;
    }

    try {
      const id = vectorId(evt.workspaceId, evt.entityType, evt.entityId);

      // 1. Re-read the current authoritative entity (never trust the event body).
      const stub = env.WORKSPACE_DO.get(env.WORKSPACE_DO.idFromName(evt.workspaceId));
      const entity = await stub.getIndexableEntity(
        evt.workspaceId,
        evt.entityType,
        evt.entityId,
      );

      // 2. Gone / not indexable -> drop any stale vector, don't fabricate.
      if (!entity) {
        await env.VECTORIZE.deleteByIds([id]);
        console.log(`history-index: removed stale vector ${id}`);
        message.ack();
        continue;
      }

      // 3. Embed the current text.
      const ai = env.AI as unknown as EmbeddingRunner;
      const embed = await ai.run(env.HISTORY_EMBED_MODEL, { text: entity.text });
      const values = embed?.data?.[0];
      if (!values || values.length === 0) throw new Error("empty embedding");

      // 4. Upsert. Workspace isolation: namespace + metadata.workspaceId.
      await env.VECTORIZE.upsert([
        { id, values, namespace: evt.workspaceId, metadata: toMetadata(entity) },
      ]);
      message.ack();
    } catch (err) {
      console.error(`history-index: ${evt.entityType} ${evt.entityId} failed, retrying`, err);
      message.retry();
    }
  }
}

/**
 * Phase 4B: start durable Workflows from a queued reference event. Deterministic
 * instance ids make the start idempotent — a duplicate message (retry, or a
 * second blocker.created) is a safe no-op.
 */
export async function handleWorkflowEventBatch(
  batch: MessageBatch<WorkflowEventMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    const evt = message.body;
    try {
      if (evt?.kind !== "blocker.workflow.start") {
        console.warn("workflow-events: unknown message, dropping", evt);
        message.ack();
        continue;
      }
      if (!WORKSPACE_ID_RE.test(evt.workspaceId ?? "") || !evt.blockerId) {
        console.warn("workflow-events: malformed, dropping", evt);
        message.ack();
        continue;
      }

      const id = `blocker-${evt.blockerId}`;
      try {
        await env.BLOCKER_WORKFLOW.create({
          id,
          params: { workspaceId: evt.workspaceId, blockerId: evt.blockerId },
        });
        console.log(`workflow-events: started ${id}`);
      } catch (err) {
        // Deterministic id already used => the workflow is already running.
        if (/exist/i.test(String((err as Error)?.message ?? err))) {
          console.log(`workflow-events: ${id} already running (ok)`);
        } else {
          throw err;
        }
      }
      message.ack();
    } catch (err) {
      console.error("workflow-events: failed, retrying", err);
      message.retry();
    }
  }
}
