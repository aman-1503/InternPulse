import { useRef, useState } from "react";
import type { Attachment } from "../../../shared/protocol";
import type { WorkspaceState } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";
import { attachmentDownloadUrl, deleteAttachment, uploadAttachment } from "../../lib/attachments";
import type { WorkspaceMode } from "../../lib/workspaceApi";
import { badge, badgeTones, card, cn, meta, sectionTitle } from "../../ui/primitives";
import { Banner } from "../../ui/states";

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
        <div className="mb-3 flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            disabled={busy}
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
          {busy && <span className={meta}>uploading…</span>}
        </div>
      ) : (
        <p className={cn(meta, "mb-3")}>Your role can view and download files but not upload.</p>
      )}

      {err && (
        <div className="mb-3">
          <Banner tone="danger">{err}</Banner>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {files.map((f) => (
          <li key={f.id} className="rounded-lg border border-border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <a href={attachmentDownloadUrl(workspaceId, mode, f.id)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                {f.filename}
              </a>
              <span className={badge(badgeTones[INDEX_TONE[f.indexStatus]])}>{INDEX_LABEL[f.indexStatus]}</span>
              {f.indexStatus === "indexed" && f.chunkCount > 0 && <span className={meta}>· {f.chunkCount} chunks</span>}
            </div>
            <div className={cn(meta, "mt-1 flex items-center gap-2")}>
              {humanSize(f.size)} · {f.contentType || "unknown type"} · {f.uploaderName} · {timeAgo(f.createdAt)}
              {canWrite && (
                <button
                  className="text-danger hover:underline"
                  onClick={async () => {
                    if (!confirm(`Delete "${f.filename}"?`)) return;
                    try {
                      await deleteAttachment(workspaceId, mode, f.id);
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  delete
                </button>
              )}
            </div>
          </li>
        ))}
        {files.length === 0 && <li className={meta}>No files uploaded yet.</li>}
      </ul>
    </section>
  );
}
