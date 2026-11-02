# Pi computer-use implementation plan

Status: Pi-first completion under [ADR 0004](adr/0004-pi-first-acceptance.md), agreed 2026-11-02. All 25 tools have implementations; remaining Pi acceptance is owned by the [current queue](tickets.md#execution-queue). DSH installation, manual comparisons, host/model runs and parity benchmarks are not release prerequisites. No release is declared.

Requirements and behavioral contracts are authoritative in the [specification](spec.md). Use the [documentation index](README.md) to load only relevant context.

## Structure

Keep flat, responsibility-named TypeScript modules in `src/`, tests in `tests/`, and packaged assets in `assets/`. Keep host-specific launcher and Windows interop logic separate from reusable orchestration through modules, without pre-creating nested directories. The [repository layout](README.md#repository-layout) is the navigation guide.

## Design revision

The 2026-11-01 review covers the current runtime module structure, native-helper responsibilities, test runners and documentation ownership. It is a design review with a bounded first cleanup, not a claim that every line or Windows behavior has been revalidated. That cleanup preserved the then-current requirements; the later exclusive-control decision is scoped separately below.

| Area | Finding and design decision |
| --- | --- |
| Pi integration, launcher and worker | Preserve the host adapter and worker transport. Native Windows and WSL2 are real launch variations; callers should use the same tool interface. Keep native implementation details behind that interface. |
| Native execution, stopping and ownership | Preserve independent stopping and the ownership lease. Cleanup and uncertain-effect checks belong with the code that owns the processes or input; deleting them for brevity would weaken the contract. |
| Argument validation | Keep one existing schema/normalizer responsible for each routed action. Remove unreachable alternatives and repeated identical validation. Native and browser policies differ, so a universal validator is not justified by similar loops alone. |
| Browser implementation | Session/profile lifecycle, engine-specific observations and action dispatch are distinct responsibilities in the large browser module. Isolate a responsibility when a concrete change needs it; keep its small caller interface and existing external tests. Chromium/Firefox adapters are justified only for genuinely shared operations with different implementations. |
| Test host setup | Reuse the existing `computerUseHost` adapter rather than rebuilding mocks in individual tests. Retain registration history as well as the current tool map so duplicate registration remains observable. |
| Test orchestration and verification | Pure report verification runs in process. Process framing, cancellation, real Pi integration and Windows execution retain process tests. Keep one implementation of each guard; portable negative tests and live outcome checks have different jobs. The browser fixture still combines scope enforcement, task briefs and report verification; separate these responsibilities only when it reduces coupling without adding a framework. |
| Diagnostics | Each retained probe must answer a named unresolved question. Replace obsolete probes with behavior-level regression coverage before removing their command/documentation references. Do not keep adding ownership controllers to test ownership controllers. |
| Documentation | Requirements stay in the spec, design/delivery here, accepted evidence in validation, and next actions in the ticket queue. Replace repeated status prose rather than append another account of the same result. |

The first cleanup removes duplicate test setup, process wrappers around pure verification, unreachable browser validation and a redundant limit pass. It preserves the existing assertions and strengthens the existing public-worker argument test before deleting validation. It introduces no planner, controller, production dependency or tool interface. The only new file is a type declaration for the reused test host. See [cleanup dispositions](tickets.md#cleanup-dispositions) for the current decisions.

Continue with one responsibility at a time: identify the concrete duplication or coupling, show the smaller interface or deletion, and run the affected existing checks. A file split that merely relocates the same complexity is not a simplification. Full runtime restructuring and remaining live acceptance are not represented as complete by this cleanup.

## Feasibility gates

These original feasibility gates remain regression obligations. Reuse recorded evidence; repeat checks when changes or missing evidence warrant it:

1. Prove a packaged Windows worker launches from native Pi and WSL2 Pi with clean stdio framing, spaces/Unicode paths, Windows-drive and WSL-filesystem checkouts, cancellation, parent exit and no orphan processes. Users must not install Windows Node separately.
2. Retain the selected TypeScript-managed native helper for UIA, screenshots, OCR, input and stopping. Revisit interop only for a demonstrated Pi defect or concrete simplification; the existing choice does not need another comparison programme.
3. Prove background Chrome/Edge actions, isolated/kept profiles and installed Firefox BiDi control. Evaluate libraries only where they preserve compatibility, targeting, cancellation and background behavior; do not replace installed Firefox support with managed Firefox without revisiting the decision.
4. Prove ownership exclusion between a native Windows session and a WSL2 session, including crash recovery.

Record measurements and outcomes. If a gate fails, bring the concrete trade-off back to the user rather than quietly reducing supported Pi behavior or adding manual setup requirements.

## Coverage matrix

Every supported tool gets argument validation, success, failure, cancellation where applicable, and unsupported-target coverage. A matrix entry maps to named tests or an explicit manual procedure; mocked protocol success alone cannot establish real desktop support.

| Area | Required coverage |
| --- | --- |
| Host launch and packaging | Clean install; native Windows and WSL2; missing/corrupt assets; spaces/Unicode; both filesystem locations; startup failure; session reload; parent exit; child cleanup |
| Window discovery and management | List, target ambiguity, HWND/PID identity, stale/reused windows, launch, activate, move, close, unresponsive targets and inaccessible/elevated windows |
| UI Automation | Snapshot, tree, find, element info, focus, invoke, set value; depth/node/time budgets; stale elements; sparse/incomplete trees; native and Chromium fixtures |
| Capture and OCR | Screen/window capture paths and fallback metadata; occlusion/minimized windows; blank capture; image scaling; multi-monitor/DPI coordinates; literal OCR queries; inconclusive absence |
| Physical and background input | Click/double click/move/drag/scroll/type/key chords; background dispatch and escalation; covered points; focus changes; exclusive-control suppression and human handback; Unicode; clipboard preservation; key/button release |
| Browser control | Chrome/Edge and experimental installed Firefox; tab discovery, navigation, element IDs, reading, input, dialogs, new/closed tabs; navigation invalidation; disconnect/reconnect; cancellation; supported download/upload paths |
| Browser profiles | Temporary isolation, opt-in persistence, profile ownership, crash recovery, cleanup and no connection to daily profiles; interactive sign-in checked manually |
| Operation lifecycle | Multi-turn ownership; parallel calls; busy competitors across hosts; queued cancellation; emergency stop during input; blocked same-operation retries; new user operation; worker timeout and recovery |
| Settings and tool management | Defaults, persistence, invalid settings, full/lite/lazy/custom modes, execution denial, settings changes while active, stop shortcut and indicator configuration |
| Presentation | Pi tool rendering, image results, evidence/error distinctions; real indicators, stop shortcuts, remote/recording visibility and display changes checked manually |
| Performance | Pi startup, reads, input and representative-workflow measurements where needed to diagnose usability or regressions; no DSH target |

Use deterministic local pages, isolated browser profiles and disposable Windows targets. The user selected scoped tests in the current Windows session with standing idle-test authorization. Bound actions to owned disposable targets and preserve unrelated apps/documents; serialize desktop activity. Separate portable, live and physical-input suites. A fixture requiring stronger isolation stays blocked until its actual prerequisites are met.

Exercise the integrated extension through both native Windows Pi and WSL2 Pi; worker-only tests do not prove both launch paths. Pin/document tested Pi and dependency versions. Retain failure logs and timing artifacts without persisting sensitive desktop content unnecessarily. CI may run portable tests and suitable Windows fixtures; interactive-desktop, multi-monitor, emergency-stop and user acceptance runs must be recorded separately when CI cannot reproduce them.

## Detailed milestones

The foundation, desktop and browser implementations exist. Complete the remaining Pi outcomes rather than restarting implementation or collecting another DSH baseline. Requirements stay in the [spec](spec.md); named cases/results stay in [validation](validation.md); the [queue](tickets.md#execution-queue) owns next actions.

| Phase | Work | Exit evidence |
| --- | --- | --- |
| 1. Reconcile scope and reuse | Remove DSH manual/parity gates, preserve Pi obligations, map existing accepted cases to their owners. | Current issues and docs have one Pi-first scope; historical comparisons are clearly historical. |
| 2. Close capability gaps | Finish the named missing Pi text/chord, clipboard, targeting, pointer/control, display and OCR cases. Diagnose only an observed Pi failure. | Independent outcome/cleanup evidence or explicit unavailable/accepted-limit disposition; affected regressions pass. |
| 3. Finish native agent outcomes | Complete #35 creation, preservation and recovery on owned targets. Reuse the six accepted Pi browser/mixed scenarios in completed #36. | Required missing Pi task/recovery scenarios pass three reset runs with effective model metadata and independent outcomes. Shared physical-control evidence stays with #31/#20. |
| 4. Release | Complete #21's remaining functional, clean-install, manual and packaging checks; document known limits and useful Pi responsiveness. | Every Pi release obligation has a result/disposition; no DSH setup, credentials, manual run or timing comparison is needed. |

Execute per bounded case: establish the Pi result, diagnose an actual failure, make a targeted repair and rerun that case/affected regressions. A blocked case stops dependent activity; it does not reopen accepted cases or mandate a framework. No fixed production retry count or new agent policy is introduced.

Reconcile affected docs during each change: requirements here remain in the spec, delivery here, cases/results in validation, behavior in topic guides and rationale in ADRs. Replace stale instructions; preserve historical evidence without making it a current gate. #23/#37 are superseded umbrellas: capability owners retain targeted diagnosis, #35 retains native outcomes, and #21 retains aggregate release reconciliation. The [cleanup dispositions](tickets.md#cleanup-dispositions) still govern removal of demonstrated redundancy.

## Exclusive control delivery

The [accepted control contract](spec.md#exclusive-control) changes shared-input behavior. The candidate uses keyboard/mouse hooks in the existing stop helper, an operation-scoped protection event and the existing worker preparation/settlement protocol. Portable refusal/release regressions and scoped no-input acquisition/handback checks exist; native Pi-host Esc has accepted evidence; missing held-input, WSL physical shortcut and handback/session acceptance remains in #31. Reuse the operation lifecycle, stop listener and existing flat native modules. Keep suppression, emergency-key interpretation and release in one responsible control boundary; tool-specific guards consume its state. Avoid a second ownership controller or public test-only API.

| Slice / owner | Work and exit evidence |
| --- | --- |
| 1. Mechanism feasibility — #31 | On owned fixtures, prove agent input works while ordinary physical input is suppressed, Esc/shortcut remain observable, Windows escape paths remain available, and protection releases after normal completion and failure. Test the actual native Windows and WSL2 launch topology. Compare hook and BlockInput constraints with the existing process/thread layout; select the smallest mechanism that meets the contract. Record unsupported cases. Enforce the [physical fixture prerequisites and cleanup gate](stopping.md#scripted-native-pi-host-fixture); never force-retire uncertain input owners. |
| 2. Integrate lifecycle and presentation — #31, #20 | Use existing operation start/settlement/cancellation paths for acquire, hold, handback and release. Verify the required border through reads/thinking, disabled presentation settings, capture, displays and idle periods. Handback pauses dispatch and explicit continuation revalidates/reacquires. A physical-key completion assertion includes stop observation, cleanup, release and retry protection; error classification is checked separately and remains a defect when wrong. |
| 3. Regress workflows and prune — #26, #27, #30, #31, #35; reconcile #21 | Extend existing pointer/text/clipboard and agent fixtures. Physical typing/movement/click attempts during control have no app effect; during handback they work and are preserved. Test full shortcut chords, agent Escape, real stop during busy input, owner/listener loss, lock/session changes and release before recovery. Retain stale/occluded/foreground/clipboard guards. Remove only branches proven redundant under the new lifecycle, with affected regressions passing. |

The local nonelevated `BlockInput(true)` prerequisite returned Win32 access denied (5), without blocking or dispatching input. On 2026-11-01 the user accepted hooks with documented Windows limits for the first release, as recorded in [ADR 0003](adr/0003-exclusive-desktop-control.md). Hook suppression is not equivalent to OS input blocking: after silent hook removal, the observer cannot prove an event was suppressed or that Esc remains available during idle gaps. That platform limit no longer awaits a product decision. Actual-host integration, physical stop/release, lifecycle and failure acceptance remain required; bounded physical acceptance requires fresh same-launcher normal/host-exit proofs and per-run participant/input-cleanup receipts, without claiming held-input crash cleanup in advance.

Portable lifecycle tests precede integrated Windows checks. Group genuine physical-key/interference and border checks into one short human session rather than repeated prompts. Each result names scope (worker, actual Pi host, native Windows or WSL2); synthetic input alone does not prove physical suppression. Required real-agent scenarios retain their three-reset acceptance. Finish the feasibility slice before broader rewrites; a failed mechanism leads to a recorded limitation/design revision, not silent fallback to shared input.

## Window lifetime design

The user approved stronger tracking under #28. [ADR 0002](adr/0002-window-lifetime-references.md) records the independently reviewed design; the native lifetime implementation has passed independent review with [scoped acceptance](validation.md#window-lifetime-reference-acceptance). Raw selectors remain explicitly weaker compatibility selection.

Use the existing native bridge as the sole reference authority. One optional `windowRef` identifies an observed lifetime; HWND/PID/title and raw native-window IDs remain compatibility selectors. A supplied reference cannot be discarded or restamped internally. Conflicting selectors fail explicitly. Native-child restart expires its references; fresh observation is recovery, never automatic mutation replay.

Bind cached UIA elements to the root reference and an immutable issued element ID, retaining RuntimeId as comparison metadata. Later observations must not overwrite an old reference with another root binding. Reuse the existing private WGC target handoff for stateless marker validation; OCR, snapshot images, waits, implicit targets and physical fallbacks must retain the originating reference.

If marker acquisition fails, preserve ordinary read metadata and an explicit reference-unavailable reason, but issue neither a strong window reference nor actionable native element IDs. Raw native-window selectors remain explicitly compatible; a failed strong reference is never silently converted into one. This avoids presenting an unbound element ID as safe to mutate.

Snapshot's existing default `captureWindow: false` produces a desktop image. Keep that image separately labeled as desktop evidence while the tree carries its window reference; do not forward a window reference into desktop capture or imply those pixels belong to the bound window. Window-image, OCR and hit-test composition retain the observed root reference.

Missing markers, expiry, unknown epochs and access denial are lost proof, not confirmed disappearance. Validate before dispatch and at existing multi-step checks; already-dispatched effects and concurrent destruction after the final check cannot be undone or atomically excluded. Normal expiry/disposal removes only owned markers. Residue after abrupt native-child exit remains explicit; no property sweeper, broker, privilege bypass or new event thread is planned.

The owned-window probe and interface were independently reviewed before implementation. Existing public tool/worker and owned fixtures now exercise the implemented contract, including a provider pause before final validation and a separate post-effect proof-loss case with independent counters. [Current scoped evidence](validation.md#window-lifetime-reference-acceptance) retains isolated-session gaps and distinguishes the separately recorded #6 automatic capture repair. Actual identical-HWND reuse and verified UIPI denial remain distinct prerequisites; different handles or synthetic denial cannot be mislabeled as those cases. The optional owned-fixture real-time expiry case now validates the actual five-minute lifetime without refreshing or restarting its authority. Paired warm checks add no fixed sleeps or extra model rounds.

Live binding tests stay on disposable owned windows. Global discovery and internal launch-enumeration paths must be reviewed for metadata writes; tests that would bind unrelated windows require a suitably isolated session rather than bypassing the user's scoped-test choice.

## Completion criteria

- All 25 supported Pi capabilities have implementation/test mappings; experimental and unsupported cases are labeled honestly.
- Required portable and live integration suites pass on the agreed hosts, with manual indicator/stop/display checks and user acceptance recorded.
- Clean installation works with default Pi, with runtime/helper dependencies supplied or managed by the package and no extra Pi extension or DSH installation.
- Observed Pi responsiveness issues and regressions are measured and addressed or explicitly accepted without removing safeguards. DSH performance is not a gate.
- README covers installation, prerequisites, development, build/package, tests, troubleshooting, settings/profile locations and known limitations.
- The consolidated scope has been confirmed by the user; implement against the specification and report feasibility failures before changing its contracts.

## Technology choices to resolve through feasibility work

- Packaged worker feasibility and the minimum necessary native interop.
- Library choices that reduce custom browser and Windows interop logic without sacrificing agreed behavior.
- Exact ownership primitive, worker framing, package data paths and bounded shutdown deadlines, supported by the feasibility results.

## Evidence

See [Pi extension research](pi-extension-research.md). The inspected reference is version 0.5.3 at commit `6fb642129595a6357588c70812974951db304662`.
