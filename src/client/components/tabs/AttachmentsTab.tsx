import { useRef, useState } from "react";
import type { Attachment } from "../../../shared/protocol";
import type { WorkspaceState } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";
import { attachmentDownloadUrl, deleteAttachment, uploadAttachment } from "../../lib/attachments";
import type { WorkspaceMode } from "../../lib/workspaceApi";
import { badge, badgeTones, card, cn, meta, metaXs, sectionTitle } from "../../ui/primitives";
import { Banner, EmptyState } from "../../ui/states";
import { FileIcon, UploadIcon } from "../../ui/icons";

const INDEX_LABEL: Record<Attachment["indexStatus"], string> = {
  pending: "indexing…",
  indexed: "searchable",
  unsupported: "stored (no text)",
  failed: "index failed",
  skipped: "stored (offline)",
};

const INDEX_TONE: Record<Attachment["indexStatus"], keyof typeof badgeTones> = {
  pending: "neutral",
  indexed: "success",
  unsupported: "neutral",
  failed: "danger",
  skipped: "warning",
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentsTab({
  state,
  workspaceId,
  mode,
}: {
  state: WorkspaceState;
  workspaceId: string;
  mode: WorkspaceMode;
}) {
  const role = state.you?.role ?? null;
  const canWrite = role === "intern" || role === "mentor";
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const files = [...state.attachments].sort((a, b) => b.createdAt - a.createdAt);
  const [dragOver, setDragOver] = useState(false);

  const onUpload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      await uploadAttachment(workspaceId, mode, file);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card}>
      <div className="mb-3">
        <h3 className={sectionTitle}>Attachments</h3>
        <span className={meta}>
          Files live in Cloudflare R2. Text-bearing files are chunked into the workspace's Vectorize index so the Progress Agent can
          cite them.
        </span>
      </div>

      {canWrite ? (
        <label
          className={cn(
            "mb-4 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            dragOver ? "border-accent bg-accent-muted/40" : "border-border hover:border-accent/50 hover:bg-surface-muted",
            busy && "pointer-events-none opacity-60",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onUpload(f);
          }}
        >
          <UploadIcon className="h-5 w-5 text-muted" />
          <span className="text-sm font-medium text-text">{busy ? "Uploading…" : "Drop a file here, or click to browse"}</span>
          <span className={metaXs}>Shared with everyone in this workspace</span>
          <input
            ref={fileRef}
            type="file"
            disabled={busy}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
        </label>
      ) : (
        <p className={cn(meta, "mb-3")}>Your role can view and download files but not upload.</p>
      )}

      {err && (
        <div className="mb-3">
          <Banner tone="danger">{err}</Banner>
        </div>
      )}

      {files.length === 0 ? (
        <EmptyState title="No files yet" description="Uploaded files will show up here for everyone in the workspace." />
      ) : (
        <ul className="flex flex-col gap-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-surface-muted/50">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted">
                <FileIcon />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={attachmentDownloadUrl(workspaceId, mode, f.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-medium text-accent hover:underline"
                  >
                    {f.filename}
                  </a>
                  <span className={badge(badgeTones[INDEX_TONE[f.indexStatus]])}>{INDEX_LABEL[f.indexStatus]}</span>
                  {f.indexStatus === "indexed" && f.chunkCount > 0 && <span className={metaXs}>· {f.chunkCount} chunks</span>}
                </div>
                <div className={cn(metaXs, "mt-1 flex flex-wrap items-center gap-x-2")}>
                  <span>{humanSize(f.size)}</span>
                  <span>· {f.contentType || "unknown type"}</span>
                  <span>· {f.uploaderName}</span>
                  <span>· {timeAgo(f.createdAt)}</span>
                </div>
              </div>
              {canWrite && (
                <button
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-danger hover:bg-danger-muted"
                  onClick={async () => {
                    if (!confirm(`Delete "${f.filename}"?`)) return;
                    try {
                      await deleteAttachment(workspaceId, mode, f.id);
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
