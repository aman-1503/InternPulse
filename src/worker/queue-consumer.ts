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
  type DocumentIndexEvent,
  type HistoryIndexEvent,
  type WorkflowEventMessage,
} from "../shared/protocol";
import { toMetadata, vectorId } from "./history-index";
import {
  MAX_CHUNKS,
  attachmentKey,
  chunkText,
  isPlainText,
} from "./documents";

const WORKSPACE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SNIPPET_MAX = 240;
const clipSnip = (s: string) => (s.length > SNIPPET_MAX ? s.slice(0, SNIPPET_MAX - 1) + "…" : s);

type EmbeddingRunner = {
  run: (model: string, input: { text: string | string[] }) => Promise<{ data?: number[][] }>;
};

export async function handleHistoryIndexBatch(
  batch: MessageBatch<HistoryIndexEvent | DocumentIndexEvent>,
  env: Env,
): Promise<void> {
  // Same gate as the Progress Agent's model: offline / no creds => no-op.
  const disabled = String(env.AGENT_FAKE_AI ?? "") === "1" || !env.VECTORIZE || !env.AI;

  for (const message of batch.messages) {
    const raw = message.body;

    // -- document chunks (Stage 1 finish) ----------------------------
    if (raw && (raw as DocumentIndexEvent).document === true) {
      await indexDocument(raw as DocumentIndexEvent, env, disabled, message);
      continue;
    }

    const evt = raw as HistoryIndexEvent;
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
 * Extract text from an uploaded R2 document, chunk it, embed the chunks, and
 * upsert them into Vectorize tagged as DOCUMENT. Attachment metadata (index
 * status) is written back to WorkspaceDO. R2 holds the only copy of the bytes.
 */
async function indexDocument(
  evt: DocumentIndexEvent,
  env: Env,
  disabled: boolean,
  message: Message<HistoryIndexEvent | DocumentIndexEvent>,
): Promise<void> {
  if (!WORKSPACE_ID_RE.test(evt.workspaceId ?? "") || !evt.attachmentId) {
    console.warn("doc-index: malformed event, dropping", evt);
    message.ack();
    return;
  }

  const stub = env.WORKSPACE_DO.get(env.WORKSPACE_DO.idFromName(evt.workspaceId));
  const setStatus = (s: Parameters<typeof stub.setAttachmentIndex>[1], n: number) =>
    stub.setAttachmentIndex(evt.attachmentId, s, n);

  try {
    const att = await stub.getAttachment(evt.attachmentId);
    if (!att) {
      // deleted before indexing — clear any partial vectors
      await env.VECTORIZE.deleteByIds(
        Array.from({ length: MAX_CHUNKS }, (_, i) => `doc::${evt.workspaceId}::${evt.attachmentId}::${i}`),
      );
      message.ack();
      return;
    }

    if (disabled) {
      await setStatus("skipped", 0);
      console.log(`doc-index: skipped (offline) ${att.filename}`);
      message.ack();
      return;
    }

    const key = attachmentKey(evt.workspaceId, evt.attachmentId, att.filename);
    const obj = await env.ATTACHMENTS.get(key);
    if (!obj) {
      await setStatus("failed", 0);
      message.ack();
      return;
    }

    let text = "";
    try {
      if (isPlainText(att.filename, att.contentType)) {
        text = await obj.text();
      } else {
        const blob = await obj.blob();
        const toMarkdown = (env.AI as unknown as {
          toMarkdown: (docs: Array<{ name: string; blob: Blob }>) => Promise<
            Array<{ name: string; format: string; data?: string }>
          >;
        }).toMarkdown;
        const results = await toMarkdown([{ name: att.filename, blob }]);
        const first = Array.isArray(results) ? results[0] : results;
        if (first && first.format !== "error" && first.data) text = String(first.data);
      }
    } catch (err) {
      console.error(`doc-index: extraction failed for ${att.filename}`, err);
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      await setStatus("unsupported", 0);
      console.log(`doc-index: no extractable text for ${att.filename}`);
      message.ack();
      return;
    }

    // Embed one chunk per call (mirrors the entity indexer; avoids batch quirks
    // in the remote-binding proxy).
    const ai = env.AI as unknown as EmbeddingRunner;
    const vectors: number[][] = [];
    for (const chunk of chunks) {
      const embed = await ai.run(env.HISTORY_EMBED_MODEL, { text: chunk });
      const v = embed?.data?.[0];
      if (!v || v.length === 0) throw new Error("empty embedding");
      vectors.push(v);
    }

    await env.VECTORIZE.upsert(
      chunks.map((chunk, i) => ({
        id: `doc::${evt.workspaceId}::${evt.attachmentId}::${i}`,
        values: vectors[i],
        namespace: evt.workspaceId,
        metadata: {
          workspaceId: evt.workspaceId,
          entityType: "DOCUMENT",
          entityId: evt.attachmentId,
          attachmentId: evt.attachmentId,
          chunkIndex: i,
          filename: att.filename,
          createdAt: att.createdAt,
          snippet: clipSnip(chunk),
        },
      })),
    );

    await setStatus("indexed", chunks.length);
    console.log(`doc-index: ${att.filename} -> ${chunks.length} chunks`);
    message.ack();
  } catch (err) {
    console.error(`doc-index: ${evt.attachmentId} failed, retrying`, err);
    message.retry();
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
