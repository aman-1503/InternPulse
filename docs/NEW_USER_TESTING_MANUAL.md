# InternPulse — New User / Reviewer Testing Manual

This is a hands-on guide for the first time you sit down with InternPulse —
whether you're a reviewer trying it out, a new contributor, or doing a QA
pass before a release. No prior context needed; everything you need to poke
at the product is below.

**Where to test:** the live demo at
**https://internpulse.amanprabhune.workers.dev**, or a local instance via
`npm run dev` (see the main [README](../README.md#local-setup)). Everything
in this manual applies to either.

---

## 1. What InternPulse is

InternPulse is **one realtime workspace** for an internship or project,
shared continuously by three people:

- the **intern**, who owns their day-to-day work,
- the **mentor**, who guides them, and
- the **manager**, who needs visibility without micromanaging.

Instead of a Google Doc the intern updates, a Slack thread the mentor
half-reads, and a status meeting the manager schedules to find out what's
actually happening, everyone looks at the **same live workspace**: one task
board, one blocker list, one activity feed, one weekly review — updated in
real time as anyone changes anything.

It is deliberately **not** a general-purpose project-management tool. Every
surface — tasks, blockers, feedback, the weekly review, the AI agent — exists
to answer one question for each role: *what is my intern/mentee/team actually
doing right now, and what needs my attention?*

A workspace is one intern + their mentor + their manager (+ optionally a
couple of extra members). Different interns live in **different
workspaces** — InternPulse never merges multiple interns' work into one
shared board.

---

## 2. Testing with Alice / Mia / Jordan side by side

The demo ships three seeded identities in one workspace ("demo" — the
Authentication / Worker Integration project):

| Name | Role |
|---|---|
| **Alice Chen** | intern |
| **Mia Rivera** | mentor |
| **Jordan Park** | manager |

You pick who you are from the **"DEMO identity"** dropdown in the top bar.
This is explicitly *not* real authentication — it's how the demo lets you
try every role. Whoever you pick, your role for a given workspace is always
resolved from real backend membership data, not just claimed by the picker
(more on this in [§13](#13-authorization--workspace-isolation-checks)).

**Important — this is stored per browser, not per tab.** The identity picker
saves your choice to that browser's local storage, which is **shared across
every tab in the same browser window/profile**. Opening three plain tabs in
one Chrome window and picking a different name in each will not work — all
three tabs will show whichever identity you picked *last*.

To actually run Alice, Mia, and Jordan side by side, use **three separate
browser contexts**, one identity per context:

1. A normal window → pick **Alice Chen**.
2. An incognito/private window (or a second browser, or a second OS user
   profile) → pick **Mia Rivera**.
3. A third incognito window (or third browser) → pick **Jordan Park**.

Arrange the three windows side by side and open the same workspace
(`#/w/demo`) in each. Now anything one of you does — moving a task, raising a
blocker, posting an update — should appear in the other two windows within a
second or two, with no refresh.

There's also a **"Guest"** option in the identity picker for a random
identity with no real membership anywhere. Since InternPulse requires real
membership to read *or* write a workspace, a guest will be denied access to
every workspace (see [§13](#13-authorization--workspace-isolation-checks)) —
that's expected, not a bug.

---

## 3. Role explanations

| | Intern | Mentor | Manager |
|---|---|---|---|
| Task board | Owns it — create, edit, move, delete their own tasks | Can change a task's **priority** only, never its status/content | Can change a task's **priority** only, never its status/content |
| Blockers | Raises them, comments, requests resolution | Comments, **resolves with a note** | Comments, **resolves with a note**, **escalates** |
| Feedback | Reads it | Posts it | Posts it (backend allows this — see [§12](#12-break-it-cases)) |
| Daily updates | Posts them | Reads them | Reads them |
| Weekly review | Drafts, edits, submits | Approves / requests changes | Can **override** a stuck mentor review |
| Progress Agent | Ask questions | Ask questions | Ask questions |
| Add workspace members | — | Yes | Yes |

The one rule worth internalizing before you test anything else: **the
intern owns their own task's status and content. Neither the mentor nor the
manager can move, edit, or delete an intern's task** — they can only change
its priority, comment, and act on blockers/reviews. If you find a way for a
mentor or manager to rewrite an intern's task title, description, or status
(via the UI *or* by crafting a request), that is a real bug — see
[§14](#14-what-counts-as-a-bug).

---

## 4. The workspace tabs

Open a workspace and you'll see eight tabs. A quick tour of what each is for
before you start testing:

| Tab | What it's for |
|---|---|
| **Overview** | Role-specific "home" — curated for what *this* role needs to see first (interns see their tasks/blockers/mentions; mentors see who's waiting on them; managers see escalations and report status). |
| **Board** | The task board (TODO / IN_PROGRESS / BLOCKED / DONE columns), with priority, due date, and an overdue indicator. |
| **Blockers** | Every open/awaiting-confirmation blocker as a card: description, who raised it, age, linked task, whether the mentor has responded, the discussion thread, and resolve/escalate actions. |
| **Feedback** | Mentor → intern feedback, optionally tied to a specific task. |
| **Activity** | A chronological feed of everything that's happened — every task move, blocker action, update, and review decision. |
| **Weekly** | The weekly review lifecycle: draft → submit → mentor review → (resubmit if changes requested) → approve, with a visible stepper. |
| **Agent** | Ask the Progress Agent questions about the workspace; it answers grounded in *current* state plus retrieved history/documents. |
| **Attachments** | Upload/download project files; text-bearing files get indexed for the agent to cite. |

Click through all eight as each of the three roles at least once. Confirm
the tab you're looking at makes sense for who you're logged in as (e.g. the
intern's Overview should foreground *their* tasks; the manager's shouldn't
be cluttered with routine, on-time work).

---

## 5. Realtime testing

With Alice and Mia open side by side (see §2):

1. As Alice, create a task on the Board. **Mia's Board should show it within
   a second or two, with no refresh.**
2. As Alice, drag the task to a different column. Mia sees the move live.
3. As Mia, change that task's priority. Alice sees the badge update live.
4. As Alice, post a daily update on Overview. It appears in Mia's Overview
   and Activity feed immediately.
5. Check the presence indicator (near the top) — it should reflect how many
   distinct people are currently connected to the workspace (opening the
   same identity in two tabs counts as one person, not two — presence
   dedupes by identity, not by connection).

If anything requires a manual refresh to show up, or shows up out of order,
or shows a stale/incorrect final value once things settle, that's a bug.

---

## 6. Blocker lifecycle testing

As **Alice** (intern), go to Blockers and raise one — give it a real
description, optionally linking it to a task.

1. Confirm it appears immediately for Mia and Jordan too.
2. As **Mia** (mentor), add a comment on it. Confirm the card now shows
   "mentor responded."
3. As **Alice**, click **"Request resolution."** The card's status should
   change to a distinct "awaiting confirmation" state — this represents
   "I think it's fixed, please confirm," not "it's done."
4. Try, as Alice, to resolve the blocker yourself. **This should not be
   possible** — only a mentor or manager can perform the final resolution.
5. As **Mia** or **Jordan**, resolve it. You should be **required to enter a
   resolution note** — try resolving with an empty note and confirm it's
   rejected.
6. Confirm the resolved card now clearly shows who resolved it, their note,
   and when.
7. As **Jordan** (manager), raise a new blocker as Alice and try
   **"Escalate."** Only the manager should be able to escalate; try it as
   Mia first and confirm it's refused.
8. Try double-resolving the same blocker (e.g. two browser windows resolving
   it within a second of each other). Both attempts should not corrupt the
   state — exactly one resolution note should "win," and every client should
   converge to the same final state.

---

## 7. Reminder / attention testing

Each role has a **"Needs attention"** panel in the top-right of the
workspace, and the Overview tab is curated around the same idea. What
belongs there is genuinely different per role — this is one of the more
interesting things to probe:

- **As the intern:** you should see things like a rejected/changes-requested
  weekly review, an @mention, a task due today, or an overdue task. You
  should *not* see mentor/manager-internal escalation chatter.
- **As the mentor:** you should see blockers waiting on you (and a
  stronger signal once a while has passed with no response from you), weekly
  reports ready for review, and urgent/high-priority tasks that are blocked.
- **As the manager:** you should see only the things that matter at that
  level — a blocker unresolved for a long time, an urgent task still
  blocked, a report waiting too long for review, and explicit escalations.
  You should **not** see routine, on-time, low-priority noise.

Things to try:
1. Confirm an item disappears from the panel once its underlying condition
   is resolved (e.g. resolving a blocker removes the mentor's "waiting on
   you" item for it) — items should never need a manual "dismiss," and they
   should never keep nagging about something that's already fixed.
2. Click an attention item and confirm it navigates you to the right tab /
   entity instead of just being a label.
3. Raise the same condition twice in a row (e.g. two blockers close
   together) and make sure you get one item per real thing, not duplicates
   for the same underlying condition.

---

## 8. @mention testing

You can mention a workspace member in a task comment/feedback, a blocker
comment, a daily update, or a weekly review comment, using either form:

- the natural form, e.g. `@Mia Rivera`
- the compact handle form, e.g. `@MiaRivera` (case-insensitive)

Try:
1. A single mention (`@Mia Rivera, can you take a look?`) — confirm Mia gets
   a notification/attention item referencing where it came from.
2. Multiple mentions in one message — confirm everyone mentioned gets one.
3. An invalid mention (`@SomeoneNotInThisWorkspace`) — confirm nothing
   breaks and no notification is created for a person who doesn't exist in
   this workspace.
4. Mentioning yourself — shouldn't error, but also shouldn't be a
   particularly useful "notify yourself" case.
5. Submitting the exact same comment twice in a row (e.g. a slow network
   causing a double-click double-submit) — confirm you don't get two
   duplicate mentions for what was really one message.
6. Try mentioning in each surface listed above (task/feedback comment,
   blocker comment, daily update, weekly review comment) — confirm it works
   consistently in all of them, not just one.

---

## 9. Weekly review testing

The lifecycle is: **Draft → Submitted → Mentor Review → (Changes Requested →
Resubmitted → Mentor Review again) → Approved**. The Weekly tab shows this
as a visible stepper on the report itself.

1. As **Alice**, start a weekly review. The agent drafts an initial version
   from current workspace state (or a clearly-labeled deterministic
   fallback if AI is unavailable) — read it, edit it, and **Submit**.
2. As **Mia**, open the same report and confirm it now shows as awaiting her
   review. **Request changes** with a specific note.
3. As **Alice**, confirm the report is now clearly marked
   "changes requested" with Mia's note visible, edit the draft, and
   **resubmit**. Confirm the status is now distinctly "resubmitted" (not
   just "submitted" again) — there should be a visible difference between a
   first submission and a resubmission.
4. As **Mia**, **approve** it this time. Confirm Jordan can now see it as
   approved.
5. As **Jordan** (manager), find a report that's sitting in submitted/
   resubmitted status and try the **manager override** action — approve or
   request changes on Mia's behalf. Confirm the override is clearly labeled
   as an override (not indistinguishable from an ordinary mentor decision)
   and shows up in the history/audit trail.
6. Confirm at every step that it's obvious: what state the report is in, who
   needs to act next, and what happens if they do.

---

## 10. Progress Agent testing

The Agent tab is read-only — it answers questions, it never changes
anything. Try the quick-prompt buttons first, then ask your own questions.
Things worth specifically trying:

1. **Straightforward grounding:** "Summarize current progress," "What am I
   blocked on?" — confirm the answer matches what you can see on the Board/
   Blockers tabs, and note the `grounded on ...` line at the bottom (task/
   blocker counts, retrieved history, retrieved document chunks).
2. **A misleading/false-premise question**, e.g. ask about a blocker that's
   already resolved as if it were still open, or claim a specific (wrong)
   number of open blockers. The agent should correct you using real current
   counts, not go along with the false premise.
3. **Ask immediately after changing something** (resolve a blocker, move a
   task) — the agent's next answer should reflect the change right away,
   since it always re-reads current state rather than a cached snapshot.
4. **Ask about something from a while ago** ("what did we discuss last
   week about X?") to exercise retrieval of historical updates/blockers/
   feedback, separate from current state.
5. **Try an empty question and a very long one** — both should fail cleanly
   with a clear message, not hang or error out ungracefully.
6. Confirm the agent **never** does something Alice/Mia/Jordan can do
   themselves — it should never claim to have resolved a blocker, moved a
   task, or approved a report.

---

## 11. Attachment + document RAG testing

On the Attachments tab (intern/mentor can upload; everyone can view/
download):

1. Upload a text-bearing file (`.md` or `.txt` works well) with some
   specific, distinctive content in it.
2. Watch its status go from "indexing…" to "searchable" — this can take
   roughly 30–90 seconds; it's asynchronous by design (Vectorize indexing
   never blocks the upload).
3. Once it's searchable, go to the Agent tab and ask about the specific
   content you put in the file. Confirm the agent cites it (and the
   `grounded on ...` line shows a document-chunk count > 0).
4. Delete the attachment, then ask the agent about that same content again.
   Confirm the agent **stops** retrieving it — a deleted document should not
   keep surfacing in answers once the deletion has propagated.
5. Upload a file type with no extractable text (e.g. an image) and confirm
   it's still stored and downloadable, just marked as not searchable — no
   error, no crash.

If you see a "file storage is not configured" message instead of an upload
box, R2 isn't enabled on whichever deployment you're pointed at — that's an
environment/configuration state, not a functional bug; note it and move on.

---

## 12. Reconnect / stale-tab tests

1. Open a workspace, then turn off your network (or use devtools to go
   offline) for 10–15 seconds, then reconnect. The connection banner should
   show a disconnected/reconnecting state and then recover on its own —
   **no manual refresh should be required**, and you should land back on an
   up-to-date snapshot, not a stale one.
2. Open the **same workspace as the same identity in two tabs**. Make a
   change in one tab; confirm the other tab updates live too (multiple tabs
   for one person is a normal, supported case — it should just work).
3. Leave a tab open and idle for several minutes (a "stale tab"), then make
   a change from a different window. When you come back to the idle tab,
   its state should have caught up (either it stayed connected and updated
   live, or it reconnects and re-syncs) — it should never show visibly
   wrong/contradictory state indefinitely.
4. Now specifically test the **denied case**: connect as an identity with no
   membership in a workspace (see §13). This should fail immediately with a
   clear "you don't have access" message and **should not keep silently
   retrying forever** — a denied connection is a dead end, not a network
   hiccup, and the UI should treat it that way.

---

## 13. Authorization / workspace-isolation checks

InternPulse's rule is: **you can read or write a workspace's data only if
you're a real member of it.** There is no "preview" or read-only browsing of
a workspace you don't belong to, and picking a role from the demo identity
picker never grants you access to a workspace you're not actually a member
of.

Things to try:

1. As **Alice**, edit the URL to open a workspace you know she isn't a
   member of (there's a second demo workspace, `#/w/payments`, that *does*
   include Alice/Mia/Jordan — try one of the others if you have access to
   the seed data, e.g. `#/w/rahul-ml`). Confirm you land on a clear
   **"You don't have access to this workspace"** screen with a way back to
   the overview — not a blank page, an error dump, or (worse) someone
   else's data.
2. Pick **"Guest"** from the identity picker and try to open any workspace.
   You should be denied — a guest has no real membership anywhere.
3. If you have access to two different workspaces' data (e.g. as a
   maintainer with seed access), confirm one workspace's blockers, tasks,
   feedback, activity, and Agent answers **never** contain anything from the
   other workspace — not even a stray reference, count, or search result.
4. Confirm the **manager overview** (the landing page listing workspaces)
   only ever lists workspaces the current identity actually manages — never
   someone else's.
5. If you're comfortable with browser devtools or a tool like `curl`, try
   hitting the API directly (e.g. a workspace's `/snapshot` endpoint) as a
   non-member. It should return a clear rejection (403), matching what the
   UI shows — **a hidden button in the UI is not enough; the server itself
   must refuse.**

---

## 14. Break-it cases

A grab-bag of things specifically worth trying to break:

- **Empty / whitespace-only** task titles, blocker descriptions, comments —
  should be rejected with a clear message, not silently accepted or crashed
  on.
- **Very long text** (thousands of characters) in a title/description —
  should be rejected cleanly, not truncated silently or crash the page.
- **Emoji and non-Latin text** (e.g. 日本語, emoji 🎉) — should be accepted
  and displayed correctly everywhere.
- **HTML/script-like text**, e.g. `<script>alert(1)</script>` as a task
  title — it should be stored and shown back to you as plain text. If it
  ever actually executes as a script in your browser, that is a serious bug
  — report it immediately.
- **Rapid double-submit** — click "Create task" or "Post" twice very
  quickly (or on a flaky connection where a retry might fire). You should
  end up with exactly one task/comment, not two.
- **Concurrent conflicting actions** — e.g. have the intern move a task
  while the mentor changes its priority at the same instant; have two
  people try to resolve the same blocker at once; have the mentor request
  changes on a weekly report at the same moment the manager tries to
  approve it. Every client involved should end up agreeing on the same
  final state — no fork, no "my screen says one thing, theirs says
  another."
- **Manager posting feedback**: log in as the manager and check whether the
  Feedback tab lets them post feedback (the backend currently permits
  intern/mentor/manager to post feedback). If the composer is only shown for
  the mentor, that's a UI/backend mismatch worth flagging.
- Try acting **out of your role's lane** on purpose: as the intern, try to
  resolve your own blocker or approve your own weekly review; as the
  mentor, try to move or delete the intern's task or approve your own
  override; as the manager, try to edit a task's title. Every one of these
  should be refused, ideally with a clear reason, not just silently no-op
  or (worse) succeed.

---

## 15. What counts as a bug

Report it if you see:

- **A forbidden action succeeds.** Anything in the role table (§3) marked
  "—" or restricted actually goes through, whether via a UI control that
  shouldn't be there or a request sent directly to the API.
- **Cross-workspace leakage of any kind** — reading, writing, or even seeing
  a hint (a count, a search result, an agent answer) that references another
  workspace's private content.
- **State that doesn't converge.** Two clients end up disagreeing about the
  final state of a task, blocker, or weekly report after things settle.
- **Data loss or corruption** from a normal action (a legitimate edit
  disappears, a resolved blocker "unresolves" itself, a submitted report
  reverts).
- **A crash, 500 error, or unhandled exception** from any normal or
  malformed input — the app should always fail into a clear, readable error
  state, never a blank screen or a stack trace.
- **XSS or any way user-entered content executes** rather than displaying as
  text.
- **A reconnect/retry loop that never gives up** on a permanently denied
  connection, or one that silently drops updates instead of recovering.
- **A stale or misleading attention/reminder item** — something that keeps
  appearing after it's resolved, or something appearing for the wrong role
  entirely.
- **The agent inventing facts** not grounded in real workspace state, or
  failing to correct an obviously false premise.
- Anything that's merely **confusing or unclear** is still useful to report
  — see the product-feedback questions below — but distinguish it from an
  actual functional bug when you write it up.

---

## 16. Product feedback questions

Beyond "did it break," these are worth thinking about and writing down:

1. Looking at your role's Overview tab for the first time, did you
   immediately understand what needed your attention? What was missing or
   noisy?
2. Did the difference between "comment," "request resolution," and
   "resolve" on a blocker feel obvious, or did you have to guess?
3. As a manager, did the "Needs attention" panel feel like a genuinely
   curated, high-signal list — or did it still feel like noise you'd learn
   to ignore?
4. Did the weekly review's current state (and who needs to act next) feel
   obvious at every step, including after a manager override?
5. Would you trust InternPulse as the *only* place you check for "what's
   going on" with an intern/project — or would you still feel the need for
   a side channel (Slack, email, a status doc)? What's missing that would
   change your answer?
6. Was there any moment the realtime updates felt laggy, jarring, or made
   you second-guess whether your action actually went through?
7. Is there any role-specific information you expected to see and didn't
   (or information shown that felt irrelevant to your role)?

---

## 17. Bug report template

```
Title: <one line, specific>

Role(s) involved: intern / mentor / manager / guest / cross-workspace
Workspace(s): <e.g. demo, payments>
Identity used: <e.g. Alice Chen (u-alice)>

Steps to reproduce:
1.
2.
3.

Expected:
<what should have happened, ideally referencing the role table in §3 or the
relevant section of this manual>

Actual:
<what actually happened>

Reproducibility: always / sometimes / once
Surface: UI / direct API call / WebSocket
Browser + device (if relevant):
Screenshot / console error (if any):

Severity (your best guess):
- Critical — cross-workspace leak, forbidden action succeeds, data loss/corruption
- High — a role can't do something it should, or state doesn't converge
- Medium — confusing UX, a stale reminder, a rough edge
- Low — cosmetic
```
