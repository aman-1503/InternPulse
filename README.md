# InternPulse

**One realtime workspace for internship & project progress — shared by intern, mentor, and manager.**

Live demo: **https://internpulse.amanprabhune.workers.dev**

---

## The problem

Internship and project progress ends up scattered across Google Docs, shared
folders, task trackers, DM threads, mentor notes, and status updates. The intern
maintains one version, the mentor another, the manager a third. Nobody is looking
at the same thing, and "what's actually going on" takes a meeting to answer.

## The solution

A single, continuously-updated workspace that is the source of truth for one
internship/project:

- **current work** (a task board), **daily progress updates**, **blockers**,
  **mentor feedback**, and an **activity timeline** — all realtime, all shared.
- a **manager overview** across projects.
- durable **workflows** for the slow, human-in-the-loop parts: blocker
  reminders/escalation and a weekly progress review with mentor approval.
- a **stateful Progress Agent** per workspace that answers questions grounded in
  the *current* authoritative state, plus retrieved history and uploaded
  documents — never a generic chatbot, never a second source of truth.

InternPulse is **not** a generic project-management tool. Every surface is about
intern progress, mentor guidance, and manager visibility.

---

## Architecture

```
                         React + TypeScript + Vite  (SPA, served by the Worker)
                                        │
                                        ▼
                             Cloudflare Worker  ── one HTTP + WebSocket entrypoint
                                        │
     ┌──────────────┬───────────────────┼───────────────────┬──────────────┬──────────────┐
     ▼              ▼                   ▼                   ▼              ▼              ▼
   D1          Workspace DO        ProgressAgent DO      Vectorize       Queues       Workflows
 (org data)   (per workspace)      (per workspace,      (RAG index:   (async         (durable,
  users        DO SQLite  ─────►    Agents SDK)          history +     handoff:       human-in-loop)
  teams        tasks/blockers/      current-state RPC    documents)    indexing,      • BlockerWorkflow
  workspaces   updates/feedback/    + retrieval          scoped by     workflow       • WeeklyReviewWorkflow
  memberships  activity/reminders/  + Workers AI          workspace    starts)
  + role       weekly_reports/                                │
               attachments(meta)    Workers AI  ◄────────────┘
                    │               (@cf/meta/llama-3.1-8b-instruct-fast,
                    ▼                @cf/baai/bge-base-en-v1.5 embeddings,
              WebSockets              env.AI.toMarkdown for documents)
              (Hibernation API)              │
                    │                        ▼
            intern / mentor / manager      R2 (internpulse-attachments)
                                           original uploaded files ONLY
```

### Why each Cloudflare primitive is here

| Primitive | Role in InternPulse | Why it fits |
|---|---|---|
| **Durable Objects** | One `WorkspaceDO` per internship/project — the authoritative, realtime coordinator. All reads/writes to workspace state go through it. | A workspace needs a single consistent owner for realtime fan-out and last-write-wins ordering. `idFromName(workspaceId)` gives a stable instance. |
| **DO SQLite** | Workspace-local persistence: tasks, blockers, updates, feedback, activity, reminders, weekly reports, attachment metadata, request-dedup. | Colocated with the coordinator → transactional, zero-latency reads while serving WebSockets. In-DO schema migrations (`schema_version`). |
| **D1** | Organization-wide relational data only: users, teams, workspaces, memberships + role. | Cross-workspace, relational, queried by the manager overview and the auth boundary. Never holds workspace business state. |
| **WebSockets + Hibernation** | Realtime sync of every workspace change; presence. | Hibernation keeps idle connections cheap; the DO replays an authoritative snapshot on every (re)connect so clients never reconstruct state from events. |
| **Agents SDK + Workers AI** | `ProgressAgent` — one stateful agent per workspace. Reads a bounded projection of current state via DO-to-DO RPC, retrieves history/documents from Vectorize, answers with Workers AI. | Genuinely stateful (its own SQLite for conversation turns), workspace-scoped, and grounded. Read / reason / suggest / draft — never mutates. |
| **Vectorize** | RAG index (`internpulse-history`, 768-dim cosine): historical UPDATE/BLOCKER/FEEDBACK records **and** chunks of uploaded documents, tagged with `workspaceId` + `entityType`. | Semantic recall of "what happened before" and "what did the docs say". Retrieval only — the vector store is rebuildable and never authoritative. |
| **Queues** | Two async seams: (1) index a changed entity or uploaded document into Vectorize, off the mutation path; (2) start a `BlockerWorkflow` when a blocker is created, off the ack path. | Keeps the user-facing write fast; gives retries and decoupling. Nothing else is forced through a queue. |
| **Workflows** | `BlockerWorkflow` (sleep → re-read blocker → remind → sleep → re-read → escalate) and `WeeklyReviewWorkflow` (draft → intern submit → mentor approve/request-changes loop). | Durable across days and restarts; `waitForEvent` for the human steps means no HTTP request is held open. Every step re-reads authoritative state — the payload carries only ids. |
| **R2** | Original bytes of uploaded attachments, under `workspace/<id>/<attachmentId>/<file>`. | Object storage for files. Metadata stays in DO SQLite, searchable text in Vectorize; the bytes live only in R2. |

