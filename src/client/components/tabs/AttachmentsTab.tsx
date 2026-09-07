import { useRef, useState } from "react";
import type { Attachment } from "../../../shared/protocol";
import type { WorkspaceState } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";
import {
  attachmentDownloadUrl,
  deleteAttachment,
  uploadAttachment,
} from "../../lib/attachments";

interface Identity {
  userId: string;
  displayName: string;
}

const INDEX_LABEL: Record<Attachment["indexStatus"], string> = {
  pending: "indexing…",
  indexed: "searchable",
  unsupported: "stored (no text)",
  failed: "index failed",
  skipped: "stored (offline)",
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentsTab({
  state,
  workspaceId,
  identity,
  devRole,
}: {
  state: WorkspaceState;
  workspaceId: string;
  identity: Identity;
  devRole: string;
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
      await uploadAttachment(workspaceId, identity, devRole, file);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="attachments-head">
        <h3>Attachments</h3>
        <span className="meta">
          Files live in Cloudflare R2. Text-bearing files are chunked into the workspace's
          Vectorize index so the Progress Agent can cite them.
        </span>
      </div>

      {canWrite ? (
        <div className="row">
          <input
            ref={fileRef}
            type="file"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
          {busy && <span className="meta">uploading…</span>}
        </div>
      ) : (
        <p className="meta">Your role can view and download files but not upload.</p>
      )}

      {err && <div className="banner error">{err}</div>}

      <ul className="list attachments-list">
        {files.map((f) => (
          <li key={f.id}>
            <div className="attachment-main">
              <a
                href={attachmentDownloadUrl(workspaceId, identity, devRole, f.id)}
                target="_blank"
                rel="noreferrer"
              >
                {f.filename}
              </a>
              <span className={`badge idx-${f.indexStatus}`}>{INDEX_LABEL[f.indexStatus]}</span>
              {f.indexStatus === "indexed" && f.chunkCount > 0 && (
                <span className="meta">· {f.chunkCount} chunks</span>
              )}
            </div>
            <div className="meta attachment-meta">
              {humanSize(f.size)} · {f.contentType || "unknown type"} · {f.uploaderName} ·{" "}
              {timeAgo(f.createdAt)}
              {canWrite && (
                <button
                  className="link-danger"
                  onClick={async () => {
                    if (!confirm(`Delete "${f.filename}"?`)) return;
                    try {
                      await deleteAttachment(workspaceId, identity, devRole, f.id);
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
        {files.length === 0 && <li className="meta">No files uploaded yet.</li>}
      </ul>
    </section>
  );
}
