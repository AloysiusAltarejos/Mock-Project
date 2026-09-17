# Tempo — Project Work Timer

A working, local-first project timer and dashboard. Name an initiative, work in
one or more conversations, and inspect human composition, assistant work, waiting,
and exact five-minute idle stops in one place.

**The timer/dashboard is the product. `mock-workspace/` is just a stage:** three
deliberately trivial apps (transactions, contacts, analytics), not a CRM or a
recreated production application.

## What you can do

- Create a named project, switch the active project, and keep earlier time attached
  to the right initiative.
- Type and send requests without starting or stopping a stopwatch. The app records
  your focused writing time and the assistant's response time automatically.
- Continue across conversations and all three mock apps. See one project total,
  plus each conversation's share.
- See live composing, working, waiting and stopped states. The fixed five-minute
  idle stop is visible in the cycle history. Waiting never adds to counted work.
- Open a cycle to inspect its timestamps, exact milliseconds, and focused writing
  intervals. Filter the history by conversation and export the complete JSON log.
- Close and reopen the browser or server without losing saved records. Interrupted
  work is marked clearly, with the outage excluded.
- Browse readable workspace notes, expand the source when needed, and get a short
  mock-assistant reply with findings and a next idea.
- Launch the app in one click on Windows, and use the responsive layout on narrow
  screens. Everything stays local; no package install or AI account is needed.

## Latest design update

The revised interface follows the feedback for stronger structure and less formal
wording. Panels, buttons and inputs now have clear outlines and mostly square
corners. Summary cards use stronger fills. History outcomes use solid green for
continued work, purple for assistant work, amber for idle stops and waiting, and
red for failures or interruptions; text labels remain visible as well.

The brand mark has a small CSS glow, and the live status indicator glows while work
is active. Both respect the operating system's reduced-motion preference. The
interface uses shorter text and more readable secondary labels.

Workspace files open as plain-language notes with an optional **View source file**
section. New mock responses read the code and companion `NOTES.md` files, then
return short notes and a next idea. They do not claim to have implemented changes.
Earlier file-dump replies get a readable summary in chat; **View original saved
reply** still exposes the original text. Saved cycle records and exports are not
rewritten. External assistant replies are never converted into mock notes.

## Earlier versions

The companion **tempo-versions.zip** provides three runnable comparison stages:

| Stage | Provenance | What it demonstrates |
| --- | --- | --- |
| 01 Early concept | Explicit reconstruction, made now | Project selection, composer, live totals and a basic cycle table |
| 02 Original full app | Actual saved Git commit `bbf7e7f` | The original complete dashboard and soft visual design |
| 03 Revised app | This release | Strong outlines, solid colors, glow, shorter copy and readable notes |

There was no saved super-early build: the first Git commit already contained the
complete app. The early stage is a teaching reconstruction using the original
timing engine, not an authentic historical checkpoint. The middle stage preserves
the original tracked app files exactly. See [VERSION-NOTES.md](VERSION-NOTES.md)
for the product decisions and provenance.

Each comparison stage has its own launcher, port and data directory. They can run
side by side without mixing recorded time: early on 4318, original on 4319, and
current on 4317.

## Run it

Requires **Node.js 20.10 or newer**. No packages, accounts, API keys, build step,
or network connection are required.

```sh
npm start
```

Open **http://127.0.0.1:4317**.

On Windows, double-click **`Launch Tempo.cmd`** for a one-click start. It starts
the local server in a minimized window, waits until the dashboard is ready, and
opens it in your default browser. If Tempo is already running, it simply opens
the dashboard. Keep the minimized server window open while using Tempo; close it
when you are finished. `start.cmd` remains available when you want the server
console to stay visible.

For a populated review dashboard on an empty data directory:

```sh
npm run demo
```

Or choose **Explore example data** in the empty dashboard. Example projects are
explicitly labeled; they are not initially active and their cycles are not
represented as measured work. Create a fresh project for your own work.

Data is saved in `data/timer.json`, relative to this repository. Stop with Ctrl+C
and run the same command to reopen it; closing the browser does not stop the
server. JSON export is available from the dashboard. `PORT` and `DATA_DIR`
environment variables override the defaults. Run one server per data directory.

The delivered ZIP includes labeled example records and the short measured browser
walkthrough described in `REVIEW-NOTES.md`, so `npm start` opens an inspectable
dashboard immediately. A clean Git clone starts empty; use `npm run demo` there
to add illustrative records. Time records are intentionally excluded from Git.

## Two-minute review

1. Explore the example initiative. Inspect human vs assistant totals, two idle
   stops, six cycles, and contributions from three conversations. Open the arrow
   on any history row for its timestamps and exact millisecond arithmetic.
2. Create an initiative such as **Improve customer onboarding**. It starts at
   zero and becomes explicitly labeled **Active project**. No time is recorded
   just because a project exists or is selected for viewing.
3. Open the workspace, type a request, and send. Composition and response timing
   happen automatically. Choose any of the three mock areas for context.
4. Create another conversation under the same project and submit another request.
   The previous wait ends at that submission, and both chats roll into one total.
5. Leave the completed response alone for five minutes. The history records
   **Idle stop · 5m**, and the project becomes **Stopped**. Coming back starts a
   new cycle without adding the idle gap.
6. Refresh or restart the server. The records and their attribution remain.

## What is real, and what is mocked

