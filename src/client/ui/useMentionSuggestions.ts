import { useCallback, useMemo, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from "react";
import type { WorkspaceMember } from "../../shared/protocol";
import { detectMentionTrigger, filterMentionCandidates, mentionInsertionText } from "./mentionMatch";

/**
 * Minimal @mention autocomplete: detects an active "@partial" token around
 * the caret, offers matching workspace members, and inserts the exact
 * "@Display Name " form the shared parser (src/shared/mentions.ts) matches.
 * Deliberately not a full rich-text editor — plain textarea/input value
 * manipulation via selectionStart/selectionEnd. Matching logic itself lives
 * in mentionMatch.ts as pure, independently tested functions.
 */
export function useMentionSuggestions(
  value: string,
  onChange: (next: string) => void,
  members: WorkspaceMember[],
  fieldRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>,
) {
  const [triggerIndex, setTriggerIndex] = useState<number | null>(null);
  const [query, setQuery] = useState<string | null>(null);

  const suggestions = useMemo(
    () => (query === null ? [] : filterMentionCandidates(members, query)),
    [query, members],
  );

  const close = useCallback(() => {
    setTriggerIndex(null);
    setQuery(null);
  }, []);

  const detect = useCallback(
    (text: string, caret: number) => {
      const trigger = detectMentionTrigger(text, caret);
      if (!trigger) return close();
      setTriggerIndex(trigger.at);
      setQuery(trigger.query);
    },
    [close],
  );

  const insert = useCallback(
    (member: WorkspaceMember) => {
      if (triggerIndex === null) return;
      const el = fieldRef.current;
      const caret = el?.selectionStart ?? value.length;
      const before = value.slice(0, triggerIndex);
      const after = value.slice(caret);
      const inserted = mentionInsertionText(member);
      onChange(before + inserted + after);
      close();
      requestAnimationFrame(() => {
        const pos = before.length + inserted.length;
        el?.focus();
        el?.setSelectionRange?.(pos, pos);
      });
    },
    [triggerIndex, fieldRef, value, onChange, close],
  );

  const onFieldChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const next = e.target.value;
      const caret = e.target.selectionStart ?? next.length;
      onChange(next);
      detect(next, caret);
    },
    [onChange, detect],
  );

  const onFieldKeyUp = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const el = e.currentTarget;
      detect(el.value, el.selectionStart ?? el.value.length);
    },
    [detect],
  );

  return { suggestions, open: suggestions.length > 0, close, insert, onFieldChange, onFieldKeyUp };
}
