import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "./primitives";

/**
 * A dropdown panel portaled to document.body and positioned via the
 * trigger's bounding rect, rather than `position: absolute` inside normal
 * flow. Needed because any scrollable ancestor with `overflow-y` set to
 * anything but `visible` (e.g. AppShell's <main overflow-y-auto>) forces
 * `overflow-x` to behave the same way per the CSS overflow spec — silently
 * clipping/cutting an absolutely-positioned dropdown that would otherwise
 * extend outside that ancestor's box, which is what was happening to the
 * "Needs attention" and "Members" popovers once they moved inside the
 * scrollable production shell.
 */
export function Popover({
  open,
  triggerRef,
  align = "end",
  onClose,
  className,
  children,
}: {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  align?: "start" | "end";
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setStyle(null);
      return;
    }
    const update = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      const top = rect.bottom + 8;
      const left = align === "end" ? rect.right : rect.left;
      setStyle({ top, left });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, triggerRef, align]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, triggerRef, onClose]);

  if (!open || !style) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: style.top,
        ...(align === "end" ? { right: window.innerWidth - style.left } : { left: style.left }),
      }}
      className={cn("z-50 max-w-[90vw] rounded-lg border border-border bg-surface p-2 shadow-lg", className)}
    >
      {children}
    </div>,
    document.body,
  );
}