- Project selection, automatic composer instrumentation, timing, persistence,
  cycle accounting, export, conversation roll-up, and the dashboard are real.
- The built-in **local mock assistant** waits about 2.2 seconds and reads the
  selected placeholder files and their companion notes. It returns a short summary
  and a next idea. It does **not** call a
  language model, implement a prompt, or modify the files. Its source is visible
  in every conversation and cycle audit.
- Arbitrary ChatGPT, Codex, or other external chats cannot be observed from an
  unrelated browser page. A host must emit composer and assistant lifecycle
  events to the included [event API](INTEGRATION.md). There is no per-request
  stopwatch ritual in the instrumented workspace. An adapter is required for
  external hosts because their first-input and finish events are not available
  automatically to this app.

## Timing contract

All event timestamps use the local server clock. Project and conversation IDs are
captured at submission and never inferred from filesystem paths.

| Phase | Starts | Ends | Included in counted work? |
| --- | --- | --- | --- |
| Human composition | First edit in a focused composer | Blur pauses; focus resumes; submit commits | Yes, only for a submitted request |
| Assistant work | Request submitted | Response completes or fails | Yes |
| Waiting | Response completes | Next submitted request on that project, or exactly 300 seconds | No |
| Idle gap | Five-minute deadline | Next composition / submission | No |

- **Counted work = sum(humanMs) + sum(finishedAt − submittedAt)**. For a running
  assistant, the dashboard temporarily substitutes current time for `finishedAt`.
- Waiting and composition can overlap: the prior cycle still awaits a submitted
  request while the next request is being drafted. Waiting is excluded, so this
  is never double-counted as work.
- Merely typing does not reset the five-minute deadline. Exactly on the deadline,
  the previous cycle is marked idle; the submitted request starts another cycle.
- Waits are project-wide: submitting in conversation B can continue a wait from A.
  A request on another project does not end this project's wait.
- Dashboard selection is read-only. **Make active** changes future attribution.
  An unfinished draft must be submitted or discarded before changing the active
  project. A running response retains its original attribution if you switch.
- One composer draft and one running assistant per project are supported. The
  app prevents simultaneous composition across conversations to avoid accidental
  double-counting. This is a single-contributor local workspace, not a multiuser
  collaboration server.
- Composition counts the focused interval, including pauses to think while the
  composer stays focused. It excludes time spent on other tabs/windows. Draft
  heartbeats run every three seconds. If the page disappears without a blur
  event, the draft lease expires after fifteen seconds and is closed at its last
  acknowledged heartbeat, not at the expiry time. Up to one heartbeat interval
  may be lost on a hard browser crash. Draft text is saved on first input and
  debounced by 250 ms afterward.
- New records also retain each focused composition interval in the cycle audit,
  making the human-time sum inspectable down to milliseconds.
- Assistant progress is persisted once per second. If the server dies mid-response,
  the next startup marks the cycle **Interrupted** at the last saved heartbeat.
  The outage is never charged. Interrupted and failed requests remain auditable.
- Deadlines are absolute timestamps. A late timer tick, closed browser, or server
  restart cannot extend the five-minute wait.
- Displayed durations are rounded down; exports and the audit dialog contain the
  exact millisecond values. Totals sum exact values before formatting, so displayed
  row sums can differ by rounding. For hour-long totals, summary cards show hours
  and minutes; the audit/export retain full precision.

## Persistence and security

State is held in memory and persisted with a flushed temporary file and atomic
rename on every mutation. A failed write is surfaced as an error, not silently
treated as saved. Corrupt JSON fails startup instead of replacing recorded work.
Back up `data/timer.json` or use **Export log**. Browser storage holds only the
last viewed project; clearing it does not delete the time records.

The server binds only to `127.0.0.1`; validates the Host and Origin; rejects
cross-site requests; requires an unpredictable session token for mutations;
restricts body sizes and exposed static files; uses a restrictive content
security policy; and escapes all user content before HTML rendering. Mock file
paths are allowlisted. There are no third-party scripts, fonts, telemetry, or
runtime dependencies. Data is local plaintext, so operating-system access to
this directory controls privacy. Do not expose this single-user server to the
internet. There is no hosted authentication or device synchronization.

## Tests and structure

```sh
npm test
```

Uses the built-in Node test runner, with deterministic clocks for deadline tests
and real temporary-file/HTTP integration tests. No real five-minute sleep is
needed to exercise boundary conditions.

**25 tests pass.** The latest checks cover readable mock replies, workspace notes,
preservation of older saved replies, and leaving external assistant replies intact.

```text
public/              Responsive dashboard, composer, cycle audit, export link
public/notes.js      Reading view for old mock replies (no record mutation)
lib/timer.mjs        Pure project/cycle state transitions and deadline rules
server.mjs           Local HTTP API, atomic storage, mock assistant
lib/client.mjs       Small external-host adapter client
test/                Accounting, idle boundaries, persistence, HTTP/security tests
mock-workspace/      Three pretend apps and a mock-only README
INTEGRATION.md       External assistant lifecycle contract and example
REVIEW-NOTES.md      Acceptance coverage, validation, and remaining limitations
VERSION-NOTES.md     Design changes and version provenance
data/                Generated records (gitignored)
```

The original build was completed within the five-hour limit. Later launcher and
design updates are documented separately above. No production system was accessed
or recreated.
