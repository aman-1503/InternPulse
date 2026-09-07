# InternPulse

A realtime internship/project progress platform where interns, mentors, and
managers share one continuously updated workspace instead of maintaining
separate status documents.

> **Status: Phase 4B — Workflows: reminders, escalation, weekly review.**
> Everything from Phase 4A plus two durable Cloudflare Workflows: a blocker
> reminder/escalation flow (started when a blocker is created) and a
> human-in-the-loop weekly progress review (draft → intern submit → mentor
> approve/request-changes → manager view). In-app reminders only. The agent
> drafts wording but never mutates workspace state. Still no R2, no Slack/email,
> no cron triggers.

## Architecture

```
React (Vite SPA)
   │  HTTP for bootstrap/overview/agent, WebSocket for realtime collaboration
   ▼
Cloudflare Worker  ──────────────►  D1  (users, teams, workspaces, memberships/roles)
   │  authorization boundary: resolves (workspaceId, userId) → role  [ONE boundary for all routes]
   │  idFromName(workspaceId) / getAgentByName(PROGRESS_AGENT, workspaceId)
   │  queue() consumer  ◄── HISTORY_QUEUE ◄── WorkspaceDO enqueues {workspaceId,entityType,entityId}
   ▼                          │  re-reads entity from WorkspaceDO → embed → upsert
Workspace Durable Object  ◄─── DO-to-DO RPC ───  ProgressAgent  (Agents SDK, one per workspace)
   │  (one per workspace)   getAgentContext / getIndexableEntity  │  per question:
   ├─ DO SQLite  (tasks, blockers, updates, …)  ← the ONLY       │   1. getAgentContext (current, primary)
   │                                              source of      │   2. Vectorize.query scoped to workspace
   └─ WebSockets (Hibernation API)                truth          │   3. Workers AI chat  (current state wins conflicts)
                                                                 └─ Agent SQLite: conversation turns only
Vectorize  (internpulse-history, 768-dim cosine)  ← retrieval index ONLY, never source of truth

Phase 4B:
  blocker.created ─► WORKFLOW_QUEUE ─► queue() ─► BLOCKER_WORKFLOW.create(id: blocker-<id>)
       BlockerWorkflow: sleep → re-read blocker from DO → reminders (intern+mentor) → sleep → re-read → escalate (manager)
  "Start weekly review" (HTTP) ─► WEEKLY_WORKFLOW.create(id: weekly-<reportId>)
       WeeklyReviewWorkflow: agent draft → waitForEvent(submit) → waitForEvent(review) → APPROVE | REQUEST_CHANGES↺
  Human actions (submit / review) ─► HTTP route ─► instance.sendEvent(...)   (no HTTP request held open)
  reminders + weekly_reports live in DO SQLite; Workflows only advance the lifecycle.
```

**Data responsibility** (never duplicated across the two stores):

| Store | Owns |
|-------|------|
| **D1** | Organization-wide relational data: users, teams, workspaces, memberships + role. |
| **DO SQLite** | Everything workspace-local: `tasks`, `blockers`, `updates`, `feedback`, `activity`, `workspace_meta`, `processed_requests`. |
| **Agent SQLite** | Only Progress Agent conversation turns (`conversations`) + tiny SDK state. **No** task/blocker/update data. |
| **Vectorize** | Embeddings + minimal metadata (`workspaceId`, `entityType`, `entityId`, `authorId?`, `createdAt`, `status?`, ≤240-char `snippet`) for UPDATE/BLOCKER/FEEDBACK. Retrieval only. Rebuildable from DO SQLite. |
| Presence | Ephemeral only — lives on hibernatable sockets, never persisted. |

The **manager overview** joins the two at read time: it lists workspaces from D1
and fans out to each workspace DO's `GET /summary` for live counts. No
workspace-local state is copied into D1.

## Requirements

- **Node.js >= 22** (`.nvmrc` present → `nvm use`).
- npm.

## Local development

