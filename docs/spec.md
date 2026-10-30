# Pi Windows Computer Use

Status: agreed scope. Original product specification: [GitHub issue #1](https://github.com/ycheung5/pi-computer-use/issues/1). Current investigation, repair and acceptance specification: [GitHub issue #23](https://github.com/ycheung5/pi-computer-use/issues/23), labeled `ready-for-agent`. This document consolidates the current requirements; the issue records the repair-cycle scope.

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
16. As an agent, I want application launch and window activation, movement and closure, so that I can manage a complete desktop workflow. Prefer reusing the intended existing app window and creating a needed tab/document through its observed UI, preserving existing work. Launch when no suitable window exists or the user explicitly requests a new instance; retain dedicated browser-profile isolation.
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

45. As a maintainer, I want existing fixes traced to reference mechanisms and evidence, so that symptom workarounds do not become permanent requirements.
46. As a maintainer, I want material departures classified, so that required Pi adaptations are distinguishable from accidental gaps.
47. As a user, I want text dispatch compared with DSH before retaining fixed delays, so that unnecessary latency does not conceal a mechanism defect.
48. As a user, I want repeatable paired tests automated, so that I do not have to paste every diagnostic prompt manually.
49. As an agent, I want detailed action guidance and useful failure evidence, so that I can choose supported recovery.
50. As a user, I want ordinary tasks with controlled obstacles tested, so that tool success translates into useful task completion.
51. As a user, I want offscreen controls, stale IDs and incomplete accessibility handled when supported, so that routine obstacles do not require unnecessary intervention.
52. As a maintainer, I want direct-call reproduction of agent failures, so that tool, fixture, environment and reasoning problems are separated using evidence.
53. As a user, I want my available Pi and DSH model configurations tested, so that unavailable shared-model access does not block acceptance.
54. As a maintainer, I want shared reference failures recorded, so that they become improvement candidates rather than false passes.
55. As a maintainer, I want failures retained and affected regressions rerun, so that a final pass does not hide previous defects.
56. As a user, I want three consecutive reset successes for required task/recovery scenarios, so that a single lucky run is not sufficient.
57. As a contributor, I want stale documentation replaced during each fix, so that agents receive one current answer rather than conflicting notes.
58. As a user, I want correctness and fewer interventions prioritized over latency and tokens, so that optimization preserves reliable behavior.

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
- Show a reference-style blue edge glow during physical computer control, with a bright core and translucent gradient approximately 1.5 times the pinned DSH border thickness. Preserve non-activation, click-through, capture and per-monitor behavior; user-visible visual acceptance remains required.
- Preserve full/lite/lazy/custom tool selection and execution-time denial. Use Pi's own registration, exposure, rendering and lifecycle facilities where appropriate.
- Support a release-tested baseline of Windows 11, Windows PowerShell 5.1, WSL2 Ubuntu and pinned/documented Pi versions. Compatibility outside this baseline remains unverified until tested.
- Provide a small documentation index with task-specific section links. Requirements, delivery sequence, terminology and rationale each have a distinct source of truth; load only the documentation needed for the current task.

- Follow reference behavior until evidence establishes a gap or a necessary Pi adaptation. Research source, history, tests and model-visible guidance before changing mechanisms; classify each material departure and record its evidence/disposition.
- Keep previous fixes provisional during the audit. In particular, isolate Unicode batching, event construction, pacing and newline handling before treating the 50 ms workaround as necessary. Audit clipboard, activation/restoration and generic tool descriptions similarly.
- Extend existing fixtures and paired comparison infrastructure rather than introducing a new framework or public test-only API. Investigate supported host interfaces before promising unattended model-driven execution.
- Do not add a separate planner, elaborate recovery controller or fixed production retry/time budget. Runner watchdogs bound tests without altering production policy.
- Reconcile documentation during each investigation/fix: replace stale instructions, remove duplicate authority, retain concise historical evidence, and update the index/links. Requirements, sequencing, results, topic guidance and decision rationale retain their existing distinct owners.

## Testing Decisions

- Reuse the agreed tool/worker execution seams and integrated Pi entry points. Test external behavior and observable guarantees, not private implementation shape. No additional public test-only interface is required by this spec.
- Test extension behavior through native Pi tool calls, including images, settings/tool denial and lifecycle. Test worker behavior through its normal request/cancellation interface, and prove both host launch paths end to end.
- Test every capability for valid/invalid arguments, supported success, relevant failure conditions and cancellation. A successful mock response cannot prove actual UIA, OCR, capture or input behavior.
- Use the reference's isolated regression suites, dedicated UIA fixtures, local browser pages, capture/input contracts, lifecycle tests and benchmarks as prior art. Reuse existing project fixtures and evidence through the [current implementation phases](implementation-plan.md#detailed-milestones) and [validation catalog](validation.md#alignment-scenario-catalog).
- Audit behavioral departures before accepting previous workarounds as improvements. Use paired DSH/Pi tool tests and real-agent outcome/recovery tasks; record differing model configurations without attributing their combined results solely to the extension. Require three consecutive reset successes for required task/recovery scenarios, with failures retained and affected regressions rerun. Optimization follows demonstrated correctness.
- Separate portable deterministic tests, live Windows fixtures, and suites emitting physical input. Real input runs on a dedicated interactive desktop with disposable apps and profiles, rather than the user's normal applications.
- Cover stale targets, incomplete observations, focus/occlusion, clipboard restoration, DPI/coordinate mapping, browser navigation/profiles, competing sessions, crash recovery, timeout non-replay and emergency-stop behavior.
- Require automated regression and integrated-host suites plus recorded manual checks for visual indicators, physical stop shortcuts, display changes and interactive sign-in. The user performs additional acceptance testing.
- Measure cold startup, warm observations, input dispatch and complete workflows against the reference on the same machine. Explain and address regressions or obtain explicit acceptance; do not remove safeguards to improve timings.
- Complete the detailed coverage matrix and capability-to-test mapping before declaring parity. Automated tests are necessary but do not establish every possible application/state combination.

- Compare equivalent direct tool calls on reset fixtures separately from real-agent outcome tasks. Agent tasks permit supported recovery within intended disposable targets; method-specific diagnostic tests retain their constraints. Explicit stops, disabled controls and uncertain-input non-replay remain binding.
- Test the user's GPT-6.1 Sol low-reasoning Pi setup and available OpenRouter DSH model, recording effective configurations. Treat these as host/model combinations, not isolated extension or reasoning benchmarks. Reproduce failed traces through direct calls where possible; leave unsupported cause attribution unknown.
- Gather the runnable baseline before broad repair work. Continue independent cases only after confirmed cleanup/reset; mark dependent cases blocked after emergency stop or uncertain cleanup. A shared DSH failure is an improvement candidate, not acceptance of an unsuccessful required outcome.
- Validate current documentation and remove contradictions before a phase closes. Three reset successes do not erase earlier failures or establish universal reliability; existing manual release gates still apply.

## Out of Scope

- DSH integration, dependency on other Pi extensions and a standalone MCP interface.
- Copying the reference engine or substituting managed Firefox for installed-Firefox compatibility.
- Project-specific settings overrides, non-Windows desktop automation and claims of universal application coverage.
- Administrator/UAC bypass, bundled AI models or credentials, and automatic replay of uncertain input.
- A reduced-feature initial release presented as full parity; milestones are incremental development checkpoints.

## Further Notes

The initial implementation exists; acceptance remains incomplete. The current delivery cycle audits deviations, builds missing comparison coverage, collects tool and real-agent evidence, diagnoses and fixes mechanisms, reruns failures and affected regressions, then optimizes. Follow the [implementation plan](implementation-plan.md#detailed-milestones) and [validation catalog](validation.md#alignment-scenario-catalog). Required framework adaptations preserve the original product contracts; a failed gate does not silently reduce scope.

Issue tracker: [ycheung5/pi-computer-use](https://github.com/ycheung5/pi-computer-use). See [tracker configuration](agents/issue-tracker.md) for operations and [triage labels](agents/triage-labels.md) for status vocabulary.
