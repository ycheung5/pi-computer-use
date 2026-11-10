# Pi computer-use implementation plan

Status: 0.1.0 is published with its recorded acceptance limits. Post-release delivery is owned by the [current queue](tickets.md#execution-queue), including the agreed input-timing change below. [ADR 0004](adr/0004-pi-first-acceptance.md) remains binding; DSH/manual parity runs are not prerequisites.

Requirements and behavioral contracts are authoritative in the [specification](spec.md). Use the [documentation index](README.md) to load only relevant context.

## Input timing delivery

The [input timing/modifier-tap spec](spec.md#input-timing-and-modifier-taps) is the only requirement authority for this first post-release change. It extends existing tools; no implementation or live acceptance is claimed by this plan.

1. Extend existing action schemas/normalizers and public tool/worker tests for standalone generic modifiers, timing values, route capability refusal and unchanged defaults.
2. Keep per-call duration/deadline calculation in reusable request handling rather than duplicate it in host adapters. Thread effective policy through Pi/worker/native execution so omitted, explicit positive and disabled execution deadlines remain consistent. Reuse controlled request peers for long-duration/overflow/cancellation checks without real long sleeps; do not add a general scheduler or test-only production API.
3. Extend native text/pointer execution with cancellable, representable pacing/hold waits and release acknowledgments using current input ownership. Keep each hold within one call and retain target/focus/protection checks. Reject unsupported explicit backend combinations before dispatch.
4. Run affected configured regressions and package checks; extend the current owned text/pointer fixtures for one grouped live acceptance of actual down/up effects, exact text and newly affected cleanup. Exercise both host request paths only where changed forwarding requires it. Reuse accepted stop/display/profile evidence and retain any observed failures.
5. Reconcile the existing topic docs/tool descriptions with the implemented fields and record validation. The second input-coverage change and any release/version bump need their own delivery work; do not expand this slice or mark it complete from portable mocks alone.

Existing code locations for implementation navigation: `src/text.ts`, `src/pointer.ts` and `src/browser-actions.ts` own routed argument contracts; `src/extension.ts`, `src/client.ts`, `src/native.ts` and `src/worker.ts` own forwarding, deadlines and lifecycle; `assets/text.cs` and `assets/pointer.cs` own native effects/release. Prefer existing `tests/text.test.ts`, `tests/pointer.test.ts`, `tests/worker.test.ts`, input-preparation/extension tests and native text/pointer fixtures. These are delivery pointers, not a new shared-module hierarchy.

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

## Default-app and workspace delivery

#30 completed the [accepted policy](spec.md#default-apps-workspaces-and-foreground): Windows handler resolution/opening, existing native-app/ordinary-Chrome workspace preservation and foreground intent, independently reviewed [ambiguity/unsafe-workspace decisions](validation.md#workspace-decision-acceptance), and [popup/menu/drop/restoration acceptance](validation.md#scoped-pointer-and-restoration-acceptance). Reuse these scoped results. Dedicated protocol mode remains explicit; native UI operation does not broaden browser-protocol compatibility. Native creation/recovery (#35) and the reconciled display scope (#6) are complete; reuse their recorded receipts.

Acceptance uses owned fixtures and disposable browser profiles/windows as stand-ins for an existing user workspace: verify the resolved app identity, original tab/document contents unchanged, exactly one new task workspace, reuse on subsequent steps, explicit new-window request, no-existing-window launch, and unsupported/ambiguous outcomes. Independently observe foreground after opening and between related actions, explicit background preservation, result-visible completion and human handback without delayed focus restoration. Share editor checks with #26 and restoration checks with #30; reuse accepted stop/control evidence. Tests must not change the user's actual Windows default associations or operate personal documents. Current Chrome/Edge isolated-channel passes remain scoped evidence, not acceptance of this policy.

## Feasibility gates

These original feasibility gates remain regression obligations. Reuse recorded evidence; repeat checks when changes or missing evidence warrant it:

1. Prove a packaged Windows worker launches from native Pi and WSL2 Pi with clean stdio framing, spaces/Unicode paths, Windows-drive and WSL-filesystem checkouts, cancellation, parent exit and no orphan processes. Users must not install Windows Node separately.
2. Retain the selected TypeScript-managed native helper for UIA, screenshots, OCR, input and stopping. Revisit interop only for a demonstrated Pi defect or concrete simplification; the existing choice does not need another comparison programme.
3. Prove background Chrome/Edge actions, isolated/kept profiles and installed Firefox BiDi control. Evaluate libraries only where they preserve compatibility, targeting, cancellation and background behavior; do not replace installed Firefox support with managed Firefox without revisiting the decision.
4. Prove ownership exclusion between a native Windows session and a WSL2 session, including crash recovery.

Record measurements and outcomes. If a gate fails, bring the concrete trade-off back to the user rather than quietly reducing supported Pi behavior or adding manual setup requirements.

## Coverage matrix

For #6/#20, exercise the opt-in [window-only screenshot contract](spec.md#implementation-decisions) through the existing registered screenshot tool: covered painted pixels, blank-render WGC handoff, hidden/minimized refusal, invalid combinations and unchanged default behavior. Keep strict capture inside the capture module; bypass screen-copy entirely rather than detect unrelated pixels after acquisition. Then use this mode for owned display/presentation fixtures. Actual available DPI/layout checks and the local Snipping Tool result are accepted in the [composed #20 receipt](validation.md#snipping-tool-recording-acceptance); retain its limits.

The existing capture runner supplies backend-free plans and two bounded live modes: `--display` measures per-monitor PMV2 window DPI, independent DWM geometry and painted-point mapping at native/reduced PNG sizes; `--control-capture` samples owned edge pixels before/after strict capture and checks control identity, per-call suspension and settlement release. Run current settings first. In one grouped human session, change only the 1920×1080 monitor from its original 100% to 150%, then the highest available per-monitor preset (175% on this machine), keeping the 2560×1080 monitor at 100%; run both modes at each stage and restore the original settings. The user reports 200% requires custom scaling, sign-out and changing both monitors, so it is unavailable in this scoped session and remains untested; do not apply that configuration. The changed arrangement and local Snipping Tool recording are accepted; unexercised display/primary/recorder variants remain outside the claimed evidence. No command changes global display settings.

Every supported tool gets argument validation, success, failure, cancellation where applicable, and unsupported-target coverage. A matrix entry maps to named tests or an explicit manual procedure; mocked protocol success alone cannot establish real desktop support.

| Area | Required coverage |
| --- | --- |
| Host launch and packaging | Clean install; native Windows and WSL2; missing/corrupt assets; spaces/Unicode; both filesystem locations; startup failure; session reload; parent exit; child cleanup |
| Window discovery and management | List, target ambiguity, HWND/PID identity, stale/reused windows, launch, activate, move, close, unresponsive targets and inaccessible/elevated windows |
| UI Automation | Snapshot, tree, find, element info, focus, invoke, set value; depth/node/time budgets; stale elements; sparse/incomplete trees; native and Chromium fixtures |
| Capture and OCR | Screen/window capture paths and fallback metadata; occlusion/minimized windows; blank capture; image scaling; multi-monitor/DPI coordinates; literal OCR queries; inconclusive absence; [scoped availability/language/cancellation evidence](validation.md#pi-ocr-failure-acceptance), with clean-machine availability owned by #2 |
| Physical and background input | Click/double click/move/drag/scroll/type/key chords; background dispatch and escalation; covered points; focus changes; exclusive-control suppression and human handback; Unicode; clipboard preservation; key/button release |
| Browser control | Chrome/Edge and experimental installed Firefox; tab discovery, navigation, element IDs, reading, input, dialogs, new/closed tabs; navigation invalidation; disconnect/reconnect; cancellation; supported download/upload paths |
| Browser profiles | Temporary isolation, opt-in persistence, profile ownership, crash recovery and owned-resource cleanup for explicit dedicated mode; ordinary browser-window reuse under the [workspace policy](spec.md#default-apps-workspaces-and-foreground); interactive sign-in checked manually |
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
| 3. Finish native agent outcomes | #35 creation/preservation, replacement/partial recovery and composed continuation are accepted. #36 retains its six accepted browser/mixed scenarios. | Named cases passed three fresh runs with effective model metadata and independent outcomes. Actual human/control proof is reused from #31; #20 presentation acceptance is also complete within its recorded scope. |
| 4. Release | Complete #21's remaining functional, clean-install, manual and packaging checks; document known limits and useful Pi responsiveness. | Every Pi release obligation has a result/disposition; no DSH setup, credentials, manual run or timing comparison is needed. |

The completed #35 continuation case [composes registered-tool cancellation and a labelled stand-in edit with real-Pi resumption](validation.md#native-cancellation-and-handback-continuation). Reuse #31's accepted actual-human/control proof; this creates no repeated physical-stop gate.

Execute per bounded case: establish the Pi result, diagnose an actual failure, make a targeted repair and rerun that case/affected regressions. A blocked case stops dependent activity; it does not reopen accepted cases or mandate a framework. No fixed production retry count or new agent policy is introduced.

Reconcile affected docs during each change: requirements here remain in the spec, delivery here, cases/results in validation, behavior in topic guides and rationale in ADRs. Replace stale instructions; preserve historical evidence without making it a current gate. #23/#37 are superseded umbrellas: capability owners retain targeted diagnosis, #35 retains native outcomes, and #21 retains aggregate release reconciliation. The [cleanup dispositions](tickets.md#cleanup-dispositions) still govern removal of demonstrated redundancy.

## Exclusive control delivery

The [accepted control contract](spec.md#exclusive-control) changes shared-input behavior. The candidate uses keyboard/mouse hooks in the existing stop helper, an operation-scoped protection event and the existing worker preparation/settlement protocol. Portable refusal/release regressions and scoped no-input acquisition/handback checks exist; native Pi-host Esc has accepted evidence; known-held cancellation/error, WSL physical shortcut and human handback now have accepted evidence. #31 is accepted through the [composed interruption/cleanup evidence](validation.md#control-interruption-acceptance); presentation and the other capability owners retain their scoped work. Reuse the operation lifecycle, stop listener and existing flat native modules. Keep suppression, emergency-key interpretation and release in one responsible control boundary; tool-specific guards consume its state. Avoid a second ownership controller or public test-only API.

| Slice / owner | Work and exit evidence |
| --- | --- |
| 1. Mechanism feasibility — #31 | On owned fixtures, prove agent input works while ordinary physical input is suppressed, Esc/shortcut remain observable, Windows escape paths remain available, and protection releases after normal completion and failure. Test the actual native Windows and WSL2 launch topology. Compare hook and BlockInput constraints with the existing process/thread layout; select the smallest mechanism that meets the contract. Record unsupported cases. Enforce the [physical fixture prerequisites and cleanup gate](stopping.md#scripted-native-pi-host-fixture); never force-retire uncertain input owners. |
| 2. Integrate lifecycle and presentation — #31, #20 | Use existing operation start/settlement/cancellation paths for acquire, hold, handback and release. Verify the required border through reads/thinking, disabled presentation settings, capture, displays and idle periods. Handback pauses dispatch and explicit continuation revalidates/reacquires. A physical-key completion assertion includes stop observation, cleanup, release and retry protection; error classification is checked separately and remains a defect when wrong. |
| 3. Regress workflows and prune — #26, #27, #30, #31, #35; reconcile #21 | Extend existing pointer/text/clipboard and agent fixtures. Physical typing/movement/click attempts during control have no app effect; during handback they work and are preserved. Test full shortcut chords, agent Escape, real stop during busy input, owner/listener loss and safe interruption/cleanup on lock/session changes. Reuse accepted locked-input refusal and handback checks; target survival or seamless unlock recovery is not a release gate. Retain stale/occluded/foreground/clipboard guards. Remove only branches proven redundant under the new lifecycle, with affected regressions passing. |

The local nonelevated `BlockInput(true)` prerequisite returned Win32 access denied (5), without blocking or dispatching input. On 2026-11-01 the user accepted hooks with documented Windows limits for the first release, as recorded in [ADR 0003](adr/0003-exclusive-desktop-control.md). Hook suppression is not equivalent to OS input blocking: after silent hook removal, the observer cannot prove an event was suppressed or that Esc remains available during idle gaps. That platform limit no longer awaits a product decision. Actual-host integration, physical stop/release, lifecycle and failure acceptance remain required; bounded physical acceptance requires fresh same-launcher normal/host-exit proofs and per-run participant/input-cleanup receipts, without claiming held-input crash cleanup in advance.

Portable lifecycle tests precede integrated Windows checks. Group genuine physical-key/interference and border checks into one short human session rather than repeated prompts. Each result names scope (worker, actual Pi host, native Windows or WSL2); synthetic input alone does not prove physical suppression. Required real-agent scenarios retain their three-reset acceptance. Finish the feasibility slice before broader rewrites; a failed mechanism leads to a recorded limitation/design revision, not silent fallback to shared input.

## Window lifetime design

The user approved stronger tracking under #28. [ADR 0002](adr/0002-window-lifetime-references.md) records the independently reviewed design; the native lifetime implementation has passed independent review with [scoped acceptance](validation.md#window-lifetime-reference-acceptance). Raw selectors remain explicitly weaker compatibility selection.

Use the existing native bridge as the sole reference authority. One optional `windowRef` identifies an observed lifetime; HWND/PID/title and raw native-window IDs remain compatibility selectors. A supplied reference cannot be discarded or restamped internally. Conflicting selectors fail explicitly. Native-child restart expires its references; fresh observation is recovery, never automatic mutation replay.

Bind cached UIA elements to the root reference and an immutable issued element ID, retaining RuntimeId as comparison metadata. Later observations must not overwrite an old reference with another root binding. Reuse the existing private WGC target handoff for stateless marker validation; OCR, snapshot images, waits, implicit targets and physical fallbacks must retain the originating reference.

If marker acquisition fails, preserve ordinary read metadata and an explicit reference-unavailable reason, but issue neither a strong window reference nor actionable native element IDs. Raw native-window selectors remain explicitly compatible; a failed strong reference is never silently converted into one. This avoids presenting an unbound element ID as safe to mutate.

Snapshot's existing default `captureWindow: false` produces a desktop image. Keep that image separately labeled as desktop evidence while the tree carries its window reference; do not forward a window reference into desktop capture or imply those pixels belong to the bound window. Window-image, OCR and hit-test composition retain the observed root reference.

Missing markers, expiry, unknown epochs and access denial are lost proof, not confirmed disappearance. Validate before dispatch and at existing multi-step checks; already-dispatched effects and concurrent destruction after the final check cannot be undone or atomically excluded. Normal expiry/disposal removes only owned markers. Residue after abrupt native-child exit remains explicit; no property sweeper, broker, privilege bypass or new event thread is planned.

The owned-window probe and interface were independently reviewed before implementation. Existing public tool/worker and owned fixtures now exercise the implemented contract, including a provider pause before final validation and a separate post-effect proof-loss case with independent counters. [Current scoped evidence](validation.md#window-lifetime-reference-acceptance) retains isolated-session gaps and distinguishes the separately recorded #6 automatic capture repair. Actual identical-HWND reuse and verified UIPI denial were unavailable in bounded owned probes; the user accepted them as [first-release test limitations](validation.md#pi-targeting-and-accessibility-reconciliation) on 2026-11-05. Different handles or synthetic denial cannot be mislabeled as passes, and identity/access safeguards remain binding. The optional owned-fixture real-time expiry case now validates the actual five-minute lifetime without refreshing or restarting its authority. Paired warm checks add no fixed sleeps or extra model rounds.

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
