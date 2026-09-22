import { useCallback, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from "react";
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
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo(
    () => (query === null ? [] : filterMentionCandidates(members, query)),
    [query, members],
  );

  const close = useCallback(() => {
    setTriggerIndex(null);
    setQuery(null);
    setActiveIndex(0);
  }, []);

  const detect = useCallback(
    (text: string, caret: number) => {
      const trigger = detectMentionTrigger(text, caret);
      if (!trigger) return close();
      setTriggerIndex(trigger.at);
      // onFieldKeyUp calls detect() on every key release, including
      // ArrowUp/Down/Enter/Tab/Escape (which onFieldKeyDown already
      // preventDefault()s, so the text/caret haven't actually moved) —
      // only reset the keyboard-highlighted index when the query text
      // itself changed, or every arrow-key press would immediately snap
      // back to index 0 on its own keyup.
      setQuery((prevQuery) => {
        if (prevQuery !== trigger.query) setActiveIndex(0);
        return trigger.query;
      });
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

  // Set by onFieldKeyDown when it fully handles a key (preventDefault()'d) —
  // the field's text/caret didn't actually move, so the following keyup
  // must NOT re-run detect(): it would just find the same still-active
  // trigger and either reopen a popup Escape just closed, or reset the
  // ArrowUp/Down highlight it just moved back to index 0.
  const consumedRef = useRef(false);

  const onFieldKeyUp = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (consumedRef.current) {
        consumedRef.current = false;
        return;
      }
      const el = e.currentTarget;
      detect(el.value, el.selectionStart ?? el.value.length);
    },
    [detect],
  );

  const open = suggestions.length > 0;

  /**
   * ArrowUp/Down move the highlighted suggestion, Enter/Tab pick it, Escape
   * closes — the keyboard-navigation contract any autocomplete needs. Callers
   * wire this into their own onKeyDown ahead of their own Enter/Tab handling
   * and skip that handling when this returns true (the key was consumed here).
   */
  const onFieldKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): boolean => {
      if (!open) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        consumedRef.current = true;
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        consumedRef.current = true;
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        consumedRef.current = true;
        const chosen = suggestions[Math.min(activeIndex, suggestions.length - 1)];
        if (chosen) insert(chosen);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        consumedRef.current = true;
        close();
        return true;
      }
      return false;
    },
    [open, suggestions, activeIndex, insert, close],
  );

  return { suggestions, open, activeIndex, close, insert, onFieldChange, onFieldKeyUp, onFieldKeyDown };
}