```bash
nvm use
npm install
cp .dev.vars.example .dev.vars   # keeps AGENT_FAKE_AI=1 → agent runs offline
npm run cf-typegen               # regenerate worker-configuration.d.ts (after wrangler.jsonc edits)
npm run db:migrate:local         # D1 schema
npm run db:seed:local            # DEV/DEMO users + workspaces + memberships
npm run dev                      # http://localhost:5173
```

Open the app, use the **DEMO identity** switcher (top right) to become Alice
(intern) / Mia (mentor) / Max (manager). Open the same workspace in a second
window as a different identity to see realtime sync. The **Agent** tab answers
questions about the workspace.

### Progress Agent / Workers AI

The agent's inference layer is **Cloudflare Workers AI** (`env.AI`), which has
**no offline local runtime** — `wrangler dev` proxies it to the real service.

- **Offline (default):** `.dev.vars` has `AGENT_FAKE_AI=1`. The agent fetches the
  real authoritative workspace context and returns a **deterministic answer built
  from it** — no model call. Grounding, role-awareness, freshness, auth and
  persistence all work; only the LLM phrasing is stubbed.
- **Real model:** run `wrangler login` (or export `CLOUDFLARE_API_TOKEN`), set
  `AGENT_FAKE_AI=0` in `.dev.vars`, restart `npm run dev`. Uses
  `@cf/meta/llama-3.1-8b-instruct-fast` (override with `PROGRESS_AGENT_MODEL`).
  Workers AI free allocation is 10,000 Neurons/day. If the service is
  unreachable the agent returns a clean `ai_unavailable` error — it never
  fabricates an answer.

No secrets are committed. `.dev.vars` is gitignored; `.dev.vars.example` holds
only placeholder names.

### RAG / Vectorize history (Phase 4A)

A mutation to an **UPDATE / BLOCKER / FEEDBACK** enqueues a compact
`{workspaceId, entityType, entityId}` event on `HISTORY_QUEUE` (never the record
itself). The `queue()` consumer re-reads the current entity from WorkspaceDO,
embeds it with **`@cf/baai/bge-base-en-v1.5` (768-dim)**, and upserts it into the
**`internpulse-history`** Vectorize index under `namespace = workspaceId`. On each
agent question, retrieval is scoped by both `namespace` and a `workspaceId`
metadata filter, `topK` 4, min score 0.35. Retrieved history is a clearly
separated, secondary prompt section — **current WorkspaceDO state wins any
conflict** (a resolved blocker is never reported as open).

- **Queues** run fully locally in `wrangler dev` (no provisioning). For
  `wrangler deploy`: `wrangler queues create internpulse-history-index`.
- **Vectorize has no local emulation** — the binding is `"remote": true`, so
  `wrangler dev` uses the real index and needs `wrangler login`. One-time setup:

  ```bash
  wrangler vectorize create internpulse-history --dimensions=768 --metric=cosine
  wrangler vectorize create-metadata-index internpulse-history --property-name=workspaceId --type=string
  wrangler vectorize create-metadata-index internpulse-history --property-name=entityType --type=string
  ```

- **Offline (`AGENT_FAKE_AI=1`):** the consumer no-ops and the agent skips
  retrieval (`retrievedHistory: 0`) — build, CI and offline dev need no
  Cloudflare account. The producer → consumer path still runs.
- The index is a retrieval cache: `rm -rf .wrangler/state` resets DO state, and
  stale vectors are overwritten (deterministic ids) or cleaned up when their
  entity is gone. To wipe it entirely: `wrangler vectorize delete internpulse-history`
  then recreate.

### Workflows: reminders + weekly review (Phase 4B)

Two durable Cloudflare Workflows (`BlockerWorkflow`, `WeeklyReviewWorkflow`),
exported from `src/worker/index.ts`.

