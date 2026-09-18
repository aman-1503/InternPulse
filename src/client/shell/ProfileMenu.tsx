import { useEffect, useRef, useState } from "react";
import type { MeUser } from "../auth/types";
import { navigate } from "../router";
import { btn, cn, meta } from "../ui/primitives";
import { AdminBadge } from "../ui/badges";

export function ProfileMenu({ user }: { user: MeUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = user.displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-2 rounded-full border border-border bg-surface px-2 py-1 text-sm hover:bg-surface-muted"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">{initial}</span>
        <span className="hidden sm:inline">{user.displayName}</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-64 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <p className="font-medium text-text">{user.displayName}</p>
          <p className={meta}>{user.email}</p>
          <p className={cn(meta, "mt-1 flex items-center gap-1")}>
            {user.accountStatus} {user.isAdmin && <AdminBadge />}
          </p>
          <div className="mt-3 flex flex-col gap-1">
            <button
              role="menuitem"
              className={cn(btn("default"), "justify-start")}
              onClick={() => {
                setOpen(false);
                navigate("#/settings");
              }}
            >
              Profile &amp; settings
            </button>
            {user.isAdmin && (
              <button
                role="menuitem"
                className={cn(btn("default"), "justify-start")}
                onClick={() => {
                  setOpen(false);
                  navigate("#/admin");
                }}
              >
                Admin
              </button>
            )}
            <a role="menuitem" className={cn(btn("default"), "justify-start")} href="/cdn-cgi/access/logout">
              Sign out
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
