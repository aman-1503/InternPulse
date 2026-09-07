/**
 * Phase 4B — WeeklyReviewWorkflow (durable human-in-the-loop).
 *
 * Started directly from a Worker HTTP route. Deterministic id `weekly-<reportId>`.
 *
 *   step.do draft        -> ProgressAgent drafts (current state + RAG history);
 *                           deterministic marked draft if AI unavailable
 *   loop up to WEEKLY_MAX_ROUNDS:
 *     waitForEvent submit -> intern submitted           (timeout => end, back to DRAFT)
 *     waitForEvent review -> mentor APPROVE / REQUEST_CHANGES
 *        APPROVE          -> status APPROVED, notify manager, end
 *        REQUEST_CHANGES  -> status CHANGES_REQUESTED, notify intern, next round
 *
 * No HTTP request is held open across waits. The report row in DO SQLite is the
 * source of truth for content/status; this workflow only advances the lifecycle.
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { ProgressAgent } from "./progress-agent";

interface WeeklyParams {
  workspaceId: string;
  reportId: string;
  reportingPeriod: string;
}

export class WeeklyReviewWorkflow extends WorkflowEntrypoint<Env, WeeklyParams> {
  async run(event: WorkflowEvent<WeeklyParams>, step: WorkflowStep) {
    const { workspaceId, reportId, reportingPeriod } = event.payload;
    const workspace = () =>
      this.env.WORKSPACE_DO.get(this.env.WORKSPACE_DO.idFromName(workspaceId));

    const maxRounds = Math.max(1, Number(this.env.WEEKLY_MAX_ROUNDS || "3"));
    const timeout = this.env.WEEKLY_STEP_TIMEOUT || "3 days";

    // 1. Draft.
    await step.do("draft", async () => {
      const agent = await getAgentByName<Env, ProgressAgent>(
        this.env.PROGRESS_AGENT as unknown as DurableObjectNamespace<ProgressAgent>,
        workspaceId,
      );
      const { content, aiGenerated } = await agent.draftWeeklyReport(workspaceId, reportingPeriod);
      await workspace().updateWeeklyDraft(reportId, content, aiGenerated);
      return { aiGenerated };
    });

    for (let round = 0; round < maxRounds; round++) {
      // 2. Wait for the intern to submit.
      let submitted = true;
      try {
        await step.waitForEvent(`submit-${round}`, { type: "weekly.submit", timeout });
      } catch {
        submitted = false;
      }
      if (!submitted) {
        await step.do(`expire-submit-${round}`, async () => {
          await workspace().setWeeklyStatus(reportId, "DRAFT", { round });
        });
        return { outcome: "expired_awaiting_submit", round };
      }

      await step.do(`mark-submitted-${round}`, async () => {
        await workspace().setWeeklyStatus(reportId, "SUBMITTED", { round });
        await workspace().createReminder({
          recipientUserId: null,
          recipientRole: "mentor",
          type: "REPORT_SUBMITTED",
          entityType: "WEEKLY_REPORT",
          entityId: reportId,
          message: `Weekly report ${reportingPeriod} was submitted and is waiting for your review.`,
        });
      });

      // 3. Wait for the mentor's decision.
      let review: { payload?: unknown } | null = null;
      try {
        review = await step.waitForEvent(`review-${round}`, { type: "weekly.review", timeout });
      } catch {
        review = null;
      }
      if (!review) {
        return { outcome: "expired_awaiting_review", round };
      }

      const payload = (review.payload ?? {}) as { decision?: string; feedback?: string };
      const feedback = typeof payload.feedback === "string" ? payload.feedback : null;

      if (payload.decision === "APPROVE") {
        await step.do(`approve-${round}`, async () => {
          await workspace().setWeeklyStatus(reportId, "APPROVED", { round });
          await workspace().createReminder({
            recipientUserId: null,
            recipientRole: "manager",
            type: "REPORT_APPROVED",
            entityType: "WEEKLY_REPORT",
            entityId: reportId,
            message: `Weekly report ${reportingPeriod} was approved and is ready to view.`,
          });
        });
        return { outcome: "approved", round };
      }

      // REQUEST_CHANGES (any non-APPROVE decision).
      await step.do(`request-changes-${round}`, async () => {
        await workspace().setWeeklyStatus(reportId, "CHANGES_REQUESTED", {
          mentorFeedback: feedback,
          round: round + 1,
        });
        await workspace().createReminder({
          recipientUserId: null,
          recipientRole: "intern",
          type: "REPORT_CHANGES_REQUESTED",
          entityType: "WEEKLY_REPORT",
          entityId: reportId,
          message: `Mentor requested changes on weekly report ${reportingPeriod}${
            feedback ? `: ${feedback}` : "."
          }`,
        });
      });
    }

    return { outcome: "max_rounds_reached", rounds: maxRounds };
  }
}