- **Blocker reminder/escalation** — when a blocker is created, `WorkspaceDO`
  enqueues `{kind:"blocker.workflow.start", …}` on `WORKFLOW_QUEUE` (best-effort,
  off the ack path). The `queue()` consumer calls
  `BLOCKER_WORKFLOW.create({ id: "blocker-<blockerId>" })` — a deterministic id,
  so duplicate starts are a no-op. The workflow sleeps `BLOCKER_REMINDER_DELAY`,
  **re-reads the blocker from `WorkspaceDO`** (RESOLVED/gone → stop), creates
  in-app reminders for intern + mentor, sleeps `BLOCKER_ESCALATION_DELAY`,
  re-reads again, then escalates to the manager. Reminders dedup on
  `(entity_type, entity_id, type, recipient_role)` — no duplicate escalation.
- **Weekly review** — `POST /api/workspace/:id/weekly` (intern or mentor) creates
  a `weekly_reports` row and starts `WEEKLY_WORKFLOW` (`id: "weekly-<reportId>"`).
  The workflow: `step.do` draft (ProgressAgent → current state + RAG history →
  Workers AI; **deterministic marked draft** if AI fails) → `waitForEvent`
  intern-submit → `waitForEvent` mentor-review → `APPROVE` (finalize, notify
  manager) or `REQUEST_CHANGES` (loop, ≤ `WEEKLY_MAX_ROUNDS`). Human actions are
  plain HTTP routes that call `instance.sendEvent(...)` — no request is held open
  across the waits.

Timing is **config-driven** (`.dev.vars`) — short seconds locally, never baked
in. `compatibility_date` is `2025-09-01` (needed for `step.waitForEvent`).
Workflows and both queues run fully in `wrangler dev`. For `wrangler deploy`:
`wrangler queues create internpulse-workflow-events` (Workflows deploy with the
Worker).

In-app **reminders** live in `reminders` (DO SQLite); **weekly reports** in
`weekly_reports`. The workflows only advance the lifecycle — the rows are the
source of truth. New WS events: `reminder.created`, `reminder.updated`,
`weekly.updated`; the snapshot carries the caller's `reminders` + `weeklyReports`.

### Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite + Worker + DO, one dev server. |
| `npm run build` | Typecheck (worker + client) then production build. |
| `npm run db:migrate:local` | Apply `migrations/*.sql` to local D1. |
| `npm run db:seed:local` | Load `seed/dev-seed.sql` (dev data — **not** a migration). |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts`. |

To reset local workspace state: `rm -rf .wrangler/state`.

## Roles (Phase 2 matrix)

| Action | intern | mentor | manager | no membership |
|---|:--:|:--:|:--:|:--:|
| read workspace / snapshot | ✅ | ✅ | ✅ | ✅ (read-only) |
| task create / update / move / delete | ✅ | ✅ | — | — |
| post update · raise blocker | ✅ | ✅ | ✅ | — |
| resolve blocker · add feedback | — | ✅ | — | — |
| manager overview | ✅ | ✅ | ✅ | ✅ |

Identity (`userId`/`displayName`) is supplied by the browser and is **DEV/DEMO
only — not authentication**. The Worker's `resolveRole` is the single seam a real
identity provider replaces later; nothing downstream changes.

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Liveness + D1 reachability. |
| `GET` | `/api/workspaces` | List workspaces (D1). |
| `GET` | `/api/overview?userId=` | Manager overview: D1 workspaces + per-DO live counts. |
| `GET` | `/api/workspace/:id/ws` | WebSocket upgrade → workspace DO. |
| `GET` | `/api/workspace/:id/snapshot` | Authoritative snapshot as JSON (debug/testing). |
| `GET` | `/api/workspace/:id/summary` | `{activeTasks, openBlockers, latestUpdate}` (used by overview). |
| `GET` | `/api/workspace/:id/agent` | This user's Progress Agent conversation history. |
| `POST` | `/api/workspace/:id/agent` | Ask the Progress Agent (`{prompt}`) — grounded in current state + retrieved history. Response includes `groundedOn` (current-state counts + `retrievedHistory`) and `retrieved[]` (metadata only, no vectors). |
| `GET` | `/api/workspace/:id/reminders` | This user's reminders (by role, or pinned to them). |
| `POST` | `/api/workspace/:id/reminders/:rid/ack` | Acknowledge a reminder. |
| `POST` | `/api/workspace/:id/weekly` | Start a weekly review (intern/mentor). Idempotent per period. |
| `GET` | `/api/workspace/:id/weekly` | List reports (managers see only `APPROVED`). |
| `GET` | `/api/workspace/:id/weekly/:rid` | One report (managers: only if `APPROVED`). |
| `PATCH` | `/api/workspace/:id/weekly/:rid` | Edit the draft (intern; only `DRAFT`/`CHANGES_REQUESTED`). |
| `POST` | `/api/workspace/:id/weekly/:rid/submit` | Intern submits → workflow event. |
| `POST` | `/api/workspace/:id/weekly/:rid/review` | Mentor `{decision, feedback?}` → workflow event. |

All routes go through the **same `resolveRole` boundary** as every other
workspace route: no resolvable role → `403`. Weekly review adds per-action role
checks (intern edits/submits, mentor reviews) and returns `409` for
out-of-state actions (submit twice, approve an approved report, edit while under
review).

## Realtime protocol

Typed in [`src/shared/protocol.ts`](src/shared/protocol.ts), imported by client + Worker + DO.

- **client → DO** (every mutation carries `requestId`): `task.create`, `task.update`, `task.move`, `task.delete`, `blocker.create`, `blocker.resolve`, `update.create`, `feedback.create`, `ping`.
- **DO → client**: `workspace.snapshot`, `task.created/updated/deleted`, `blocker.created/resolved`, `update.created`, `feedback.created`, `activity.created`, `presence.updated`, `reminder.created/updated`, `weekly.updated`, `ack` (idempotency), `error`, `pong`.

The DO is authoritative: it validates, persists to SQLite, records activity,
de-duplicates by `requestId` (`processed_requests` table, pruned after 1h),
broadcasts the result, and replays a full snapshot on every (re)connect.
Concurrent edits are last-write-wins.

## Drag and drop

Native HTML5 DnD — no dependency. A `TaskCard` is `draggable` and puts its id on
`dataTransfer`; a `Column` calls `preventDefault` on `dragover` and on `drop`
reads the id and sends `task.move`. The move round-trips through the DO and comes
back as `task.updated`.

## Project layout

```
migrations/0001_init.sql          D1 schema
seed/dev-seed.sql                 DEV/DEMO seed data
src/shared/protocol.ts            Types shared across client / Worker / DO / Agent
src/worker/index.ts               Routes, authorization boundary, overview fan-out, agent route
src/worker/workspace-do.ts        WorkspaceDO: transport, validation, broadcast, snapshot, getAgentContext RPC
src/worker/workspace-store.ts     DO SQLite schema + migration + typed CRUD (no ORM)
src/worker/permissions.ts         Role matrix
src/worker/progress-agent.ts      ProgressAgent (Agents SDK): context fetch, RAG retrieval, inference, conversation store
src/worker/agent-context.ts       Pure: bounded state projection + prompt building (+ history section) + offline stub
src/worker/history-index.ts       Pure: entity→text, vector id, metadata shape, history-block rendering
src/worker/queue-consumer.ts      HISTORY_QUEUE + WORKFLOW_QUEUE consumers
src/worker/blocker-workflow.ts    BlockerWorkflow: durable reminder → escalation
src/worker/weekly-workflow.ts     WeeklyReviewWorkflow: draft → submit → review (human-in-the-loop)
src/worker/reminders.ts           Pure: deterministic reminder/escalation/weekly-draft text; isoWeek()
src/client/                       React SPA: identity, useWorkspace hook, components/ (incl. RemindersPanel), tabs/ (incl. AgentTab, WeeklyTab), board/
```

## Deliberately deferred (post-4B)

R2 + file attachments + document indexing, Slack/email/SMS/calendar delivery
channels, cron/scheduled Workflow triggers (e.g. auto Friday weekly review),
agent-triggered state mutations, blocker auto-resolution, analytics / performance
scoring, real authentication, comments, task/activity indexing, retrieval
re-ranking, reminder snooze UI, and reorder-within-column / touch / keyboard
drag-and-drop.
