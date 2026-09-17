import type { Attachment } from "../../shared/protocol";

interface Identity {
  userId: string;
  displayName: string;
}

function qs(identity: Identity, devRole: string): string {
  const p = new URLSearchParams({ userId: identity.userId, displayName: identity.displayName });
  if (devRole) p.set("devRole", devRole);
  return p.toString();
}

const base = (workspaceId: string) =>
  `/api/demo/workspace/${encodeURIComponent(workspaceId)}/attachments`;

export async function uploadAttachment(
  workspaceId: string,
  identity: Identity,
  devRole: string,
  file: File,
): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${base(workspaceId)}?${qs(identity, devRole)}`, {
    method: "POST",
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as { attachment?: Attachment; error?: string };
  if (!res.ok || !body.attachment) throw new Error(body.error || `upload failed (${res.status})`);
  return body.attachment;
}

export async function deleteAttachment(
  workspaceId: string,
  identity: Identity,
  devRole: string,
  attachmentId: string,
): Promise<void> {
  const res = await fetch(`${base(workspaceId)}/${attachmentId}?${qs(identity, devRole)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `delete failed (${res.status})`);
  }
}

export function attachmentDownloadUrl(
  workspaceId: string,
  identity: Identity,
  devRole: string,
  attachmentId: string,
): string {
  return `${base(workspaceId)}/${attachmentId}/download?${qs(identity, devRole)}`;
}
