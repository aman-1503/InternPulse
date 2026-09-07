/**
 * Stage 1 (finish) — document text extraction + chunking for RAG.
 *
 * No new parser dependency: plain-text formats are read directly; everything
 * else goes through the Workers AI `toMarkdown` platform utility on the
 * existing `AI` binding. Files with no extractable text are still stored and
 * downloadable from R2 — they just don't get Vectorize chunks.
 */

export const CHUNK_CHARS = 1200;
export const CHUNK_OVERLAP = 150;
export const MAX_CHUNKS = 40;
/** Upload cap. Bytes above this are stored but not extracted. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|log|ya?ml|xml|html?|ini|toml)$/i;
const TEXT_MIME = /^text\/|^application\/(json|xml|x-yaml|yaml|csv|toml)/i;

const DOC_EXT = /\.(pdf|docx?|pptx?|xlsx?|numbers|pages|key|odt|rtf|png|jpe?g|webp|gif|bmp|svg)$/i;
const DOC_MIME = /^(application\/pdf|application\/vnd\.|application\/msword|image\/)/i;

export function isPlainText(filename: string, contentType: string): boolean {
  return TEXT_MIME.test(contentType || "") || TEXT_EXT.test(filename || "");
}

export function isToMarkdownCandidate(filename: string, contentType: string): boolean {
  return DOC_EXT.test(filename || "") || DOC_MIME.test(contentType || "");
}

/** Can we get text from this file with the current codebase/platform? */
export function isExtractable(filename: string, contentType: string): boolean {
  return isPlainText(filename, contentType) || isToMarkdownCandidate(filename, contentType);
}

/** Filesystem-safe filename for the R2 key and Content-Disposition. */
export function safeFilename(name: string): string {
  const cleaned = (name || "file")
    .replace(/[/\\]+/g, "_")
    .replace(/[^\w.\-() ]+/g, "")
    .trim()
    .slice(0, 200);
  return cleaned || "file";
}

/** R2 object key — scoped so workspace files can never collide. */
export function attachmentKey(workspaceId: string, attachmentId: string, filename: string): string {
  return `workspace/${workspaceId}/${attachmentId}/${safeFilename(filename)}`;
}

/** Conservative, overlapping chunks; prefers paragraph / sentence boundaries. */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];

  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(i + CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      const window = clean.slice(i, end);
      const brk = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("\n"),
      );
      if (brk > CHUNK_CHARS * 0.5) end = i + brk + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    i = Math.max(end - CHUNK_OVERLAP, i + 1);
  }
  return chunks;
}
