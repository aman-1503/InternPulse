import type { ReactNode } from "react";
import type { Role, TaskPriority, TaskStatus, WeeklyReportStatus, BlockerStatus } from "../../shared/protocol";
import { badge, badgeTones, cn } from "./primitives";

export function RoleBadge({ role }: { role: Role | null }) {
  const tone: Record<Role, string> = {
    intern: "bg-role-intern/10 text-role-intern",
    mentor: "bg-role-mentor/10 text-role-mentor",
    manager: "bg-role-manager/10 text-role-manager",
  };
  return (
    <span className={badge(role ? tone[role] : badgeTones.neutral)}>{role ?? "observer"}</span>
  );
}

export function AdminBadge() {
  return <span className={badge("bg-role-admin/10 text-role-admin")}>admin</span>;
}

export function PriorityBadge({ priority }: { priority: TaskPriority | null }) {
  if (!priority) return null;
  const tone: Record<TaskPriority, string> = {
    LOW: "bg-surface-muted text-priority-low",
    MEDIUM: "bg-accent-muted text-priority-medium",
    HIGH: "bg-warning-muted text-priority-high",
    URGENT: "bg-danger-muted text-priority-urgent",
  };
  return <span className={badge(tone[priority])}>{priority}</span>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const tone: Record<TaskStatus, string> = {
    TODO: badgeTones.neutral,
    IN_PROGRESS: badgeTones.accent,
    BLOCKED: badgeTones.danger,
    DONE: badgeTones.success,
  };
  return <span className={badge(tone[status])}>{status.replace("_", " ")}</span>;
}

export function BlockerStatusBadge({ status }: { status: BlockerStatus }) {
  const tone: Record<BlockerStatus, string> = {
    OPEN: badgeTones.danger,
    RESOLUTION_REQUESTED: badgeTones.warning,
    RESOLVED: badgeTones.success,
  };
  return <span className={badge(tone[status])}>{status.replace(/_/g, " ")}</span>;
}

export function WeeklyStatusBadge({ status }: { status: WeeklyReportStatus }) {
  const tone: Record<WeeklyReportStatus, string> = {
    DRAFT: badgeTones.neutral,
    SUBMITTED: badgeTones.accent,
    CHANGES_REQUESTED: badgeTones.warning,
    RESUBMITTED: badgeTones.accent,
    APPROVED: badgeTones.success,
  };
  return <span className={badge(tone[status])}>{status.replace(/_/g, " ")}</span>;
}

export function WarnBadge({ children }: { children: ReactNode }) {
  return <span className={badge(badgeTones.warning)}>{children}</span>;
}

export function CountBadge({ n, tone = "neutral" }: { n: number; tone?: keyof typeof badgeTones }) {
  if (n <= 0) return null;
  return <span className={cn(badge(badgeTones[tone]), "ml-1")}>{n}</span>;
}