---

## Roles

Three **workspace** roles, resolved once per request at **`resolveRole()`** in
`src/worker/index.ts` — the single authorization seam, reading D1 `memberships`.
A user's role can differ per workspace (e.g. mentor in one, manager in another).

There is also a separate **platform** role, `platform_role` on the `users`
table: `USER` (default) or `ADMIN`. Platform admin is operational/support
authority (user/account/membership repair, audit visibility) — it is *not*
"manager of every workspace" and is never granted from a client-supplied
value. See [Production authentication](#production-authentication-cloudflare-access) below.

| Action | intern | mentor | manager | no membership |
|---|:--:|:--:|:--:|:--:|
| read workspace / snapshot / agent / overview | ✅ | ✅ | ✅ | ❌ (403) |
| tasks: create / edit / move / delete | ✅ | ✅ | — | — |
| post update · raise blocker · upload/delete attachment | ✅ | ✅ | — | — |
| resolve blocker · add feedback | — | ✅ | — | — |
| start weekly review · edit/submit own report | ✅ | ✅ (start only) | — | — |
| review weekly report (approve / request changes) | — | ✅ | — | — |
| view approved weekly report · view blocker escalations | ✅ | ✅ | ✅ | — |
| acknowledge own reminders | ✅ | ✅ | ✅ | — |

The Progress Agent is **read / reason / suggest / draft only** for all roles — it never completes tasks, resolves blockers, edits reports, or changes membership.

---

## Main product flows

1. **Realtime workspace** — intern posts a daily update / creates a task / raises a blocker; mentor and manager see it instantly. Refresh → the DO snapshot restores exact state.
2. **Blocker lifecycle** — blocker raised → after `BLOCKER_REMINDER_DELAY`, if still open, in-app reminders to intern + mentor → after `BLOCKER_ESCALATION_DELAY`, if still open, escalation to the manager. Resolving the blocker stops the workflow. Reminders dedupe (no spam).
3. **Weekly progress review** — someone starts it → the agent drafts a report from current state + retrieved history/documents (or a clearly-marked deterministic draft if AI is down) → intern edits and submits → mentor approves or requests changes (loops up to `WEEKLY_MAX_ROUNDS`) → approved report is visible to the manager.
4. **Ask the agent** — "What am I blocked on?", "What happened this week?", "What do the uploaded docs say about token rotation?" → grounded answer with a `groundedOn` panel (current-state counts + retrieved history + retrieved document chunks).
5. **Manager overview** — cards for each project: name, intern, active task count, open blocker count, latest update; click through into the same shared workspace.
6. **Attachments** — upload a spec/notes file → stored in R2, listed with size/type/uploader/time, downloadable, and (for text-bearing formats) chunked into Vectorize so the agent can cite it.

---

## Production UI

The production app (everything except `#/demo`) is a Tailwind-based SaaS
shell built on top of the same realtime backend as the demo, gated entirely
by [Production authentication](#production-authentication-cloudflare-access):

- **First login → onboarding.** `GET /api/me` drives one of: role-aware home
  (memberships exist), a pending-invitations screen (invited but not yet a
  member), or a "set up a new workspace" screen (neither) — never a
  self-service role picker. See `src/client/auth/decisions.ts`.
- **Invitations.** Each pending invite shows workspace, role, inviter, and
  expiry; accepting calls `POST /api/invitations/:id/accept` and re-fetches
  `/api/me`. Errors (wrong email, expired, revoked, already accepted) are
  shown as plain text, never a raw JSON dump.
- **Create workspace.** Mentor/manager only, never intern — the creator
  declares `creatorRole` and it's validated server-side against their own
  verified email in that slot (see `handleCreateWorkspace`). Unmatched
  intern/mentor/manager emails become invitations, not instantly-provisioned
  accounts.
- **Role-aware homes.** Intern/Mentor/Manager homes (`src/client/home/`)
  aggregate each membership's live snapshot (same "fan out and read" pattern
  the Worker's own `/api/overview` already used) and render the
  server-computed `attentionItems` grouped by reason — no duplicated
  attention logic on the client.
- **Global shell.** Sidebar (Home / workspaces / Mentions / Weekly Reviews /
  Files / Progress Agent / Settings / Admin-if-admin), top bar (workspace
  switcher, profile menu with sign-out via `/cdn-cgi/access/logout`),
  responsive down to a mobile drawer.
- **Workspace settings.** Members, pending invitations (invite/revoke) for
  the workspace's own mentor/manager; removing a member or changing an
  existing member's role is intentionally admin-only for now (see
  [Known remaining gaps](#known-demo-limitations)) — the UI never invents an
  authorization boundary the backend doesn't enforce.
- **Admin (`/admin`, `#/admin`).** Users, workspaces/memberships, invitations,
  audit log, basic health — thin wrappers over the existing admin API, with
  confirmation dialogs on every destructive action. Hidden from the sidebar
  and hard-blocked server-side for non-admins, including managers.
- **Demo stays structurally separate.** `src/client/demo/DemoApp.tsx` and
  `src/client/production/ProductionApp.tsx` are two independent component
  trees; `src/client/Root.tsx` picks one purely from whether the hash starts
  with `#/demo`. Production code never imports demo identity state.

Not yet built (explicitly deferred, not silently dropped — see the
productionization report for the full list): live @mention autocomplete
while typing, a global cross-workspace "Files" aggregator (Files/Agent
sidebar links jump into your first workspace's tab instead), and persisted
notification preferences (deliberately deferred per the locked decisions).

---

## Screenshots

_No screenshots are checked in yet._ Placeholders — capture from the live demo:

- `docs/screenshots/overview.png` — workspace Overview / Today
- `docs/screenshots/board.png` — draggable board
- `docs/screenshots/agent.png` — Progress Agent with grounding panel
- `docs/screenshots/weekly.png` — weekly review lifecycle
- `docs/screenshots/manager.png` — manager overview

---

## Production authentication (Cloudflare Access)

InternPulse's real identity/session layer is **Cloudflare Access** — it never
implements its own password storage, login form, or session cookie. Access
answers *"who is this authenticated person?"*; D1 answers *"what InternPulse
user/role/workspace access do they have?"*. See `src/worker/access-auth.ts`
for the exact verification and the module comments throughout
`src/worker/*.ts` for the full identity model this pass introduced.

### Two identity paths, deliberately separate

| | Path | Identity source | Data |
|---|---|---|---|
| Production | any `/api/*` route not under `/api/demo/` | verified Cloudflare Access JWT (`Cf-Access-Jwt-Assertion` header), cryptographically checked — see below | real workspaces (`is_demo = 0`) |
| Demo | `/api/demo/*` | the old unauthenticated `userId`/`displayName`/`devRole` query params (unchanged, for reviewers) | demo-seeded workspaces only (`is_demo = 1`) |

A workspace's `is_demo` flag is checked on **every** route in both directions:
a production request can never reach a demo workspace, and a demo request can
never reach a real one — even if it somehow knew the id. Set `DEMO_MODE=off`
to disable `/api/demo/*` entirely in a deployment that should never expose
sample data.

### How the JWT is verified

`getAuthenticatedIdentity(request, env)` in `src/worker/access-auth.ts`:

1. reads `Cf-Access-Jwt-Assertion` from the request (Access injects this
   header for both ordinary requests and WebSocket upgrades, once your
   hostname is behind an Access application and the browser has an Access
   session cookie — the browser WebSocket API can't set custom headers, but
   it doesn't need to here);
2. verifies the signature against your Access team's JWKS
   (`https://<team>/cdn-cgi/access/certs`, fetched via `jose`'s
   `createRemoteJWKSet`, cached);
3. checks `iss` against `https://<ACCESS_TEAM_DOMAIN>` and `aud` against
   `ACCESS_AUD`, and rejects an expired token;
4. returns `{ subject, email, name?, identityProvider? }` — or throws
   `AccessAuthError`, which every route maps to `401`.

Nothing downstream (D1, `resolveRole`, `canMutate`, the `WorkspaceDO`) ever
sees or trusts a client-supplied `userId`/`role`/`displayName` on a production
route. `resolveProductionUser()` in `src/worker/production-identity.ts` then
upserts/looks up the D1 `users` row for that verified identity (linking a
pre-existing row by email on first login rather than duplicating it), and
`platform_role`/`account_status` gate further access from there.

### Dashboard setup required (not done by this repo — see [Deployment checkpoint](#deployment-checkpoint))

1. **Zero Trust → Access → Applications → Add an application** (Self-hosted),
   pointing at your Worker's production hostname.
2. Add an **Access policy** (e.g. "Allow" for your organization's identity
   provider — Google Workspace, GitHub, one-time PIN, etc.) — configure the
   identity provider under **Settings → Authentication** first if needed.
3. Copy the application's **Audience (AUD) tag** from the application's
   Overview page.
4. Note your **team domain** (`<team-name>.cloudflareaccess.com`, or a custom
   domain if configured under **Settings → Custom Pages/Domains**).
5. Set on the Worker (`wrangler secret put` or `.dev.vars` locally — see
   `.dev.vars.example`):
   - `ACCESS_TEAM_DOMAIN` — your team domain (not secret, but Worker-specific)
   - `ACCESS_AUD` — the Application AUD tag (not secret)
   - `ADMIN_EMAILS` — comma-separated emails to bootstrap as platform `ADMIN`
     on their first login (see below)

None of `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` / `ADMIN_EMAILS` are secrets in
the credential sense (they don't grant access on their own — Access still
enforces its own policy at the edge), but treat `ADMIN_EMAILS` as sensitive
configuration; prefer `wrangler secret put ADMIN_EMAILS` over committing it.
**Never commit an actual Access service-token secret or API token.**

### Platform admin bootstrap

There is no default/shared admin account. The **first** time a verified
identity whose email is in `ADMIN_EMAILS` logs in, their newly-created D1 user
row gets `platform_role = 'ADMIN'` (see `isBootstrapAdmin()` in
`production-identity.ts`). This is **not** retroactive — removing or adding an
email to `ADMIN_EMAILS` later doesn't change an existing user's role; use the
admin API (`POST /api/admin/users/:id/suspend|activate|disable`) or a
deliberate D1 update for that. Admin routes live under `/api/admin/*` and
require `platform_role === 'ADMIN'`, checked server-side on every request —
see `src/worker/admin-routes.ts`.

### Account status

`users.account_status` is `ACTIVE` (default), `SUSPENDED`, or `DISABLED`.
InternPulse does **not** implement password reset — that happens at the
Access/IdP layer. A non-`ACTIVE` account is denied every production route
(`403 account_suspended` / `403 account_disabled`) before any workspace
authorization is even considered; only a platform admin can restore `ACTIVE`.

---

## Local setup

Requires **Node.js ≥ 22** (`.nvmrc` present) and npm.

```bash
nvm use
npm install
cp .dev.vars.example .dev.vars      # local config (gitignored)
npm run cf-typegen                  # generate binding types
npm run db:migrate:local            # D1 schema (simulated locally)
npm run db:seed:local               # org data: Alice / Mia / Jordan + 2 projects
npm run dev                         # http://localhost:5173
npm run demo:seed                   # (in another shell, once dev is up) populate the demo workspace
```

Without `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` set (the default local config),
every production (`/api/*` outside `/api/demo/`) route fails closed with
`401` — this is intentional, not a bug. The production UI (see
[Production UI](#production-ui) below) will show the "sign-in required"
screen in that case, since there's no way to satisfy a real Cloudflare Access
check from local dev — Access sits in front of a deployed hostname, not
`wrangler dev`/`vite dev`. **This is the deliberate local-dev limitation**:
build and iterate on production screens against `/api/demo/*` data (the demo
identities exercise the exact same components — see PART 24 of the
productionization spec), and verify the real Access-authenticated path with
the [manual checklist](docs/real-access-manual-checklist.md) after deploying.
There is no "trust this header locally" bypass anywhere in the code.

To use the demo experience: open the app, click into **`#/demo`** (or follow
the link from the production sign-in screen), and use the **demo identity
switcher** to become Alice Chen (intern), Mia Rivera (mentor), or Jordan Park
(manager). It's visually marked `DEMO MODE` and talks only to `/api/demo/*`,
which the Worker restricts to `is_demo=1` seed workspaces — it structurally
cannot reach real workspace data, and the production app never imports demo
identity state. Open the same demo workspace in a second browser to see
realtime sync.

If your account's production hostname is itself behind Cloudflare Access
(true once you've completed the dashboard setup above), `wrangler dev`'s
remote-binding proxy for Workers AI/Vectorize will fail to authenticate in a
non-interactive shell. Run `wrangler dev --local` (Workers AI/Vectorize
become unavailable locally, everything else — D1, DO, R2, and all auth
logic — still works) or provide an Access Service Token
(`CLOUDFLARE_ACCESS_CLIENT_ID`/`CLOUDFLARE_ACCESS_CLIENT_SECRET`) if you need
full remote bindings locally.

### Environment variables

`vars` live in `wrangler.jsonc` (safe defaults); secrets/overrides go in
`.dev.vars` (gitignored) — see `.dev.vars.example`.

| Var | Default | Purpose |
|---|---|---|
| `PROGRESS_AGENT_MODEL` | `@cf/meta/llama-3.1-8b-instruct-fast` | Progress Agent chat model |
| `HISTORY_EMBED_MODEL` | `@cf/baai/bge-base-en-v1.5` | Embedding model (768-dim — **must match the Vectorize index**) |
| `AGENT_FAKE_AI` | `""` | `"1"` → offline: agent returns a deterministic grounded stub, RAG + doc indexing no-op, workflows use templated text. Lets the whole app build/test with no Cloudflare account. |
| `BLOCKER_REMINDER_DELAY` | `1 hour` | Blocker workflow: wait before the reminder (`"<n> seconds\|minutes\|hours\|days"`) |
| `BLOCKER_ESCALATION_DELAY` | `1 day` | Blocker workflow: wait before the manager escalation |
| `WEEKLY_STEP_TIMEOUT` | `3 days` | Weekly workflow: how long each human step waits before expiring |
| `WEEKLY_MAX_ROUNDS` | `3` | Weekly workflow: max request-changes rounds |

Workers AI, Vectorize, and (when enabled) R2 have **no local emulation** —
`wrangler dev` proxies them to the real services and needs `wrangler login`.
Set `AGENT_FAKE_AI=1` to develop fully offline.

---

## Cloudflare resource setup

One-time, on your account (`wrangler login` first). Names use the `internpulse-*`
convention. **None of these delete or overwrite anything.**

```bash
# D1
wrangler d1 create internpulse
#   → put the returned database_id into wrangler.jsonc  (already set for this account)
wrangler d1 migrations apply internpulse --remote
npm run db:seed:remote

# Vectorize  (already created for this account — do NOT recreate; the data is live)
wrangler vectorize create internpulse-history --dimensions=768 --metric=cosine
wrangler vectorize create-metadata-index internpulse-history --property-name=workspaceId --type=string
wrangler vectorize create-metadata-index internpulse-history --property-name=entityType --type=string

# Queues
wrangler queues create internpulse-history-index
wrangler queues create internpulse-workflow-events

# R2  (requires enabling R2 once in the dashboard: R2 Object Storage → Enable)
wrangler r2 bucket create internpulse-attachments
```

Workers AI, the Durable Objects, the ProgressAgent, and both Workflows are
registered automatically by `wrangler deploy`.

---

## Testing

```bash
npm run build          # worker typecheck + client typecheck + production build
```

Behavioural coverage (Node scripts against `wrangler dev`; see the report in the
PR / commit messages for exact numbers):

| Area | What's checked |
|---|---|
| Realtime | two clients, task/blocker/update broadcast, reconnect snapshot, presence |
| Blockers | reminder fires only if still open; escalation only after the second delay; resolving stops it; no duplicate escalation |
| Weekly | draft → edit → submit → request changes → resubmit → approve → manager visibility; `409` on out-of-state actions |
| Agent | current-state grounding; fresh mutation reflected immediately; `groundedOn` counts |
| RAG | semantic retrieval of old updates/blockers/feedback; workspace isolation; resolved blocker retrieved but never reported as open |
| Documents | upload → R2 → indexed → agent retrieves the right chunk and cites the filename; workspace isolation |
| R2 | upload / list / download / delete; scoped to the right workspace; non-extractable files still stored + downloadable |
| Authorization | invalid role/action → 403/409; no-membership → 403; demo identity never treated as auth |
| AI failure | blocker reminders use templated text; weekly draft falls back to a clearly-marked deterministic report |

Latest run: build clean; Phase 2 realtime 28/28; Phase 3 agent 17/17; blocker
workflow 7/7; weekly workflow 23/23; AI-unavailable 7/7; RAG + documents pass
(subject to Vectorize's ~30–90s async indexing).

`npm run test` (vitest) covers the permission matrix, @mention parsing, the
attention engine, the workspace-socket reconnect/backoff state machine, the
production-auth layer (JWT verification, D1 user resolution, invitations,
admin routes — real SQLite via `node:sqlite`, not a hand-rolled mock), and
the frontend's pure decision logic: the auth state machine
(`deriveAuthState`), onboarding routing (`deriveOnboardingStage`,
`deriveHomeRole`), the production router (`parseProductionHash`), attention
grouping, and invitation error mapping. Component rendering isn't
covered by an automated DOM test suite (no jsdom/Testing Library in this
repo) — verify UI screens locally against `/api/demo/*` and with the
[manual real-Access checklist](docs/real-access-manual-checklist.md) after
deploying.

`npm run load-test -- <N>`, `node scripts/qa-adversarial.mjs`, and
`node scripts/qa-production-auth.mjs` are local-only (`wrangler dev`) tools —
a concurrent-client load test, an authorization/leak/concurrency/input
suite (demo scope), and a production-auth adversarial suite (missing/forged/
malformed Access headers, spoofed identity query params, demo/production
scope isolation in both directions, WS auth rejection). None should be
pointed at the live deployment.

`npm run test:prod-smoke` is a **targeted production smoke test, not a load
test**: it opens a real WS connection as a seeded member, confirms a
non-member is denied, exercises one task/blocker/agent/weekly/attachments
round-trip each, and cleans up any test data it creates (or fails safely into
cleanup via `finally` if a check throws). Run it once after a deploy against
`https://internpulse.amanprabhune.workers.dev` (override with
`INTERNPULSE_URL`) — never in a loop, never with concurrent clients.

---

## Deployment

```bash
wrangler login
npm run build
wrangler deploy
```

`wrangler deploy` uploads the SPA to Workers assets, publishes the Worker, and
registers the DOs / ProgressAgent / both Workflows / both Queue consumers.

**Current live deployment:** `https://internpulse.amanprabhune.workers.dev` — has
D1, Durable Objects, ProgressAgent, Workflows, Queues, Vectorize, and Workers AI.
**Attachments are disabled in production** until R2 is enabled on the account
(`/api/workspace/:id/attachments` returns `503`); the rest works. To finish:
enable R2 in the dashboard, then `wrangler r2 bucket create internpulse-attachments && wrangler deploy`.

---

## Architecture tradeoffs

- **DO SQLite vs D1 for workspace state** — DO SQLite wins: it's transactional
  with the realtime coordinator and needs no network hop. D1 is reserved for
  cross-workspace relational data.
- **Manager overview fans out to each workspace DO** at read time rather than
  denormalising counts into D1. Simple and always-correct; O(workspaces)
  subrequests. A push-based read model would scale better but isn't needed here.
- **Vectorize is retrieval-only.** Current state always comes from the DO; a
  stale retrieved passage never overrides it (enforced in the prompt + tested).
- **Queues at exactly two seams.** Everything else calls directly — Workflows are
  started synchronously from HTTP where safe, human actions are direct
  `sendEvent`, workflow steps call DO RPC directly.
- **Workflow timing is config-driven**, read inside `run()` — production values
  are deliberately not baked in.
- **Documents use `env.AI.toMarkdown`** (a platform utility) plus plain-text
  reading — no PDF/DOCX parser dependency, so document handling can't dominate
  the bundle. Unsupported files are still stored and downloadable.
- **Demo identity is not authentication.** It's centralised, clearly labelled,
  and structurally isolated behind `#/demo` (`src/client/demo/DemoApp.tsx`) —
  the production app (`src/client/production/ProductionApp.tsx`) never
  imports it. Production identity comes from Cloudflare Access; see
  [Production authentication](#production-authentication-cloudflare-access).
- **Tailwind CSS**, adopted via the official `@tailwindcss/vite` plugin, with a
  small semantic token set (`src/client/styles/app.css`) rather than a large
  generic palette. shadcn/Radix was deliberately not adopted wholesale — the
  UI is hand-built utility-first components; a Radix primitive would only be
  reached for later if a specific accessibility-heavy control (e.g. a complex
  combobox) genuinely needed it.

## Known limitations

- **Removing a member or changing an existing member's role is admin-only.**
  A workspace's own mentor/manager can invite, resend, and revoke pending
  invitations (`src/worker/invitations.ts`), but the backend only exposes
  member removal/role-repair through the platform-admin API
  (`src/worker/admin-routes.ts`). The UI reflects this honestly rather than
  inventing a mentor/manager-scoped mutation the backend doesn't enforce —
  extending that authorization boundary is a deliberate follow-up decision,
  not an oversight.
- **No live @mention autocomplete while typing** — mentions still work
  end-to-end (parsing, delivery, the attention/mentions surfaces), just
  without a suggestion dropdown as you type `@`.
- **No global "Files" or cross-workspace aggregation page** — the sidebar's
  Files/Progress Agent links jump into your first workspace's tab; open a
  specific workspace to use its own Attachments/Agent tab for other projects.
- **No component-level DOM test suite** (no jsdom/Testing Library dependency
  in this repo yet) — UI logic that was safe to extract as pure functions
  (auth state, onboarding routing, the router, attention grouping, invitation
  error mapping) has unit tests; rendered screens are verified manually
  against `/api/demo/*` and via the
  [manual real-Access checklist](docs/real-access-manual-checklist.md).
- **No invitation email delivery** — an invitee discovers a pending invite by
  logging in and checking `/api/me`; tell them out-of-band for now (locked
  decision, not a bug).
- **Attachments off in the current production deployment** until R2 is enabled
  (works locally and once the bucket exists).
- **Vectorize indexing is asynchronous** (~30–90s). A brand-new update or
  document is not instantly retrievable by the agent; current DO state is.
- **Workflow delays run in real time.** Set short values in `.dev.vars` to demo
  the blocker reminder/escalation quickly.
- **Weekly review is started manually** (no Friday cron) — deliberate for this phase.
- **No external delivery** — reminders are in-app only; no Slack/email/SMS/calendar.
- **`waitForEvent` in local dev**: after a *timeout* the workflow ends cleanly
  rather than continuing to wait (works around a known local-emulator quirk).
- Single-region D1; last-write-wins on concurrent edits; no offline mode.

---

## Demo walkthrough

See **[`DEMO.md`](./DEMO.md)** for the ~5-minute script.

For a full first-time user/reviewer testing pass — roles, every tab,
realtime/reconnect checks, the blocker and weekly lifecycles, @mentions,
authorization/isolation checks, break-it cases, and a bug report template —
see **[`docs/NEW_USER_TESTING_MANUAL.md`](./docs/NEW_USER_TESTING_MANUAL.md)**.

---

## Project layout

```
migrations/0001_init.sql          D1 schema (users/teams/workspaces/memberships)
migrations/0002_production_auth.sql  access_subject/account_status/platform_role, invitations, audit_events, is_demo
seed/dev-seed.sql                 org data for the demo (Alice / Mia / Jordan)
scripts/demo-seed.mjs             populates a workspace DO with the demo story  (npm run demo:seed)
docs/real-access-manual-checklist.md  post-deploy manual checklist against a real Access session

src/shared/protocol.ts            all types shared by client / Worker / DO / Agent / Workflows
src/worker/index.ts               routes, production/demo split, resolveRole auth seam, overview fan-out
src/worker/access-auth.ts         Cloudflare Access JWT verification (JWKS, issuer/audience/expiry)
src/worker/production-identity.ts D1 user resolution/linking, admin bootstrap, account status
src/worker/invitations.ts         create/accept/revoke/list workspace invitations
src/worker/admin-routes.ts        platform-admin operational endpoints (users/memberships/invites/audit)
src/worker/audit.ts               append-only security/admin audit log
src/worker/workspace-do.ts        WorkspaceDO: transport, validation, broadcast, snapshot, RPC surface
src/worker/workspace-store.ts     DO SQLite schema + migrations (v1→v4) + typed CRUD (no ORM)
src/worker/permissions.ts         the role matrix (canMutate)
src/worker/progress-agent.ts      ProgressAgent: context RPC, RAG retrieval, inference, drafting
src/worker/agent-context.ts       bounded state projection + prompt building (current / history / documents)
src/worker/history-index.ts       vector ids, metadata shape, retrieval rendering
src/worker/documents.ts           text extraction (plain-text + AI.toMarkdown), chunking, R2 key
src/worker/queue-consumer.ts      history/document indexing + workflow-start consumers
src/worker/blocker-workflow.ts    BlockerWorkflow (reminder → escalation)
src/worker/weekly-workflow.ts     WeeklyReviewWorkflow (draft → submit → review loop)
src/worker/reminders.ts           deterministic reminder / weekly-draft text; isoWeek()

src/client/Root.tsx               picks DemoApp vs. ProductionApp purely from the #/demo hash prefix
src/client/router.ts              hand-rolled production router (parse/build hash routes)
src/client/auth/                  AuthProvider/AuthGate (the 8-state session machine) + pure decisions
src/client/production/            ProductionApp: routes onboarding/invitations/home/workspace/admin/settings
src/client/demo/                  DemoApp: the pre-existing identity-switcher experience, fully isolated
src/client/home/                  role-aware Intern/Mentor/Manager homes + cross-workspace Mentions/Weekly pages
src/client/onboarding/            welcome, invitation acceptance, create-workspace screens
src/client/workspace/             WorkspaceView (shared by demo + production) + WorkspaceSettings
src/client/shell/                 Sidebar, Topbar, ProfileMenu, WorkspaceSwitcher
src/client/admin/                 /admin: users, workspaces/memberships, invitations, audit, health
src/client/settings/              profile/settings screen
src/client/ui/                    small shared Tailwind primitives, badges, loading/empty/error states
src/client/lib/                   API clients, useWorkspace hook, workspaceApi mode (demo vs. production)
```
