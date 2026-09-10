/**
 * Deterministic @mention parsing against the current workspace roster.
 * Dependency-free so both the client (autocomplete/highlight) and the worker
 * (mention creation) share one definition of what counts as a valid mention.
 * No external/arbitrary users — only current workspace members ever match.
 *
 * Two equivalent forms are accepted for the same member:
 *   "@AliceChen"   — the collapsed, space-free handle (stable, easy to type)
 *   "@Alice Chen"  — the exact display name (natural, what autocomplete inserts)
 */

/** "Alice Chen" -> "alicechen". Stable, case-insensitive, no punctuation. */
export function deriveHandle(displayName: string): string {
  return displayName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

export interface MentionCandidate {
  userId: string;
  handle: string;
  /** Optional: enables matching the natural "@Full Name" form too. */
  displayName?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns the distinct set of mentioned userIds found in `text`, matching
 * `@<handle>` or `@<Display Name>` against `members`. Self-mentions are
 * included in the result — callers decide whether to notify the author.
 */
export function parseMentions(text: string, members: MentionCandidate[]): string[] {
  if (!text || members.length === 0) return [];

  // Longest alternative first so "@alicechen" / "@Alice Chen" isn't shadowed
  // by a shorter overlapping candidate.
  const alternatives = members
    .flatMap((m) => {
      const forms = [m.handle];
      if (m.displayName) forms.push(m.displayName);
      return forms.filter(Boolean).map((form) => ({ userId: m.userId, form }));
    })
    .sort((a, b) => b.form.length - a.form.length);

  if (alternatives.length === 0) return [];

  const pattern = new RegExp(
    `@(${alternatives.map((a) => escapeRegExp(a.form)).join("|")})(?![a-zA-Z0-9])`,
    "gi",
  );

  const matches = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const hitText = m[1].toLowerCase();
    const hit = alternatives.find((a) => a.form.toLowerCase() === hitText);
    if (hit) matches.add(hit.userId);
  }
  return Array.from(matches);
}
