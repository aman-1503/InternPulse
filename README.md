# InternPulse

A realtime internship/project progress platform where interns, mentors, and
managers share one continuously updated workspace instead of maintaining
separate status documents.

> **Status: Phase 3 — stateful Progress Agent.** Everything from Phase 2 plus a
> Cloudflare Agents SDK agent per workspace that answers questions grounded in
> current workspace state, using Workers AI. Still no Vectorize/RAG, no
> Workflows/Queues, no R2, no notifications.

## Architecture

```
React (Vite SPA)
   │  HTTP for bootstrap/overview/agent, WebSocket for realtime collaboration
   ▼
Cloudflare Worker  ──────────────►  D1  (users, teams, workspaces, memberships/roles)
   │  authorization boundary: resolves (workspaceId, userId) → role  [ONE boundary for all routes]
   │  idFromName(workspaceId) / getAgentByName(PROGRESS_AGENT, workspaceId)
   ▼
Workspace Durable Object  ◄─── DO-to-DO RPC ───  ProgressAgent  (Agents SDK, one per workspace)
   │  (exactly one per workspace)   getAgentContext(role)   │  reads a BOUNDED projection per question
   ├─ DO SQLite  (tasks, blockers, updates, …)  ← the ONLY  │  ├─ Agent SQLite: conversation turns only
   │                                              source of  │  └─ Workers AI (@cf/meta/llama-3.1-8b-instruct-fast)
   └─ WebSockets (Hibernation API)                truth      │     or a deterministic offline stub
```

**Data responsibility** (never duplicated across the two stores):

| Store | Owns |
|-------|------|
| **D1** | Organization-wide relational data: users, teams, workspaces, memberships + role. |
| **DO SQLite** | Everything workspace-local: `tasks`, `blockers`, `updates`, `feedback`, `activity`, `workspace_meta`, `processed_requests`. |
| **Agent SQLite** | Only Progress Agent conversation turns (`conversations`) + tiny SDK state. **No** task/blocker/update data. |
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
| `POST` | `/api/workspace/:id/agent` | Ask the Progress Agent (`{prompt}`) — response grounded in current state. |

Agent routes go through the **same `resolveRole` boundary** as every other
workspace route: no resolvable role → `403`.

## Realtime protocol

Typed in [`src/shared/protocol.ts`](src/shared/protocol.ts), imported by client + Worker + DO.

- **client → DO** (every mutation carries `requestId`): `task.create`, `task.update`, `task.move`, `task.delete`, `blocker.create`, `blocker.resolve`, `update.create`, `feedback.create`, `ping`.
- **DO → client**: `workspace.snapshot`, `task.created/updated/deleted`, `blocker.created/resolved`, `update.created`, `feedback.created`, `activity.created`, `presence.updated`, `ack` (idempotency), `error`, `pong`.

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
src/worker/progress-agent.ts      ProgressAgent (Agents SDK): context fetch, inference, conversation store
src/worker/agent-context.ts       Pure: bounded state projection + prompt building + offline stub
src/client/                       React SPA: identity, useWorkspace hook, components/, tabs/ (incl. AgentTab), board/
```

## Deliberately deferred (Phase 4+)

Vectorize / RAG over historical updates & feedback, Cloudflare Workflows &
Queues, automated reminders / blocker escalation / weekly-report approval, R2
uploads, notifications (Slack/email/calendar), agent-triggered actions, analytics
/ scoring, real authentication, comments, and reorder-within-column / touch /
keyboard drag-and-drop.
