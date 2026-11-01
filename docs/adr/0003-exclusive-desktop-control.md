---
status: accepted
---

# Use exclusive control for physical desktop automation

The user chose suppression of ordinary physical keyboard/mouse input while the agent controls the desktop, with a blue border and explicit stop or human handback. This departs from DSH's selectively handled stop keys and Pi's current interference-aborts behavior: accidental interaction should not disrupt an agent task. It supersedes that part of [ADR 0001](0001-preserve-reference-behavior.md), trading simultaneous desktop use for a simpler control contract; implementation is pending and all other safeguards remain.

Requirements live in the [spec](../spec.md#exclusive-control); feasibility, responsibility boundaries and acceptance live in the [plan](../implementation-plan.md#exclusive-control-delivery). Do not choose a Windows mechanism from API availability alone: [BlockInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-blockinput) restricts injection to its owning thread, while [keyboard hooks](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc) can suppress events but can be removed on timeout. Neither is an established fit for the existing separate listener/input helpers. Validate stop responsiveness, agent input, release and failure behavior before selecting a mechanism or removing existing interference guards.
