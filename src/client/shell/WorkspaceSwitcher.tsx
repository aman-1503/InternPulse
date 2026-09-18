import { useEffect, useRef, useState } from "react";
import type { Membership } from "../auth/types";
import { navigate, workspaceHash } from "../router";
import { btn, cn, meta } from "../ui/primitives";
import { RoleBadge } from "../ui/badges";

export function WorkspaceSwitcher({
  memberships,
  currentWorkspaceId,
}: {
  memberships: Membership[];
  currentWorkspaceId?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = memberships.find((m) => m.workspaceId === currentWorkspaceId);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (memberships.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button className={btn("default")} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {current ? current.workspaceName : "Switch workspace"} ▾
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 z-30 mt-2 w-72 rounded-lg border border-border bg-surface p-2 shadow-lg">
          <ul className="flex flex-col gap-0.5">
            {memberships.map((m) => (
              <li key={m.workspaceId}>
                <button
                  role="option"
                  aria-selected={m.workspaceId === currentWorkspaceId}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-muted",
                    m.workspaceId === currentWorkspaceId && "bg-accent-muted",
                  )}
                  onClick={() => {
                    setOpen(false);
                    navigate(workspaceHash(m.workspaceId));
                  }}
                >
                  <span>{m.workspaceName}</span>
                  <RoleBadge role={m.role} />
                </button>
              </li>
            ))}
          </ul>
          <button
            className={cn(btn("ghost"), "mt-1 w-full justify-start")}
            onClick={() => {
              setOpen(false);
              navigate("#/home");
            }}
          >
            ← Home
          </button>
          <p className={cn(meta, "px-2 pt-1")}>{memberships.length} workspace(s)</p>
        </div>
      )}
    </div>
  );
}
