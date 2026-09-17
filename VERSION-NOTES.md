# How the product evolved

This is a summary of visible product decisions and tradeoffs. It is not a literal
recording of private reasoning or a recreated timestamp-by-timestamp build diary.

## 01 — Prove the timer (reconstruction)

Start with the part that has to be right: time belongs to a named initiative.
The reconstructed early screen puts project selection, a composer, totals and a
plain history table together. It makes the core question easy to test: did this
request count the right human and assistant time, and did waiting stop?

The early version uses the saved original server and engine. Its deliberately
simple frontend was created for this comparison. It does not claim that later
security, recovery or timing logic actually existed at an earlier development time.

## 02 — Make the record useful (real saved version)

Commit `e7251a7` first saved the full app. Commit `bbf7e7f` added the first one-click
Windows launcher. The comparison's middle version is the unchanged app from
`bbf7e7f`, with a new wrapper launcher outside it to use a separate port.

This stage adds a project overview, visual time split, conversation contributions,
cycle details and workspace browsing. Its original visual style used soft borders
and rounded cards. Its mock responses showed source excerpts, which made the
mock inspection transparent but were too technical for a quick read.

## 03 — Make the interface clearer (current version)

The feedback asked for stronger outlines, more boxes, solid colors, a little glow,
and shorter, friendlier notes. The current version therefore:

- Gives cards and controls visible outlines and mostly square corners.
- Uses saturated fills and labeled outcome blocks so state is easier to scan.
- Adds a small CSS glow to the brand and live status, with reduced-motion support.
- Replaces long interface explanations with short, direct wording.
- Shows app notes first and source code only when expanded.
- Gives new mock replies short findings and a next idea; keeps old saved replies
  intact while adding an optional reading view.

The timing rules, project attribution and stored history stay consistent. The
comparison versions use separate data folders so trying one does not change another.

## What was actually available

Before this feedback, the repository held only the two full-app commits above.
There was no saved super-early implementation in Git or the available working files.
Only version 02 is a recovered historical snapshot. Version 01 is reconstructed,
and version 03 is the current release. The version labels describe the comparison,
not invented historical dates.
