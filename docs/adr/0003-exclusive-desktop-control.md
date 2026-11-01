---
status: accepted
---

# Use exclusive control for physical desktop automation

The user chose suppression of ordinary physical keyboard/mouse input while the agent controls the desktop, with a blue border and explicit stop or human handback. This departs from DSH's selectively handled stop keys and Pi's current interference-aborts behavior: accidental interaction should not disrupt an agent task. It supersedes that part of [ADR 0001](0001-preserve-reference-behavior.md), trading simultaneous desktop use for a simpler control contract; the candidate implementation is awaiting full acceptance and all other safeguards remain.

Requirements live in the [spec](../spec.md#exclusive-control); feasibility, responsibility boundaries and acceptance live in the [plan](../implementation-plan.md#exclusive-control-delivery). Do not choose a Windows mechanism from API availability alone: [BlockInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-blockinput) restricts injection to its owning thread, while [keyboard hooks](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc) can suppress events but can be removed on timeout. The candidate uses hooks in the existing independent listener, which allows separately tagged agent input. The native observer ignores physical input only when a downstream hook confirms it consumed the event and the retained listener/protection event remain valid; unconsumed or foreign injected input still invalidates the action. Tagged absolute pointer movement replaces the old expected-SetCursorPos queue. Hook timeout removal is a Windows limitation, not proof of exclusive control; physical, failure and host checks remain required before acceptance.
