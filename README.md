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

Three roles, resolved once per request at **`resolveRole()`** in `src/worker/index.ts` — the single authorization seam.

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

## Screenshots

_No screenshots are checked in yet._ Placeholders — capture from the live demo:

- `docs/screenshots/overview.png` — workspace Overview / Today
- `docs/screenshots/board.png` — draggable board
- `docs/screenshots/agent.png` — Progress Agent with grounding panel
- `docs/screenshots/weekly.png` — weekly review lifecycle
- `docs/screenshots/manager.png` — manager overview

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

Open the app → use the **demo identity switcher** (top-right) to become Alice
Chen (intern), Mia Rivera (mentor), or Jordan Park (manager). Open the same
workspace in a second browser to see realtime sync.

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
attention engine, and the workspace-socket reconnect/backoff state machine.
`npm run load-test -- <N>` and `node scripts/qa-adversarial.mjs` are local-only
(`wrangler dev`) tools — an authorization/leak/concurrency/input-robustness
suite and a concurrent-client load test. Neither should be pointed at the
live deployment.

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
- **Demo identity is not authentication.** It's centralised and clearly labelled;
  `resolveRole()` is the single seam a real provider replaces.

## Known demo limitations

- **Demo authentication only.** The browser picks who it is (`userId` /
  `displayName`); an unassigned identity chooses a role via a dev selector. This
  is explicit in the UI and code. Do not treat it as production auth.
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
seed/dev-seed.sql                 org data for the demo (Alice / Mia / Jordan)
scripts/demo-seed.mjs             populates a workspace DO with the demo story  (npm run demo:seed)

src/shared/protocol.ts            all types shared by client / Worker / DO / Agent / Workflows
src/worker/index.ts               routes, the resolveRole auth seam, overview fan-out, queue() dispatch
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
src/client/                       React SPA: identity, useWorkspace hook, components/, tabs/, board/
```
