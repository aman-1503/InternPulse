import { navigate } from "../router";
import { btn, card, cn, meta } from "../ui/primitives";

/**
 * First-time-with-no-membership-and-no-invite screen. Deliberately never
 * asks "what role are you" — the only self-service action is creating a
 * workspace, and even that requires declaring mentor/manager, never intern
 * (interns join through invitation/membership only).
 */
export function Onboarding() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-base font-bold text-white shadow-sm">IP</span>
        <div className={cn(card, "w-full text-center")}>
          <h1 className="mb-2 text-lg font-semibold text-text">Welcome to InternPulse</h1>
          <p className={cn(meta, "mb-6")}>
            You're signed in, but you don't have any workspace memberships or pending invitations yet.
          </p>
          <button className={cn(btn("primary"), "w-full justify-center")} onClick={() => navigate("#/workspaces/new")}>
            Set up a new internship/project workspace
          </button>
          <p className={cn(meta, "mt-4")}>
            Expecting an invitation instead? Ask your mentor or manager to invite the email address you
            signed in with, then reload this page.
          </p>
        </div>
      </div>
    </div>
  );
}
