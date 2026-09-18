import type { Attachment } from "../../shared/protocol";
import { identityQuery, withQuery, workspaceBase, type WorkspaceMode } from "./workspaceApi";

export async function uploadAttachment(workspaceId: string, mode: WorkspaceMode, file: File): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(withQuery(`${workspaceBase(workspaceId, mode)}/attachments`, identityQuery(mode)), {
    method: "POST",
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as { attachment?: Attachment; error?: string };
  if (!res.ok || !body.attachment) throw new Error(body.error || `upload failed (${res.status})`);
  return body.attachment;
}

export async function deleteAttachment(workspaceId: string, mode: WorkspaceMode, attachmentId: string): Promise<void> {
  const res = await fetch(
    withQuery(`${workspaceBase(workspaceId, mode)}/attachments/${attachmentId}`, identityQuery(mode)),
    { method: "DELETE" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `delete failed (${res.status})`);
  }
}

export function attachmentDownloadUrl(workspaceId: string, mode: WorkspaceMode, attachmentId: string): string {
  return withQuery(`${workspaceBase(workspaceId, mode)}/attachments/${attachmentId}/download`, identityQuery(mode));
}
