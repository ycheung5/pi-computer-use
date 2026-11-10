# Pi Windows Computer Use

Status: agreed scope. Original product specification: [GitHub issue #1](https://github.com/ycheung5/pi-computer-use/issues/1). Version 0.1.0 is published and its product/release owners are completed. The post-release [input timing and modifier-tap specification](#input-timing-and-modifier-taps) is published in 0.1.1; it is not part of 0.1.0. [ADR 0004](adr/0004-pi-first-acceptance.md) supersedes mandatory DSH parity; historical alignment records are not current release gates.

## Problem Statement

Pi users need to observe and operate Windows applications and browser pages without installing DSH or coordinating several Pi extensions. DSH supplied useful design context, but this project is judged on supported Pi outcomes and its Windows/WSL2 integration. The new project also needs a simple source layout and indexed documentation so contributors can find relevant context without reading the whole repository.

## Solution

Deliver one installable Pi package with native computer-use tools, reliable supported desktop/browser behavior, machine-wide personal settings and package-managed Windows execution prerequisites. Support native Windows Pi and WSL2 Pi through one Windows-side automation worker. Preserve target safeguards, independent emergency stopping and honest verification while simplifying implementation where behavior stays intact.

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
16. As an agent, I want application launch and window activation, movement and closure, so that I can manage a complete desktop workflow. Follow the [default-app and workspace policy](#default-apps-workspaces-and-foreground), preserving existing work.
17. As an agent, I want explicit waits and observable conditions, so that I can verify outcomes without guessing.
18. As a user, I want background actions preferred, so that automation interferes less with my work.
19. As a user, I want input refused when another window covers the target, so that actions do not reach the wrong application.
20. As a user, I want stale element and window identities rejected, so that changed interfaces require fresh observation.
21. As a user, I want clipboard, pointer and foreground restoration where appropriate, so that automation leaves my working state intact.
22. As a user, I want exclusive control during agent desktop input and explicit human handback, so that accidental input cannot disrupt automation and I can regain control with Esc.
23. As a user, I want visible control indicators and a configurable stop shortcut, so that I know when physical input is in use.
24. As a user, I want emergency stop independent of a busy worker or focused terminal, so that I can stop automation reliably.
25. As a user, I want the stopped computer-use operation blocked from retrying, so that my stop request remains effective.
26. As a user, I want a new user operation to permit resuming, so that stopping does not permanently disable computer use.
27. As a user, I want competing sessions to receive a busy result, so that they cannot interleave desktop actions.
28. As an agent, I want calls within the owning session ordered, so that observations and actions retain their intended sequence.
29. As a user, I want browser automation without moving my physical pointer, so that web work can remain in the background.
30. As a user, I want installed Chrome and Edge support and experimental installed Firefox-family support, so that I can use the installed supported browsers.
31. As an agent, I want browser tabs, navigation, element actions and dialogs, so that I can complete supported web workflows.
32. As an agent, I want page changes returned after browser actions, so that I can assess their effect.
33. As a user, I want my Windows default browser and existing browser window reused with a new task tab, so that opening or using the browser fits my normal workspace and preserves existing tabs.
34. As a user, I want an optional dedicated browser profile, including remembered sign-ins, when I explicitly choose a separate automation workspace.
35. As a user, I want personal settings shared across projects and hosts, so that preferences stay consistent on my Windows machine.
36. As a user, I want full, lite, lazy and custom tool selection, so that I can control available capabilities and model context.
37. As a user, I want disabled tools rejected during execution, so that hiding tools is not the only enforcement.
38. As an agent, I want dispatched input distinguished from observed success, so that I do not claim an unverified objective.
39. As a user, I want cancellation, timeout and crash cleanup, so that keys, processes and desktop ownership are not abandoned.
40. As a user, I want input never replayed automatically after an uncertain timeout, so that an action is not accidentally duplicated.
41. As a maintainer, I want deterministic fixtures and failure coverage, so that regressions are reproducible.
42. As a maintainer, I want integration tests through both hosts, so that worker-only success does not hide launch-path failures.
43. As a user, I want Pi performance measurements and acceptance checks, so that improvements preserve reliability and useful responsiveness.
44. As a contributor, I want a short documentation index and simple folders, so that I can find task-specific context with less searching.

45. As a maintainer, I want fixes traced to observed Pi failures and evidence, so that symptom workarounds do not become permanent requirements.
46. As a maintainer, I want supported Pi behavior and limitations explicit, so that design choices are distinguishable from defects.
47. As a user, I want exact, responsive Pi text entry validated, so that pacing changes preserve correctness and focus without unnecessary delay.
48. As a user, I want repeatable Pi tests automated, so that I do not have to paste diagnostic prompts manually.
49. As an agent, I want detailed action guidance and useful failure evidence, so that I can choose supported recovery.
50. As a user, I want ordinary tasks with controlled obstacles tested, so that tool success translates into useful task completion.
51. As a user, I want offscreen controls, stale IDs and incomplete accessibility handled when supported, so that routine obstacles do not require unnecessary intervention.
52. As a maintainer, I want direct-call reproduction of agent failures, so that tool, fixture, environment and reasoning problems are separated using evidence.
53. As a user, I want my available Pi model configuration tested, so that acceptance reflects how I use the extension.
54. As a maintainer, I want Pi failures and limitations recorded, so that unavailable or inconclusive cases do not become false passes.
55. As a maintainer, I want failures retained and affected regressions rerun, so that a final pass does not hide previous defects.
56. As a user, I want three consecutive reset successes for required task/recovery scenarios, so that a single lucky run is not sufficient.
57. As a contributor, I want stale documentation replaced during each fix, so that agents receive one current answer rather than conflicting notes.
58. As a user, I want correctness and fewer interventions prioritized over latency and tokens, so that optimization preserves reliable behavior.
59. As a user, I want observed native targets bound to a window lifetime, so that expired or unverifiable observations are rejected instead of silently selecting a replacement with the same HWND and process ID.

## Implementation Decisions

- Implement fresh TypeScript informed by reference version 0.5.3 at commit `6fb642129595a6357588c70812974951db304662`; neither copy its engine nor wrap its package. A small native Windows helper is permitted where necessary. Retain applicable notices if any third-party material is subsequently reused.
- Register native Pi tools directly. The initial release requires neither a custom MCP server nor another Pi extension.
- Retain the 24 implemented automation capabilities and tool-management entry. Define supported parameters, observations, failures and safeguards by this Pi specification; exact DSH behavior is not a release requirement. Preserve the declared browser/host support and experimental status.
- Native screenshots optionally accept `windowOnly: true` with window scope. This opt-in captures only the selected window through PrintWindow or HWND-bound Windows.Graphics.Capture, never screen-copy/desktop fallbacks. Hidden, minimized or unavailable surfaces fail without an image. Reject desktop scope and browser-tab combinations; preserve existing behavior when omitted or false. This option is specific to the screenshot tool and does not change snapshot/OCR capture contracts.
- Use an extension module for tools, lifecycle, commands and rendering; a launcher module for host differences; and a Windows worker with focused desktop, browser, settings and stop-control modules. Start with flat responsibility-named source files and introduce subdirectories only when implementation growth justifies them.
- The worker exposes request execution with cancellation and disposal through an internal transport. Native Windows launches it directly; WSL2 uses a thin launcher. Keep browser discovery, profiles, filesystem paths and native process management on Windows.
- Supply a private runtime or packaged worker. Start it on first use, reuse it, and clean up on session shutdown/reload. Packaging and native interop choices require early feasibility evidence.
- Enforce desktop ownership across native Windows and WSL2 sessions. Queue calls within the owner; reject competitors rather than retaining their stale requests. Recover ownership after proven owner failure without stealing it from a slow live owner.
- Track a computer-use operation across model turns. Use final Pi settlement for completion and idempotent session shutdown for cleanup. Do not mistake an individual model turn or low-level run end for a new user operation.
- Propagate cancellation, allow bounded key/button release cleanup, and keep emergency stopping independent of blocked automation. Never replay timed-out input automatically.
- Prefer supported background dispatch while preserving the requested [workspace and foreground](#default-apps-workspaces-and-foreground). A visible open/use request still brings its result forward. Apply the [exclusive-control contract](#exclusive-control) when physical desktop control is needed; preserve target, occlusion, lifetime and handback safeguards.
- Keep the Pi observation contract: desktop actions generally report dispatch; browser actions normally return page changes. Explicit waits/observations establish expected outcomes. Distinguish sent, observed, unconfirmed and inconclusive results.
- Preserve Chrome/Edge and experimental installed Firefox-family compatibility. Libraries are allowed where they reduce code without altering the agreed contracts; managed Firefox is not an accepted compatibility substitute.
- Follow the [default-app and workspace policy](#default-apps-workspaces-and-foreground). Keep dedicated browser profiles as an explicit alternative. Personal settings live on Windows and apply across projects through a Pi command; project overrides remain excluded initially.
- Show the accepted blue edge glow at approximately 1.5 times DSH thickness throughout exclusive control; its visibility follows the [control contract](#exclusive-control). Preserve non-activation, click-through, capture and per-monitor behavior.
- Preserve full/lite/lazy/custom tool selection and execution-time denial. Use Pi's own registration, exposure, rendering and lifecycle facilities where appropriate.
- Support a release-tested baseline of Windows 11, Windows PowerShell 5.1, WSL2 Ubuntu and pinned/documented Pi versions. Compatibility outside this baseline remains unverified until tested.
- Provide a small documentation index with task-specific section links. Requirements, delivery sequence, terminology and rationale each have a distinct source of truth; load only the documentation needed for the current task.

- Prioritize working Pi outcomes, simple maintainable design and evidence-backed repairs. DSH source can inform a diagnosis, but installing/running DSH, matching its implementation or proving manual parity is not required. [ADR 0004](adr/0004-pi-first-acceptance.md) records this change.
- The user approved stronger window-lifetime tracking beyond the reference's raw HWND/PID checks. Design and validate lifetime-bound window references under #28 before choosing the mechanism and caller interface. Explicitly distinguish compatibility selectors from stronger references; lost identity proof must not silently retarget a replacement or bypass Windows access restrictions.
- Change provisional workarounds only when Pi evidence justifies it. Exact text, useful responsiveness, preservation and cleanup are the criteria; finding DSH corruption causes or the minimum possible per-character delay is not a release prerequisite. Record uncertainty honestly.
- Extend existing Pi fixtures and host test infrastructure rather than introducing a new framework or public test-only API. Investigate supported host interfaces before promising unattended model-driven execution.
- Do not add a separate planner, elaborate recovery controller or fixed production retry/time budget. Runner watchdogs bound tests without altering production policy.
- Reconcile documentation during each investigation/fix: replace stale instructions, remove duplicate authority, retain concise historical evidence, and update the index/links. Requirements, sequencing, results, topic guidance and decision rationale retain their existing distinct owners.

## Default apps, workspaces and foreground

This is the accepted target behavior under [ADR 0005](adr/0005-default-apps-and-workspace-reuse.md); delivery and remaining acceptance are tracked in #30, with editor focus in #26. Earlier dedicated-profile acceptance does not establish this new workflow.

- Resolve the Windows default handler for the requested URL/file type when no app is explicitly named. An explicit user choice takes precedence. Do not silently substitute another app because its automation channel is easier; report unavailable control and use supported native UI where feasible. Opening the default app and supporting its browser protocol are separate capabilities.
- Discover the intended existing app window first. Create and verify a new task tab or document through its supported interface, preserving existing tabs, documents and unsaved contents. Reuse that task workspace for subsequent steps. Open a new window when the user requests one or no suitable window exists. Ambiguous targets or an app lacking a safe separate workspace require an explicit limitation or clarification rather than overwriting current work.
- Browsers follow the same policy, including the user's existing ordinary browser window. Dedicated temporary/kept automation profiles remain an explicit alternative, not an automatic replacement for reuse. Native UI operation of an existing browser does not imply CDP/BiDi attachment to its running profile. Do not change personal browser launch flags or copy, delete or take ownership of its profile to obtain protocol access.
- For a visible open/use request, activate and independently verify the intended window/tab, then keep the task target foreground across related steps. Intentional app/dialog transitions follow the task. Do not bounce to the caller after every tool call or apply delayed restoration after human handback. Explicit background work preserves the user's foreground; completion/handback leaves the requested result visible unless the user asked to restore another window. Windows activation refusal remains an explicit outcome; unconfirmed focus must not authorize input.
- Preserve target/lifetime, stop, exclusive-control and uncertain-input safeguards. Extension shutdown/idle/profile cleanup may close only resources it owns; reusing a user's window does not grant permission to close that window or unrelated tabs/documents.

## Exclusive control

Accepted product decision, 2026-11-01; scoped control (#31) and presentation/display (#20) acceptance are complete. Installation acceptance (#2) is complete for the user-approved first-release scope; final release reconciliation (#21) remains separate. [ADR 0003](adr/0003-exclusive-desktop-control.md) records the deliberate departure from reference behavior. Desktop ownership excludes competing agents; exclusive control additionally suppresses ordinary physical user input.

- The first release uses low-level Windows hooks at normal privileges. The user explicitly accepts Windows' ability to silently remove timed-out hooks: suppression and physical stop-key availability cannot be guaranteed after such removal. Stronger OS blocking, elevation and an isolated desktop are not first-release prerequisites. This scoped exception qualifies the suppression/stop guarantees below; detected protection loss still stops automation, and all host, cleanup and recovery acceptance remains required. See [ADR 0003](adr/0003-exclusive-desktop-control.md) for rationale.
- Before the first physical action, establish independent stop protection, physical-input suppression and the visible local blue border. Continue protection across tool gaps, observations and model thinking until human handback or final settlement. Quiet-only UIA/browser operations do not acquire exclusive control; mixed workflows retain it once acquired.
- During control, ordinary physical clicks, pointer movement and typing must neither reach applications nor cancel or modify agent actions. Agent-generated input remains available. Esc and the configured stop shortcut always stop the operation; their physical events, including chord modifiers, must not leak into the target or become an ordinary-interference failure. Agent-generated Escape remains usable without triggering emergency stop.
- For credentials or other human interaction, stop dispatch, settle in-flight input and restore appropriate state before releasing suppression and returning control. Automation stays paused until explicit user continuation, then revalidates targets and reacquires protection. Emergency stop retains the existing same-operation rejection and new-user-operation recovery rules.
- Completion, stop, cancellation, setup failure and owner/listener failure must release physical-input suppression and any agent-held keys/buttons without replay. If release cannot be verified, report uncertainty and prevent further automation; release of user control and release of an uncertain automation ownership lease are distinct obligations. Preserve Windows secure-attention access; locking or leaving the interactive desktop prevents further dispatch.
- First-release lock handling is a safety requirement: refuse input while locked and stop interrupted control with cleanup, or report uncertainty and block further automation. Automatic continuation, target survival across lock/unlock and seamless post-unlock task recovery are not release requirements. Any later user-requested work follows ordinary fresh observation and control acquisition; reuse the accepted handback evidence.
- The blue border is required locally while exclusive control is held; an optional indicator setting or idle timer cannot silently hide it or release protection while automation continues. During handback, show that control has returned. Own capture may briefly omit overlays without releasing protection; preserve remote/recording preferences where Windows supports them.
- Suppression is not a substitute for target identity, foreground, occlusion, clipboard preservation, bounded cleanup or uncertain-input non-replay. If the mechanism cannot establish protection on a supported host, refuse physical dispatch with a clear limitation rather than silently allow shared input.

## Testing Decisions

- Reuse the agreed tool/worker execution seams and integrated Pi entry points. Test external behavior and observable guarantees, not private implementation shape. No additional public test-only interface is required by this spec.
- Reuse accepted evidence across issues. An open issue is not a reason to repeat an accepted check; rerun an affected check when relevant behavior or its evidence collector changes, or a recorded result is invalidated. Group remaining human-only checks into prepared sessions and distinguish new host/mechanism coverage from repeated coverage.
- Test extension behavior through native Pi tool calls, including images, settings/tool denial and lifecycle. Test worker behavior through its normal request/cancellation interface, and prove both host launch paths end to end.
- Test every capability for valid/invalid arguments, supported success, relevant failure conditions and cancellation. A successful mock response cannot prove actual UIA, OCR, capture or input behavior.
- Use the reference's isolated regression suites, dedicated UIA fixtures, local browser pages, capture/input contracts, lifecycle tests and benchmarks as prior art. Reuse existing project fixtures and evidence through the [current implementation phases](implementation-plan.md#detailed-milestones) and [validation catalog](validation.md#alignment-scenario-catalog).
- Use Pi tool checks and real-agent outcome/recovery tasks. Record the effective Pi model and host, and separate product, model, environment and fixture failures using evidence. Retain three consecutive reset successes for required Pi task/recovery scenarios, preserve failures and rerun affected regressions. Optimization follows demonstrated correctness.
- Separate portable deterministic tests, live Windows fixtures, and suites emitting physical input. The user selected scoped disposable tests in the current Windows session, with standing idle-test authorization. Keep input scoped to owned disposable targets, preserve unrelated applications/documents and profiles, and serialize desktop activity. Cases whose isolation or cleanup requirements cannot be met remain blocked.
- Cover stale targets, incomplete observations, focus/occlusion, clipboard restoration, DPI/coordinate mapping, browser navigation/profiles, competing sessions, crash recovery, timeout non-replay and emergency-stop behavior. Exclusive-control acceptance follows the [bounded delivery plan](implementation-plan.md#exclusive-control-delivery); retain historical shared-input outcomes as historical evidence.
- Require automated regression and integrated-host suites plus recorded manual checks for visual indicators, physical stop shortcuts, display changes and interactive sign-in. The user performs additional acceptance testing.
- Measure Pi cold startup, warm observations, input dispatch and representative workflows as needed to diagnose responsiveness or regressions. Do not require DSH timings or remove safeguards to improve speed.
- Complete the Pi coverage matrix and capability-to-test mapping before declaring release readiness. Automated tests are necessary but do not establish every possible application/state combination.
- On 2026-11-06 the user accepted #6 screenshot-mapping closeout based on actual 100%/150%/175% mixed-DPI and changed negative-origin arrangement evidence; unavailable 200% custom scaling is not a first-release test gate. Other unexercised display configurations remain unverified, not inferred passes or a promise of universal scaling support. Target/coordinate safeguards are unchanged. See [accepted scope](validation.md#screenshot-mapping-closeout).
- First-release acceptance permits the two bounded #28 cases that could not be established in the owned environment: genuine same-HWND/same-PID replacement and verified Windows UIPI denial. The user accepted these test limitations on 2026-11-05; neither is a passing test or a waiver of identity/access safeguards. See the [recorded disposition](validation.md#pi-targeting-and-accessibility-reconciliation).
- On 2026-11-09 the user accepted #2 installation closeout based on second-computer WSL installation and actual computer actions, plus prior package/native/WSL evidence. Fresh native-Windows installation, missing/corrupt prerequisite handling and shutdown in that clean environment remain accepted unverified first-release test limitations; runtime safeguards remain required. See [installation receipt](validation.md#second-computer-installation-report).

- Separate direct Pi tool checks on reset fixtures from real-agent outcome tasks. Agent tasks permit supported recovery within intended disposable targets; method-specific diagnostics retain their constraints. Explicit stops, disabled controls and uncertain-input non-replay remain binding.
- Test the user's GPT-6.1 Sol low-reasoning Pi setup and record its effective configuration. Reproduce failed traces through direct calls where possible; leave unsupported cause attribution unknown. DSH/OpenRouter credentials and DSH host/model/manual runs are not required.
- Gather each scenario's runnable baseline, diagnose its observed failures and make targeted repairs with affected regressions. Whole-suite baseline completion is not required before diagnosing a known case; final reconciliation still accounts for every required outcome. Continue independent cases after confirmed cleanup/reset; block dependent cases after emergency stop or uncertain cleanup. A historical DSH result is optional context, not a current acceptance dependency.
- Validate current documentation and remove contradictions before a phase closes. Three reset successes do not erase earlier failures or establish universal reliability; existing manual release gates still apply.

## Out of Scope

- DSH integration, dependency on other Pi extensions and a standalone MCP interface.
- Copying the reference engine or substituting managed Firefox for installed-Firefox compatibility.
- Project-specific settings overrides, non-Windows desktop automation and claims of universal application coverage.
- Administrator/UAC bypass, bundled AI models or credentials, and automatic replay of uncertain input.
- Claims of full DSH parity. Release claims concern the supported Pi capabilities and documented limits; milestones are incremental development checkpoints.

## Further Notes

Version 0.1.0 is published with its scoped acceptance and documented limitations. The input-timing change below is published in 0.1.1 with scoped acceptance recorded. Follow the [current outcome map and queue](tickets.md#delivery-outcomes-and-ownership), [input-timing delivery plan](implementation-plan.md#input-timing-delivery) and [validation receipts](validation.md#npm-publication-receipt). Each runnable scenario proceeds through baseline, diagnosis, targeted repair and affected regressions; final reconciliation and optimization follow the required outcomes. Pi functional and preservation requirements remain binding; removed DSH comparison gates must not be reintroduced through historical notes.

Issue tracker: [ycheung5/pi-computer-use](https://github.com/ycheung5/pi-computer-use). See [tracker configuration](agents/issue-tracker.md) for operations and [triage labels](agents/triage-labels.md) for status vocabulary.

## Input timing and modifier taps

Status: implemented, accepted, merged through PR #44 and published in 0.1.1, 2026-11-10; [GitHub specification #40](https://github.com/ycheung5/pi-computer-use/issues/40). The following template is the canonical first-change requirement set. See the [composed receipt](validation.md#input-timing-and-modifier-tap-acceptance). These new parameters are available in npm 0.1.1; npm 0.1.0 remains unchanged.

### Problem Statement

Pi users cannot tap Ctrl, Alt or Shift alone, request a timed key/button press, or adjust the fixed SendInput typing delay. Long requested input durations also conflict with execution deadlines inside the Windows worker and at the Pi boundary. Agents need explicit per-call controls that preserve existing behavior when omitted and retain stopping, cleanup and non-replay guarantees. This addresses input flexibility; the cause of the user's whole-task slowness has not been measured.

### Solution

Extend the existing keypress, click and text-entry tools with standalone generic modifier taps and opt-in per-call timing. Every press/hold completes and releases inside one tool call. Agents can choose a typing interval, hold duration and execution timeout, including disabling that execution timeout. Keep the existing Pi extension and Windows worker; add no new tool family, MCP server or persistent held-input state.

### User Stories

1. As an agent, I want to tap Ctrl alone, so that applications can respond to a standalone modifier.
2. As an agent, I want to tap Alt or Shift alone, so that modifier-only interactions are available.
3. As a user, I want existing shortcuts unchanged, so that upgrading preserves current workflows.
4. As an agent, I want to hold a supported key or chord for a requested duration, so that I can perform a long press.
5. As an agent, I want to hold a supported mouse button at the selected target, so that I can perform a long mouse press.
6. As a user, I want each held input released before its call completes, so that the model cannot leave a key down while thinking.
7. As an agent, I want an explicit SendInput typing interval, so that I can adapt pacing to an application's behavior.
8. As a user, I want the existing 50 ms typing interval when omitted, so that the compatibility baseline remains available.
9. As an agent, I want zero typing delay where appropriate, so that I can request unpaced dispatch explicitly.
10. As a user, I want no arbitrary duration ceiling, so that the extension does not guess how long my task should take.
11. As an agent, I want a per-call execution timeout, so that I can choose how long to wait for that operation.
12. As an agent, I want zero timeout to disable the execution deadline, so that an intentional long operation is not cut short by that deadline.
13. As an agent, I want default deadlines to accommodate explicit timing, so that accepted long-duration requests can finish.
14. As a user, I want Esc and cancellation to interrupt waits, so that increasing durations does not prevent stopping.
15. As a user, I want input released after errors, shutdown or cancellation, so that failures do not leave controls held.
16. As a user, I want uncertain cleanup to retain ownership and block dependent work, so that subsequent input does not compound uncertainty.
17. As an agent, I want unsupported method/parameter combinations rejected before input, so that my requested method is not silently changed.
18. As an agent, I want actual timing settings and dispatch status reported, so that I can distinguish configuration from observed task success.
19. As a user, I want partial or stopped input never automatically replayed, so that changing timing cannot duplicate actions.
20. As a maintainer, I want native Windows and WSL2 callers to share the same contract, so that host routing does not change timing semantics.
21. As a maintainer, I want focused regression and owned-fixture checks, so that this update does not reopen accepted release tests.
22. As a user, I want broader keyboard/mouse coverage delivered separately, so that the first change stays small and reviewable.

### Implementation Decisions

- Extend existing input schemas, route validation, Pi integration, request/deadline handling and native input execution. Preserve the current module responsibilities and independent emergency-stop helper. No new dependencies, public test API, general scheduler or persistent down/up API.
- Accept one standalone generic Ctrl/Control, Alt/Option or Shift modifier in keypress. Existing supported ordinary keys/chords remain supported. Multiple modifiers without a main key are not newly promised. Existing aliases and malformed/duplicate-key validation remain applicable.
- Add optional holdMs to keypress and single click only. Omission preserves current immediate release; zero explicitly requests immediate release. For a chord, hold its pressed main key and modifiers together, then release all held inputs. For a click, press the selected supported button at the resolved target, wait, and release. Existing targeting, foreground intent and restoration rules continue to apply. No new auto-repeat guarantee is implied by a held key.
- Add optional inputDelayMs to type_text only with explicitly selected sendinput. Omission preserves the existing 50 ms pacing. Zero requests no intentional inter-unit delay. Keep current Unicode/newline/tab handling; the unit is the actual dispatched UTF-16 input unit, with the existing newline normalization. This is not a promise of exact application processing time or universal correctness at lower intervals.
- Add optional timeoutMs to type_text, keypress and single click only. A positive value supplies the requested execution deadline; zero disables that call's execution deadline through all relevant input execution layers. An explicit shorter timeout is honored, not silently extended, and may end partial input with the existing cleanup/non-replay result.
- With timeoutMs omitted, ordinary calls retain current deadline behavior. When holdMs or inputDelayMs is explicitly supplied, derive sufficient default execution budgets from the requested hold/pacing duration plus existing execution overhead allowances. Both the native-helper request and outer Pi-worker request must accommodate it; an inner 40-second or outer 90-second timer must not silently override the accepted contract.
- Timing arguments are non-negative safe whole milliseconds, without arbitrary product ceilings. Reject negative, fractional, non-finite, unsafe or otherwise unrepresentable values and unrepresentable derived durations before input. Long waits must not wrap, clamp to a short timer, or accidentally mean infinity because of an underlying API integer limit. Zero has the parameter-specific meanings above.
- Disabling the execution deadline does not disable explicit cancellation, shutdown handling, emergency stopping, target/protection checks or cleanup acknowledgments. Existing startup, target-resolution and cleanup safeguards remain independent. Timing is best effort, not a hard real-time guarantee.
- Validate backend/method capability before sending input. The first slice requires native foreground timed holds and explicit native SendInput pacing. A selected browser/background/quiet route must either honor the requested semantics or return a clear unsupported-combination error before input. Do not silently ignore a parameter, switch an explicit method, or escalate an explicit background request. Existing auto routing remains unchanged when new parameters are omitted; its resolution with new parameters must honor them or refuse before dispatch. This slice does not promise universal browser/background long-press support.
- Preserve exclusive control, visible local border, target identity/focus/occlusion checks, protection during tool gaps, clipboard preservation and human handback. Cancellation/error/shutdown must release agent-held input, or explicitly report unconfirmed cleanup and block dependent work. No automatic replay or forced termination of an uncertain input owner.
- Report the effective requested timing/deadline policy, whether input was dispatched or interrupted, and existing cleanup confirmation. A successful dispatch does not establish an observed application effect. Existing result fields retain their meaning.
- Keep the current Pi package and tool names. The published 0.1.0 remains unchanged; implementation and any later publication are separate work.

### Testing Decisions

- Reuse the confirmed public Pi-tool and worker request/cancellation interfaces as the highest practical seams. Extend existing schema, input-preparation, text, pointer and worker/transport tests; do not add a new framework or public timing-test interface.
- Test externally visible validation, routing, effects and cleanup results rather than private state. Cover modifier taps, existing chords, omitted/zero/positive timing, representable large values and derived overflow, invalid values, unsupported routes and no input before refusal.
- Use existing controllable worker peers and owned fixtures to test omitted/positive/disabled execution deadlines at both request layers, a deliberately shorter timeout, cancellation during a long requested interval and release/ownership uncertainty. Use short deterministic simulations for very long values and timer-overflow cases; tests must not sleep for the full requested durations.
- Extend the existing native text and pointer fixtures for one grouped scoped Windows acceptance: standalone modifier down/up events, a timed key/chord and mouse press/release, explicit typing intervals with exact Unicode readback, default pacing regression, and stop/error cleanup of newly held inputs. Observe events/effects independently of returned dispatch success. Reuse existing stop/control evidence; repeat a physical Esc demonstration only if the changed mechanism or a failure specifically requires it.
- Check relevant Pi/WSL2-to-Windows and native request forwarding so no layer drops a field or restores a hidden default deadline. Keep these checks scoped to changed behavior; no new paid-model reset series, DSH comparison or unrelated display/browser/profile acceptance.
- Run configured portable checks and actual package/documentation validation for implementation. Record unrun live prerequisites and limitations honestly. Passing mocks do not establish real Windows input effects; exact-text verification is required before claiming lower pacing correct.

### Out of Scope

Broader named-key coverage, Windows keys, left/right modifiers, numpad/media keys, mouse side buttons and modifier-click/drag are deferred to the second change. Also excluded: raw virtual-key/scan-code input, holds across calls, separate key-down/up tools, double-click/drag timing controls, privileged or device-specific integrations, secure-desktop bypass, changing default typing pace, global timeout removal, a new MCP adapter, universal device/application coverage and diagnosing or claiming a fix for unmeasured whole-task latency.

### Further Notes

The user confirmed this first-change scope after choosing a two-change delivery. Existing 0.1.0 acceptance remains closed and reusable. This spec describes the implementation published in npm 0.1.1; the unchanged npm 0.1.0 does not accept the new timing parameters. Readable key names remain the agent-facing interface. Required input release and uncertain-cleanup safeguards qualify every duration/timeout option. Future broader input coverage must be specified and accepted separately rather than silently added here.
