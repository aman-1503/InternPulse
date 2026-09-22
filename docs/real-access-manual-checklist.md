# Manual real-Access checklist

Run this once, by hand, against a real deployed environment where the
production hostname is behind the Cloudflare Access application (team domain
`internpulse.cloudflareaccess.com`). This cannot be automated — it requires an
actual browser SSO login — so it is not part of `npm test` or the adversarial
scripts. **Do not run this against production until you've explicitly decided
to deploy** (see PART 28 / the deployment checkpoint) — this doc is prepared
ahead of that, not an instruction to deploy now.

For each step, note pass/fail and any unexpected behavior.

## 1. First login / identity bootstrap

- [ ] Open the protected app URL in a private/incognito window.
- [ ] Confirm Cloudflare Access redirects to the configured identity provider
      before InternPulse ever loads.
- [ ] Complete login. Confirm the app loads (not a blank screen, not a raw
      error).
- [ ] Confirm `GET /api/me` (Network tab) returns 200 with your email/display
      name — this is the D1 user being created/linked for the first time.
- [ ] Reload the page. Confirm a second login isn't required mid-session and
      `/api/me` now returns the same user id as before (idempotent).

## 2. Onboarding / invitations / workspace entry

- [ ] With an identity that has no memberships and no invitations: confirm
      the "Welcome to InternPulse" screen appears, offering only "set up a
      new workspace" — never a role picker.
- [ ] Create a workspace as mentor, inviting a real second email as intern
      and a real third email as manager (or vice versa).
- [ ] Confirm you land in that workspace's Settings tab showing the invited
      emails as pending invitations.
- [ ] Sign in as the invited intern email (a different browser profile/
      private window). Confirm the "You've been invited" screen appears with
      the correct workspace name and role.
- [ ] Accept the invitation. Confirm you land in the workspace with the
      correct role and can see live data.
- [ ] Try accepting the same invitation link/id again (if you saved the
      network request) — confirm it's rejected as no longer pending.

## 3. Role-aware home

- [ ] As the intern: confirm the home screen shows only their own
      urgent/overdue tasks, blockers, feedback, mentions, weekly status —
      no manager portfolio data.
- [ ] As the mentor: confirm the home screen aggregates across every
      workspace they mentor (create a second workspace to verify this if
      only one exists).
- [ ] As the manager: confirm portfolio, escalations, and stuck-review
      sections render correctly, and "+ New workspace" works.

## 4. Session / logout / expiry

- [ ] Click "Sign out" in the profile menu. Confirm it goes through Access's
      logout (`/cdn-cgi/access/logout`) and a subsequent load requires
      re-authentication.
- [ ] Revoke the Access session for this user from the Zero Trust dashboard
      (Access → Logs, or force-expire the policy) while the app is open in
      another tab. Confirm the next request in that tab surfaces the
      "sign-in required" screen rather than a silent failure or infinite
      WebSocket reconnect loop.
- [ ] Open the app in two different browsers/devices as the same user
      simultaneously. Confirm both work independently and realtime updates
      from one appear in the other.

## 5. Unauthorized / suspended / disabled / conflict

- [ ] As a platform admin, suspend a test user via `/admin`. Confirm that
      user's next request shows the "account suspended" screen, and any open
      WebSocket for that user is not silently left in a broken retry loop.
- [ ] Reactivate them and confirm normal access resumes.
- [ ] Try to open a workspace URL (`#/w/<id>`) for a workspace the signed-in
      user is not a member of. Confirm "you don't have access" — no data
      leaks, no partial snapshot.

## 6. Admin

- [ ] Confirm `/admin` is invisible in the sidebar and returns "admin access
      required" for a non-admin user, even if they navigate there directly.
- [ ] As an admin: list users, workspaces, invitations, and audit events.
      Confirm a suspend/reactivate action appears in the audit log.
- [ ] Confirm a MANAGER (non-admin) cannot reach `/admin`.

## 7. Realtime / Agent / attachments

- [ ] Open the same workspace in two tabs as two different real members.
      Confirm task/blocker/update changes sync live.
- [ ] Ask the Progress Agent a question; confirm a grounded answer with the
      "grounded on…" footer.
- [ ] Upload an attachment; confirm it appears, indexes, and downloads
      correctly, scoped to that workspace only.

## 8. Cross-workspace isolation (spot check)

- [ ] As a member of workspace A only, attempt to fetch workspace B's
      snapshot/attachment/agent endpoints directly (e.g. via curl with your
      browser's Access session cookie). Confirm every one is denied.

---

Record results (date, environment, pass/fail per section) before treating a
deployment as verified.
