# Pi Windows Computer Use

Status: agreed scope. Published as [GitHub issue #1](https://github.com/ycheung5/pi-computer-use/issues/1), labeled `ready-for-agent`.

## Problem Statement

Pi users need to observe and operate Windows applications and browser pages without installing DSH or coordinating several Pi extensions. The reference project provides the desired behavior, but its host integration targets DSH and its Windows assumptions do not directly accommodate Pi running in WSL2. The new project also needs a simple source layout and indexed documentation so contributors can find relevant context without reading the whole repository.

## Solution

Deliver one installable Pi package with native computer-use tools, reference-equivalent desktop/browser behavior, machine-wide personal settings and package-managed Windows execution prerequisites. Support native Windows Pi and WSL2 Pi through one Windows-side automation worker. Preserve target safeguards, independent emergency stopping and honest verification while simplifying implementation where behavior stays intact.

## User Stories

1. As a Pi user, I want one package to install, so that I can use computer control without other Pi extensions or DSH.
2. As a native Windows host user, I want desktop automation from default Pi, so that I can operate Windows applications directly.
3. As a WSL2 host user, I want equivalent Windows desktop access, so that I can keep my Linux-based Pi workflow.
4. As a user, I want required worker runtimes managed by the package, so that I need not install Windows Node separately.
5. As a user, I want lazy worker startup, so that ordinary Pi usage avoids automation startup overhead.
6. As a user, I want a reusable worker, so that subsequent calls avoid repeated startup costs.
7. As a user, I want health diagnostics, so that I can identify unavailable prerequisites and connections.
8. As an agent, I want to list windows, so that I can choose the intended application.
9. As an agent, I want snapshots and accessibility trees, so that I can understand controls and their current state.
10. As an agent, I want to find and inspect elements, so that I can target controls precisely.
11. As an agent, I want screenshots with coordinate metadata, so that visual targeting maps correctly to the desktop.
12. As an agent, I want OCR with text bounds, so that I can work with interfaces that expose little accessibility information.
13. As an agent, I want click, double-click, move, drag and scroll actions, so that I can operate visual interfaces.
14. As an agent, I want text entry and key chords, so that I can interact with applications accurately.
15. As an agent, I want focus, invoke and value-setting actions, so that supported controls can be operated with less physical input.
16. As an agent, I want application launch and window activation, movement and closure, so that I can manage a complete desktop workflow.
17. As an agent, I want explicit waits and observable conditions, so that I can verify outcomes without guessing.
18. As a user, I want background actions preferred, so that automation interferes less with my work.
19. As a user, I want input refused when another window covers the target, so that actions do not reach the wrong application.
20. As a user, I want stale element and window identities rejected, so that changed interfaces require fresh observation.
21. As a user, I want clipboard, pointer and foreground restoration where appropriate, so that automation leaves my working state intact.
22. As a user, I want restoration to respect my intervening actions, so that automation does not fight my input.
23. As a user, I want visible control indicators and a configurable stop shortcut, so that I know when physical input is in use.
24. As a user, I want emergency stop independent of a busy worker or focused terminal, so that I can stop automation reliably.
25. As a user, I want the stopped computer-use operation blocked from retrying, so that my stop request remains effective.
26. As a user, I want a new user operation to permit resuming, so that stopping does not permanently disable computer use.
27. As a user, I want competing sessions to receive a busy result, so that they cannot interleave desktop actions.
28. As an agent, I want calls within the owning session ordered, so that observations and actions retain their intended sequence.
29. As a user, I want browser automation without moving my physical pointer, so that web work can remain in the background.
30. As a user, I want installed Chrome and Edge support and experimental installed Firefox-family support, so that browser compatibility follows the reference.
31. As an agent, I want browser tabs, navigation, element actions and dialogs, so that I can complete supported web workflows.
32. As an agent, I want page changes returned after browser actions, so that I can assess their effect as in the reference.
33. As a user, I want isolated temporary browser profiles by default, so that automation does not use my daily browser profile.
34. As a user, I want optional remembered sign-ins in a dedicated profile, so that I can repeat authenticated workflows.
35. As a user, I want personal settings shared across projects and hosts, so that preferences stay consistent on my Windows machine.
36. As a user, I want full, lite, lazy and custom tool selection, so that I can control available capabilities and model context.
37. As a user, I want disabled tools rejected during execution, so that hiding tools is not the only enforcement.
38. As an agent, I want dispatched input distinguished from observed success, so that I do not claim an unverified objective.
39. As a user, I want cancellation, timeout and crash cleanup, so that keys, processes and desktop ownership are not abandoned.
40. As a user, I want input never replayed automatically after an uncertain timeout, so that an action is not accidentally duplicated.
41. As a maintainer, I want deterministic fixtures and failure coverage, so that regressions are reproducible.
42. As a maintainer, I want integration tests through both hosts, so that worker-only success does not hide launch-path failures.
43. As a user, I want benchmark comparisons and acceptance checks, so that improvements do not silently sacrifice reliability or responsiveness.
44. As a contributor, I want a short documentation index and simple folders, so that I can find task-specific context with less searching.

## Implementation Decisions

- Implement fresh TypeScript informed by reference version 0.5.3 at commit `6fb642129595a6357588c70812974951db304662`; neither copy its engine nor wrap its package. A small native Windows helper is permitted where necessary. Retain applicable notices if any third-party material is subsequently reused.
- Register native Pi tools directly. The initial release requires neither a custom MCP server nor another Pi extension.
- Preserve all 24 automation capabilities and the tool-management entry, including supported parameters and failure semantics inventoried from the reference. Preserve its safeguards and experimental status; framework adaptation does not justify dropping behavior.
- Use an extension module for tools, lifecycle, commands and rendering; a launcher module for host differences; and a Windows worker with focused desktop, browser, settings and stop-control modules. Start with flat responsibility-named source files and introduce subdirectories only when implementation growth justifies them.
- The worker exposes request execution with cancellation and disposal through an internal transport. Native Windows launches it directly; WSL2 uses a thin launcher. Keep browser discovery, profiles, filesystem paths and native process management on Windows.
- Supply a private runtime or packaged worker. Start it on first use, reuse it, and clean up on session shutdown/reload. Packaging and native interop choices require early feasibility evidence.
- Enforce desktop ownership across native Windows and WSL2 sessions. Queue calls within the owner; reject competitors rather than retaining their stale requests. Recover ownership after proven owner failure without stealing it from a slow live owner.
- Track a computer-use operation across model turns. Use final Pi settlement for completion and idempotent session shutdown for cleanup. Do not mistake an individual model turn or low-level run end for a new user operation.
- Propagate cancellation, allow bounded key/button release cleanup, and keep emergency stopping independent of blocked automation. Never replay timed-out input automatically.
- Prefer background control actions. Guard physical input against wrong targets, occlusion, stale identity and foreground changes; restore state only when compatible with reference behavior and intervening user activity.
- Preserve reference observation behavior: desktop actions generally report dispatch; browser actions normally return page changes. Explicit waits/observations establish expected outcomes. Distinguish sent, observed, unconfirmed and inconclusive results.
- Preserve Chrome/Edge and experimental installed Firefox-family compatibility. Libraries are allowed where they reduce code without altering the agreed contracts; managed Firefox is not an accepted compatibility substitute.
- Default to isolated temporary profiles; remembered sign-ins are opt-in dedicated profiles. Personal settings live on the Windows side, apply across projects and are managed through a Pi command. Project overrides are excluded initially.
- Preserve full/lite/lazy/custom tool selection and execution-time denial. Use Pi's own registration, exposure, rendering and lifecycle facilities where appropriate.
- Support a release-tested baseline of Windows 11, Windows PowerShell 5.1, WSL2 Ubuntu and pinned/documented Pi versions. Compatibility outside this baseline remains unverified until tested.
- Provide a small documentation index with task-specific section links. Requirements, delivery sequence, terminology and rationale each have a distinct source of truth; load only the documentation needed for the current task.

## Testing Decisions

- Reuse the agreed tool/worker execution seams and integrated Pi entry points. Test external behavior and observable guarantees, not private implementation shape. No additional public test-only interface is required by this spec.
- Test extension behavior through native Pi tool calls, including images, settings/tool denial and lifecycle. Test worker behavior through its normal request/cancellation interface, and prove both host launch paths end to end.
- Test every capability for valid/invalid arguments, supported success, relevant failure conditions and cancellation. A successful mock response cannot prove actual UIA, OCR, capture or input behavior.
- Use the reference's isolated regression suites, dedicated UIA fixtures, local browser pages, capture/input contracts, lifecycle tests and benchmarks as prior art. There are no application tests in this repository yet.
- Separate portable deterministic tests, live Windows fixtures, and suites emitting physical input. Real input runs on a dedicated interactive desktop with disposable apps and profiles, rather than the user's normal applications.
- Cover stale targets, incomplete observations, focus/occlusion, clipboard restoration, DPI/coordinate mapping, browser navigation/profiles, competing sessions, crash recovery, timeout non-replay and emergency-stop behavior.
- Require automated regression and integrated-host suites plus recorded manual checks for visual indicators, physical stop shortcuts, display changes and interactive sign-in. The user performs additional acceptance testing.
- Measure cold startup, warm observations, input dispatch and complete workflows against the reference on the same machine. Explain and address regressions or obtain explicit acceptance; do not remove safeguards to improve timings.
- Complete the detailed coverage matrix and capability-to-test mapping before declaring parity. Automated tests are necessary but do not establish every possible application/state combination.

## Out of Scope

- DSH integration, dependency on other Pi extensions and a standalone MCP interface.
- Copying the reference engine or substituting managed Firefox for installed-Firefox compatibility.
- Project-specific settings overrides, non-Windows desktop automation and claims of universal application coverage.
- Administrator/UAC bypass, bundled AI models or credentials, and automatic replay of uncertain input.
- A reduced-feature initial release presented as full parity; milestones are incremental development checkpoints.

## Further Notes

The user confirmed shared understanding and requested a simple folder structure with indexed documentation. Delivery proceeds through foundation/feasibility, Pi and desktop integration, browser/presentation parity, and complete release validation. Early investigations must prove packaged execution from both hosts, minimal native interop, browser compatibility and cross-host ownership before locking in implementation technologies. Failure of a feasibility gate requires an explicit scope/trade-off discussion rather than a silent behavior change.

Issue tracker: [ycheung5/pi-computer-use](https://github.com/ycheung5/pi-computer-use). See [tracker configuration](agents/issue-tracker.md) for operations and [triage labels](agents/triage-labels.md) for status vocabulary.
