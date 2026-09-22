import type { WorkspaceMember } from "../../shared/protocol";

export interface MentionTrigger {
  /** Index of the "@" character in the full text. */
  at: number;
  /** Partial text typed after "@", up to the caret. */
  query: string;
}

/**
 * Finds the active "@partial" token ending at `caret`, or null if there
 * isn't one right now (no "@" before the caret on this line, the token
 * already has a trailing space, it contains a newline, or it's grown
 * unreasonably long without resolving to a pick).
 */
export function detectMentionTrigger(text: string, caret: number): MentionTrigger | null {
  const uptoCaret = text.slice(0, caret);
  const at = uptoCaret.lastIndexOf("@");
  if (at === -1) return null;
  const query = uptoCaret.slice(at + 1);
  if (query.includes("\n") || query.length > 40 || /\s$/.test(query)) return null;
  return { at, query };
}

/** Case-insensitive substring match against display name, capped for a compact dropdown. */
export function filterMentionCandidates(
  members: WorkspaceMember[],
  query: string,
  limit = 6,
): WorkspaceMember[] {
  const q = query.toLowerCase();
  return members.filter((m) => m.displayName.toLowerCase().includes(q)).slice(0, limit);
}

/** The exact text inserted for a picked member — must match src/shared/mentions.ts's "@Display Name" form. */
export function mentionInsertionText(member: WorkspaceMember): string {
  return `@${member.displayName} `;
}
