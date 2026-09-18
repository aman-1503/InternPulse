import type { RefObject } from "react";
import type { WorkspaceMember } from "../../shared/protocol";
import { Popover } from "./Popover";
import { RoleBadge } from "./badges";

export function MentionSuggestions({
  open,
  triggerRef,
  suggestions,
  onPick,
  onClose,
}: {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  suggestions: WorkspaceMember[];
  onPick: (m: WorkspaceMember) => void;
  onClose: () => void;
}) {
  return (
    <Popover open={open} triggerRef={triggerRef} align="start" onClose={onClose} className="w-64">
      <ul className="flex flex-col gap-0.5">
        {suggestions.map((m) => (
          <li key={m.userId}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
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
