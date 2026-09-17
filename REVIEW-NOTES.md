# Review notes

## Delivered

All requested core items are implemented, including the optional multi-chat
roll-up. This was completed within the five-hour cap.

| Acceptance criterion | Where to inspect it |
| --- | --- |
| Three distinct mock domains | `mock-workspace/apps/{transactions,contacts,analytics}` and Workspace files |
| Named projects exist first | Create project dialog; inactive composer blocks input |
| Explicit active project | Active project badge; Make active / Deactivate controls |
| Human and assistant time per cycle | Summary cards, history columns, row audit dialog |
| Five-minute idle stop | Amber `Idle stop · 5m` outcome and exact stop timestamp |
| Next request starts a new cycle | Each submitted request has its own immutable cycle ID |
| Dashboard totals and current state | Project overview, live status card, history |
| Persistence across reopen | Atomic on-disk state; verified through browser reload and server restart |
| Multiple conversations | Conversation tab, contribution bars, history conversation filter |
| Project crosses mock folders | Workspace context checkboxes; areas shown in each cycle audit |

## Verified

- **25 automated tests pass** with `npm test`, including the readable-notes update.
- Deterministic deadline tests cover 299,999 ms, 300,000 ms, delayed reconciliation,
  typing during the wait, continuation in another chat, continuation after an idle
  gap, and work attributed to another project.
- Persistence tests run the actual HTTP server, save real files in an isolated
  temporary directory, close and recreate the server, and compare restored records.
- Additional checks cover idempotent request events, external adapter lifecycle,
  composition focus intervals, crash recovery, duplicate server protection,
  malformed saved data, cross-origin/CSRF/DNS-rebinding rejection, traversal, and
  request-size limits.
- Browser walkthrough created **Review the customer onboarding experience**, sent
  one request using all three domains, then continued in **Analytics follow-through**
  using only analytics. Both conversations rolled up to the same project. The first
  cycle ended as Continued; the second stopped at exactly five minutes. Counted
  work remained about 21 seconds while waiting increased separately.
- That walkthrough survived browser reload and a full local server restart.
- Desktop and mobile layouts were inspected; the mobile history scrolls inside
  its table rather than forcing the page wider. Native dialogs, keyboard focus
  styles, reduced-motion handling, and mobile navigation are included.
- The browser console reported no warnings or errors during the walkthrough.

## Honest limits / next steps

- **The included assistant is a local mock**, not an AI coding assistant. It reads
  selected placeholder files and companion notes, returns short findings and a
  next idea, and never modifies the mock files.
  Instrumenting a real host is the next integration step; a documented, tested
  local API and client are included in `INTEGRATION.md` and `lib/client.mjs`.
- This is a local, single-contributor app. It intentionally has no cloud account,
  hosted database, synchronization, team permissions, payroll, surveillance, or
  billing features. Do not expose its server to the network.
- Only one unfinished draft at a time is supported. Submit or discard it before
  changing projects or composing in another conversation. One assistant runs per
  project. Simultaneously editing the same conversation in multiple tabs is not
  an intended workflow; a future version should add per-composer ownership.
- Focused composition includes thinking while the composer remains focused.
  Unfocused work is not measured. An unexpected browser crash can lose up to a
  heartbeat interval of draft time; a server crash keeps assistant work through
  the last persisted heartbeat.
- Absolute timestamps implement the deadline correctly across suspended browsers
  and restarts. System clock changes are not compensated with a distributed or
  monotonic clock scheme in this prototype.
- Displayed times are rounded down. Audit/export retain exact milliseconds.
- Example data is labeled and opt-in via `npm run demo` or the empty-state button.
  Sample projects exist before their illustrative cycles, and remain inactive
  until explicitly selected for work. Create a new project for measured work.

The next product iteration would connect the lifecycle client to a real assistant
host, use transactional database storage for multiple contributors, and add safe
backup restoration and per-tab draft ownership.
