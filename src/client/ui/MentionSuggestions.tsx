import type { RefObject } from "react";
import type { WorkspaceMember } from "../../shared/protocol";
import { cn } from "./primitives";
import { Popover } from "./Popover";
import { RoleBadge } from "./badges";

export function MentionSuggestions({
  open,
  triggerRef,
  suggestions,
  activeIndex = -1,
  onPick,
  onClose,
}: {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  suggestions: WorkspaceMember[];
  /** Index of the keyboard-highlighted suggestion, if any (see useMentionSuggestions). */
  activeIndex?: number;
  onPick: (m: WorkspaceMember) => void;
  onClose: () => void;
}) {
  return (
    <Popover open={open} triggerRef={triggerRef} align="start" onClose={onClose} className="w-64">
      <ul role="listbox" className="flex flex-col gap-0.5">
        {suggestions.map((m, i) => (
          <li key={m.userId} role="option" aria-selected={i === activeIndex}>
            <button
              type="button"
              data-mention-active={i === activeIndex || undefined}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-muted",
                i === activeIndex && "bg-accent-muted",
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the field, not the button
                onPick(m);
              }}
            >
              <span>{m.displayName}</span>
              <RoleBadge role={m.role} />
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
