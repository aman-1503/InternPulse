import { useMemo, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from "react";
import type { WorkspaceMember } from "../../shared/protocol";

/**
 * Minimal @mention autocomplete: detects an active "@partial" token around
 * the caret, offers matching workspace members, and inserts the exact
 * "@Display Name " form the shared parser (src/shared/mentions.ts) matches.
 * Deliberately not a full rich-text editor — plain textarea/input value
 * manipulation via selectionStart/selectionEnd.
 */
export function useMentionSuggestions(
  value: string,
  onChange: (next: string) => void,
  members: WorkspaceMember[],
  fieldRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>,
) {
  const [triggerIndex, setTriggerIndex] = useState<number | null>(null);
  const [query, setQuery] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return members.filter((m) => m.displayName.toLowerCase().includes(q)).slice(0, 6);
  }, [query, members]);

  const close = () => {
    setTriggerIndex(null);
    setQuery(null);
  };

  const detect = (text: string, caret: number) => {
    const uptoCaret = text.slice(0, caret);
    const at = uptoCaret.lastIndexOf("@");
    if (at === -1) return close();
    const after = uptoCaret.slice(at + 1);
    // Stop suggesting once the token looks "done" (newline, too long, or a
    // trailing space after some non-space text already typed).
    if (after.includes("\n") || after.length > 40 || /\s$/.test(after)) return close();
    setTriggerIndex(at);
    setQuery(after);
  };

  const insert = (member: WorkspaceMember) => {
    if (triggerIndex === null) return;
    const el = fieldRef.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, triggerIndex);
    const after = value.slice(caret);
    const inserted = `@${member.displayName} `;
    onChange(before + inserted + after);
    close();
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      el?.focus();
      el?.setSelectionRange?.(pos, pos);
    });
  };

  const onFieldChange = (e: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    onChange(e.target.value);
    detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
  };

  const onFieldKeyUp = (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const el = e.currentTarget;
    detect(el.value, el.selectionStart ?? el.value.length);
  };

  return { suggestions, open: suggestions.length > 0, close, insert, onFieldChange, onFieldKeyUp };
}
