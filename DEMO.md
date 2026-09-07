# InternPulse — 5-minute demo script

**Live:** https://internpulse.amanprabhune.workers.dev
**Local:** `npm run dev` → http://localhost:5173, then `npm run demo:seed`

Open **two browser windows** side by side:
- **A** = intern (identity switcher → *Alice Chen*)
- **B** = mentor (identity switcher → *Mia Rivera*)

A third tab as *Jordan Park* (manager) for the last section.

The demo workspace is **`#/w/demo`** — "Authentication / Worker Integration".

---

### 0 · The problem (20s)

> "Internship progress lives in five places — a Google Doc, a task tracker, DM
> threads, mentor notes, a status email. Nobody sees the same thing. InternPulse
> is one realtime workspace the intern, mentor, and manager all share."

### 1 · The shared workspace (40s)  — window A, intern

- **Overview** tab: latest daily update, active tasks, the open blocker, recent
  mentor feedback, and a **Next actions** panel.
- **Board** tab: drag *"Store sessions in the workspace Durable Object"* from
  IN PROGRESS to… back and forth. It's a normal board — but it's not the point.

### 2 · Realtime, to the mentor (30s)  — A then B

- Window A (intern): **Board** → create a task *"Add PKCE unit tests"*.
- Window B (mentor): it appears immediately, no refresh. Presence shows both users.
- Window A: **Overview** → post a daily update: *"Narrowed the Safari bug to
  double base64url-encoding of the verifier."*
- Window B: it's already there.

### 3 · Blockers → role-aware reminders → escalation (60s)

- Window A (intern): **Blockers** → raise *"Staging deploy is failing on the new
  cookie flags — blocked until infra takes a look."*
- Window B (mentor) sees it instantly.
- Explain the workflow (running now as a durable Cloudflare Workflow):
  > "After `BLOCKER_REMINDER_DELAY` it re-reads the blocker from the Durable
  > Object — if it's still open, intern **and** mentor get an in-app reminder.
  > After `BLOCKER_ESCALATION_DELAY`, still open → the **manager** gets an
  > escalation. Resolve it and the workflow stops. No duplicates."
- With short local delays (`.dev.vars`) the reminder lands in ~45s — check the
  **"Needs attention"** badge in the header in both windows.

### 4 · Mentor feedback (20s)  — window B, mentor

- **Feedback** tab → *"Good catch on the encoding. Add a regression test for the
  Safari path before the PR."* → intern sees it live.

### 5 · Weekly progress review — human-in-the-loop Workflow (75s)

- Window A (intern): **Weekly** tab → **Start weekly review**.
  > "A Cloudflare Workflow starts. Step one: the Progress Agent drafts the report
  > from *current* workspace state plus retrieved history and any uploaded docs —
  > using Workers AI. If AI were down it'd produce a clearly-marked deterministic
  > draft instead."
- Draft appears (a few seconds). Intern edits a line → **Submit for review**.
- Window B (mentor): the report shows as **SUBMITTED**, mentor got a reminder.
  Click **Request changes** with a note → intern's copy flips to
  **CHANGES_REQUESTED**.
- Window A: edit, **Submit** again. Window B: **Approve**.
- The workflow finalizes the report. Mention: *no HTTP request was held open
  across any of this — it's `waitForEvent`.*

### 6 · Manager view (30s)  — third tab, Jordan Park

- **Manager overview**: cards for both projects — active tasks, **open blocker
  count**, latest update, intern name. Any escalation reminder is here.
- Open **Authentication / Worker Integration** → it's the *same* workspace the
  intern and mentor are in. Open the **approved weekly report**.

### 7 · The Progress Agent (60s)  — window A, **Agent** tab

Ask, in order:

1. **"What am I currently blocked on?"**
   → names the real open blocker. Grounding panel shows current-state counts.
2. **"Have we had blockers about staging or database access before?"**
   → retrieves the earlier *resolved* blocker from Vectorize and says it was
   **resolved** — it does not claim it's open. (Current DO state wins.)
3. **"What do the uploaded design notes say about refresh-token rotation?"**
   → cites `auth-design-notes.md` — a chunk retrieved from Vectorize, backed by
   the original file in R2. Grounding panel shows *N document chunks*.

> "Same agent, three sources — current Durable Object state, historical records,
> and document knowledge — kept distinct, always workspace-scoped, never
> mutating anything."

### 8 · Architecture (25s)

> "One Worker. Durable Objects are the authoritative realtime workspace with
> their own SQLite. D1 holds org/membership metadata. The Agents SDK gives each
> workspace a stateful Progress Agent on Workers AI. Vectorize is RAG over
> history and documents. Queues do the async indexing and workflow hand-off.
> Workflows run the durable human-in-the-loop processes. R2 stores the files.
> All Cloudflare, and it stays focused on intern progress — not a PM clone."

---

## What each primitive is doing, live

| Primitive | On screen |
|---|---|
| **Durable Objects** | the shared workspace both windows edit in realtime |
| **DO SQLite** | tasks/blockers/updates surviving a refresh (snapshot on reconnect) |
| **D1** | the manager overview across two projects; role resolution |
| **Agents SDK + Workers AI** | the Progress Agent's grounded answers + the weekly draft |
| **Vectorize** | "have we had this blocker before" + the document citation |
| **Queues** | the reminder/escalation workflow starting after a blocker is raised; docs becoming searchable |
| **Workflows** | the reminder → escalation sequence; the weekly draft → submit → review loop |
| **R2** | the uploaded `auth-design-notes.md`, downloadable, its text in Vectorize |
