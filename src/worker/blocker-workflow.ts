/**
 * Phase 4B — BlockerWorkflow.
 *
 * Started (via the internpulse-workflow-events queue) when a blocker is created.
 * Deterministic instance id `blocker-<blockerId>` makes duplicate starts a no-op.
 *
 *   sleep(BLOCKER_REMINDER_DELAY)
 *     -> re-read blocker from WorkspaceDO; RESOLVED/gone => stop
 *     -> create in-app reminders for intern + mentor
 *   sleep(BLOCKER_ESCALATION_DELAY)
 *     -> re-read blocker; RESOLVED/gone => stop
 *     -> create escalation reminder for manager
 *
 * Every check re-reads authoritative state. The payload carries only ids.
 * Workers AI drafts the wording; a deterministic template is used if it fails.
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { ProgressAgent } from "./progress-agent";

interface BlockerParams {
  workspaceId: string;
  blockerId: string;
}

export class BlockerWorkflow extends WorkflowEntrypoint<Env, BlockerParams> {
  async run(event: WorkflowEvent<BlockerParams>, step: WorkflowStep) {
    const { workspaceId, blockerId } = event.payload;
    const workspace = () =>
      this.env.WORKSPACE_DO.get(this.env.WORKSPACE_DO.idFromName(workspaceId));
    const agent = () =>
      getAgentByName<Env, ProgressAgent>(
        this.env.PROGRESS_AGENT as unknown as DurableObjectNamespace<ProgressAgent>,
        workspaceId,
      );

    // Escalate sooner when the linked task is URGENT/HIGH — read once, up front.
    const urgency = await step.do("read-linked-task-priority", async () => {
      const b = await workspace().getBlocker(blockerId);
      if (!b?.taskId) return { urgent: false };
      const task = await workspace().getTask(b.taskId);
      return { urgent: task?.priority === "URGENT" || task?.priority === "HIGH" };
    });
    const reminderDelay = (
      urgency.urgent
        ? this.env.BLOCKER_REMINDER_DELAY_URGENT || this.env.BLOCKER_REMINDER_DELAY || "15 minutes"
        : this.env.BLOCKER_REMINDER_DELAY || "1 hour"
    ) as WorkflowSleepDuration;
    const escalationDelay = (
      urgency.urgent
        ? this.env.BLOCKER_ESCALATION_DELAY_URGENT || this.env.BLOCKER_ESCALATION_DELAY || "1 hour"
        : this.env.BLOCKER_ESCALATION_DELAY || "1 day"
    ) as WorkflowSleepDuration;

    await step.sleep("wait-for-reminder", reminderDelay);

    const beforeReminder = await step.do("check-before-reminder", async () => {
      const b = await workspace().getBlocker(blockerId);
      if (!b) return { status: "deleted" as const, mentorResponded: false };
      return { status: b.status, mentorResponded: b.mentorResponded };
    });
    if (beforeReminder.status === "RESOLVED" || beforeReminder.status === "deleted") {
      return { outcome: "stopped_before_reminder", state: beforeReminder.status };
    }

    // A mentor who has already commented doesn't need the "please respond"
    // nudge — but escalation (about prolonged non-resolution, not responsiveness)
    // still proceeds below.
    const remindResult = beforeReminder.mentorResponded
      ? { usedAI: false, skipped: true }
      : await step.do("create-reminders", async () => {
          const a = await agent();
          const intern = await a.draftBlockerReminder(workspaceId, blockerId, "intern");
          const mentor = await a.draftBlockerReminder(workspaceId, blockerId, "mentor");
          await workspace().createReminder({
            recipientUserId: null,
            recipientRole: "intern",
            type: "BLOCKER_REMINDER",
            entityType: "BLOCKER",
            entityId: blockerId,
            message: intern.text,
          });
          await workspace().createReminder({
            recipientUserId: null,
            recipientRole: "mentor",
            type: "BLOCKER_REMINDER",
            entityType: "BLOCKER",
            entityId: blockerId,
            message: mentor.text,
          });
          return { usedAI: intern.usedAI && mentor.usedAI, skipped: false };
        });

    await step.sleep("wait-for-escalation", escalationDelay);

    const beforeEscalation = await step.do("check-before-escalation", async () => {
      const b = await workspace().getBlocker(blockerId);
      return { status: b ? b.status : ("deleted" as const) };
    });
    if (beforeEscalation.status === "RESOLVED" || beforeEscalation.status === "deleted") {
      return {
        outcome: "stopped_before_escalation",
        state: beforeEscalation.status,
        reminderUsedAI: remindResult.usedAI,
      };
    }

    const escalation = await step.do("escalate", async () => {
      const a = await agent();
      const msg = await a.draftBlockerReminder(workspaceId, blockerId, "manager");
      await workspace().createReminder({
        recipientUserId: null,
        recipientRole: "manager",
        type: "BLOCKER_ESCALATION",
        entityType: "BLOCKER",
        entityId: blockerId,
        message: msg.text,
      });
      return { usedAI: msg.usedAI };
    });

    return {
      outcome: "escalated",
      reminderUsedAI: remindResult.usedAI,
      escalationUsedAI: escalation.usedAI,
    };
  }
}
