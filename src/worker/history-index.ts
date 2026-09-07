/**
 * Phase 4A history index — pure helpers shared by the queue consumer and the
 * ProgressAgent retrieval step.
 *
 * Vectorize holds embeddings + minimal metadata for retrieval ONLY. It is never
 * a source of truth: the authoritative record always lives in WorkspaceDO SQLite
 * and is re-read before every embed.
 */

import type {
  Blocker,
  Feedback,
  IndexableEntity,
  IndexableEntityType,
  ProgressUpdate,
  RetrievedEntityType,
  RetrievedHistoryItem,
} from "../shared/protocol";

/** Kept in metadata so a retrieved item can be shown without a second DB round-trip. */
export const SNIPPET_MAX = 240;
/** Small on purpose — historical context supplements, never floods, the prompt. */
export const RETRIEVAL_TOP_K = 4;
/** Ignore weak matches so unrelated history doesn't leak into the answer. */
export const MIN_SCORE = 0.35;

export const clipSnippet = (s: string): string =>
  s.length > SNIPPET_MAX ? s.slice(0, SNIPPET_MAX - 1).trimEnd() + "…" : s;

/** Deterministic vector id so re-indexing an entity overwrites in place. */
export function vectorId(
  workspaceId: string,
  entityType: IndexableEntityType,
  entityId: string,
): string {
  return `${workspaceId}::${entityType}::${entityId}`;
}

/** The text handed to the embedding model for each entity type. */
export function updateText(u: ProgressUpdate): string {
  return `Progress update (${u.type}) by ${u.authorName}: ${u.content}`;
}
export function blockerText(b: Blocker): string {
  return `Blocker (${b.status}): ${b.description}`;
}
export function feedbackText(f: Feedback): string {
  return `Mentor feedback by ${f.authorName}: ${f.content}`;
}

/** Vectorize metadata — minimal + useful, no large duplicate record. */
export function toMetadata(entity: IndexableEntity): Record<string, string | number> {
  const meta: Record<string, string | number> = {
    workspaceId: entity.workspaceId,
    entityType: entity.entityType,
    entityId: entity.entityId,
    createdAt: entity.createdAt,
    snippet: clipSnippet(entity.text),
  };
  if (entity.authorId) meta.authorId = entity.authorId;
  if (entity.status) meta.status = entity.status;
  return meta;
}

/** Turn a Vectorize match into the internal/debug shape (no vector values). */
export function toRetrievedItem(match: {
  score: number;
  metadata?: Record<string, unknown> | null;
}): RetrievedHistoryItem | null {
  const m = match.metadata ?? {};
  const entityType = m.entityType as RetrievedEntityType | undefined;
  const entityId = m.entityId as string | undefined;
  if (!entityType || !entityId) return null;
  return {
    entityType,
    entityId,
    score: Math.round(match.score * 1000) / 1000,
    createdAt: typeof m.createdAt === "number" ? m.createdAt : 0,
    status: typeof m.status === "string" ? m.status : null,
    snippet: typeof m.snippet === "string" ? m.snippet : "",
    filename: typeof m.filename === "string" ? m.filename : undefined,
    chunkIndex: typeof m.chunkIndex === "number" ? m.chunkIndex : undefined,
  };
}

const DAY = 86_400_000;
const ageLabel = (ts: number, now: number) =>
  ts ? `${Math.max(0, Math.floor((now - ts) / DAY))}d ago` : "unknown age";

/** Rendered HISTORICAL-CONTEXT block (UPDATE/BLOCKER/FEEDBACK) for the prompt. */
export function renderHistoryBlock(items: RetrievedHistoryItem[], now = Date.now()): string {
  if (items.length === 0) return "(no relevant history retrieved)";
  return items
    .map((it) => {
      const status = it.status ? ` [${it.status}]` : "";
      return `- ${it.entityType}${status}, ${ageLabel(it.createdAt, now)} (relevance ${it.score}): ${it.snippet}`;
    })
    .join("\n");
}

/** Rendered DOCUMENT-KNOWLEDGE block for the prompt. */
export function renderDocumentBlock(items: RetrievedHistoryItem[], now = Date.now()): string {
  if (items.length === 0) return "(no relevant document passages retrieved)";
  return items
    .map(
      (it) =>
        `- "${it.filename ?? "document"}" (chunk ${it.chunkIndex ?? 0}, uploaded ${ageLabel(it.createdAt, now)}, relevance ${it.score}): ${it.snippet}`,
    )
    .join("\n");
}
