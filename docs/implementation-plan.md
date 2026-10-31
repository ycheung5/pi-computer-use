# Pi computer-use implementation plan

Status: implementation and acceptance work on `integration/reference-alignment`. See [current draft PR #38](https://github.com/ycheung5/pi-computer-use/pull/38) for the active integration and [current delivery outcomes](tickets.md#delivery-outcomes-and-ownership) for remaining work; release acceptance is incomplete.

Requirements and behavioral contracts are authoritative in the [specification](spec.md). Use the [documentation index](README.md) to load only relevant context.

## Structure

Keep flat, responsibility-named TypeScript modules in `src/`, tests in `tests/`, and packaged assets in `assets/`. Keep host-specific launcher and Windows interop logic separate from reusable orchestration through modules, without pre-creating nested directories. The [repository layout](README.md#repository-layout) is the navigation guide.

## Feasibility gates

These original feasibility gates remain regression obligations. Reuse recorded evidence; repeat checks when changes or missing evidence warrant it:

1. Prove a packaged Windows worker launches from native Pi and WSL2 Pi with clean stdio framing, spaces/Unicode paths, Windows-drive and WSL-filesystem checkouts, cancellation, parent exit and no orphan processes. Users must not install Windows Node separately.
2. Compare a small native helper with TypeScript-accessible native interop for UIA, screenshots, OCR, input and global stopping. Prefer TypeScript, but choose the smallest maintainable implementation that satisfies failure isolation and Windows threading requirements. Do not infer that the Pi SDK itself supplies desktop access.
3. Prove background Chrome/Edge actions, isolated/kept profiles and installed Firefox BiDi control. Evaluate libraries only where they preserve compatibility, targeting, cancellation and background behavior; do not replace installed Firefox support with managed Firefox without revisiting the decision.
4. Prove ownership exclusion between a native Windows session and a WSL2 session, including crash recovery.

Record measurements and outcomes. If a gate fails, bring the concrete trade-off back to the user rather than quietly reducing parity or adding manual setup requirements.

## Coverage matrix

Every supported tool gets argument validation, success, failure, cancellation where applicable, and unsupported-target coverage. A matrix entry maps to named tests or an explicit manual procedure; mocked protocol success alone cannot establish real desktop support.

| Area | Required coverage |
| --- | --- |
| Host launch and packaging | Clean install; native Windows and WSL2; missing/corrupt assets; spaces/Unicode; both filesystem locations; startup failure; session reload; parent exit; child cleanup |
| Window discovery and management | List, target ambiguity, HWND/PID identity, stale/reused windows, launch, activate, move, close, unresponsive targets and inaccessible/elevated windows |
| UI Automation | Snapshot, tree, find, element info, focus, invoke, set value; depth/node/time budgets; stale elements; sparse/incomplete trees; native and Chromium fixtures |
| Capture and OCR | Screen/window capture paths and fallback metadata; occlusion/minimized windows; blank capture; image scaling; multi-monitor/DPI coordinates; literal OCR queries; inconclusive absence |
| Physical and background input | Click/double click/move/drag/scroll/type/key chords; background dispatch and escalation; covered points; focus changes; user interference; Unicode; clipboard preservation; key/button release |
| Browser control | Chrome/Edge and experimental installed Firefox; tab discovery, navigation, element IDs, reading, input, dialogs, new/closed tabs; navigation invalidation; disconnect/reconnect; cancellation; reference-supported download/upload paths |
| Browser profiles | Temporary isolation, opt-in persistence, profile ownership, crash recovery, cleanup and no connection to daily profiles; interactive sign-in checked manually |
| Operation lifecycle | Multi-turn ownership; parallel calls; busy competitors across hosts; queued cancellation; emergency stop during input; blocked same-operation retries; new user operation; worker timeout and recovery |
| Settings and tool management | Defaults, persistence, invalid settings, full/lite/lazy/custom modes, execution denial, settings changes while active, stop shortcut and indicator configuration |
| Presentation | Pi tool rendering, image results, evidence/error distinctions; real indicators, stop shortcuts, remote/recording visibility and display changes checked manually |
| Performance | Reproducible cold startup, warm reads, input dispatch and complete workflows compared with reference on the same machine |

Use deterministic local pages, isolated browser profiles and disposable Windows targets. The user selected scoped tests in the current Windows session with standing idle-test authorization. Bound actions to owned disposable targets and preserve unrelated apps/documents; serialize desktop activity. Separate portable, live and physical-input suites. A fixture requiring stronger isolation stays blocked until its actual prerequisites are met.

Exercise the integrated extension through both native Windows Pi and WSL2 Pi; worker-only tests do not prove both launch paths. Pin/document tested Pi and dependency versions. Retain failure logs and timing artifacts without persisting sensitive desktop content unnecessarily. CI may run portable tests and suitable Windows fixtures; interactive-desktop, multi-monitor, emergency-stop and user acceptance runs must be recorded separately when CI cannot reproduce them.

## Detailed milestones

The initial foundation, desktop and browser implementation exists; release acceptance is incomplete. The current work is the following investigation and repair cycle, tracked by [issue #23](https://github.com/ycheung5/pi-computer-use/issues/23), not a restart of initial implementation. Requirements remain in the [spec](spec.md); named cases and evidence live in [validation](validation.md#alignment-scenario-catalog).

| Phase | Work and tests | Exit evidence |
| --- | --- | --- |
| 1. Audit differences | Map all 25 declarations, descriptions, defaults, routing, fallback, results and lifecycle behavior to DSH. Trace previous fixes to symptoms and tests. Diagnose the latest schema-runner failure. | Each material difference is classified and linked to a test or required investigation; the schema runner produces a valid result. No behavioral-parity claim from schema equality. |
| 2. Collect tool baseline | Run existing deterministic suites and paired native/browser scenarios on reset fixtures. Cover every capability's supported success and relevant failure paths. Collect the whole runnable suite, not just the first failure. | Versioned outcome report, missing coverage and blocked environments explicitly listed; sufficient reproductions to distinguish implementation problems from fixture/environment problems. Failures remain open. |
| 3. Collect agent baseline | Run ordinary outcome-based tasks and controlled recovery scenarios in Pi and DSH. Permit supported recovery within disposable test data. | Outcome and trace report for each host/model combination; observed recovery, unnecessary stops, interventions and misleading success claims recorded. No presumed model causation. |
| 4. Diagnose and align | Reproduce failures with direct tool calls where possible. Compare mechanisms and change one suspected cause at a time. Implement reference behavior unless a demonstrated gap requires improvement. | Failed cases and affected regressions rerun; required task/recovery scenarios pass three consecutive reset runs on the final candidate. Unresolved outcomes remain failed, blocked or explicitly accepted limitations. |
| 5. Optimize | Retain the accepted cases and measure justified changes against them and DSH. | Correctness and preservation first, fewer unnecessary interventions second, latency and token use third. No improvement claim from speed alone. |

The phases describe evidence and completion obligations. Execute phases 2–4 per scenario: collect its baseline, diagnose an observed failure, make a targeted repair, and rerun that scenario and affected regressions. Full-suite collection is not a prerequisite for diagnosing an available failure. A blocked or unsafe case halts its dependent activity; independently safe Pi scenarios remain runnable, including while DSH credentials are unavailable. Final reconciliation still accounts for every required outcome. No fixed production retry count or five-minute agent policy is introduced.

Every investigation or implementation change must reconcile the affected documentation before its phase closes: requirements in the spec, sequencing here, cases/results in validation, current behavior in topic guides, and deliberate-deviation rationale in an ADR. Replace stale guidance and remove duplicate instructions; preserve concise historical evidence without presenting it as current acceptance. Update the index and check links after moves.

Current checkpoint (2026-10-31): audit/comparison tickets #24, #25, #29, #32, #33 and #34 are complete in their recorded scopes. Other tool comparisons and real-agent acceptance are partial. Targeted schema, guidance, input-protocol and browser-control repairs have already landed; final acceptance and optimization remain incomplete. Use the [execution queue](tickets.md#execution-queue) rather than restarting implementation or waiting for every unrelated comparison. Reuse existing fixtures; each new runner requires a named coverage gap. No new public test-only seam is planned.

## Window lifetime design

The user approved stronger tracking under #28. [ADR 0002](adr/0002-window-lifetime-references.md) records the independently reviewed design; the native lifetime implementation has passed independent review with [scoped acceptance](validation.md#window-lifetime-reference-acceptance). Raw selectors remain explicitly weaker compatibility selection.

Use the existing native bridge as the sole reference authority. One optional `windowRef` identifies an observed lifetime; HWND/PID/title and raw native-window IDs remain compatibility selectors. A supplied reference cannot be discarded or restamped internally. Conflicting selectors fail explicitly. Native-child restart expires its references; fresh observation is recovery, never automatic mutation replay.

Bind cached UIA elements to the root reference and an immutable issued element ID, retaining RuntimeId as comparison metadata. Later observations must not overwrite an old reference with another root binding. Reuse the existing private WGC target handoff for stateless marker validation; OCR, snapshot images, waits, implicit targets and physical fallbacks must retain the originating reference.

If marker acquisition fails, preserve ordinary read metadata and an explicit reference-unavailable reason, but issue neither a strong window reference nor actionable native element IDs. Raw native-window selectors remain explicitly compatible; a failed strong reference is never silently converted into one. This avoids presenting an unbound element ID as safe to mutate.

Snapshot's existing default `captureWindow: false` produces a desktop image. Keep that image separately labeled as desktop evidence while the tree carries its window reference; do not forward a window reference into desktop capture or imply those pixels belong to the bound window. Window-image, OCR and hit-test composition retain the observed root reference.

Missing markers, expiry, unknown epochs and access denial are lost proof, not confirmed disappearance. Validate before dispatch and at existing multi-step checks; already-dispatched effects and concurrent destruction after the final check cannot be undone or atomically excluded. Normal expiry/disposal removes only owned markers. Residue after abrupt native-child exit remains explicit; no property sweeper, broker, privilege bypass or new event thread is planned.

The owned-window probe and interface were independently reviewed before implementation. Existing public tool/worker and owned fixtures now exercise the implemented contract, including a provider pause before final validation and a separate post-effect proof-loss case with independent counters. [Current scoped evidence](validation.md#window-lifetime-reference-acceptance) retains isolated-session gaps and distinguishes the separately recorded #6 automatic capture repair. Actual identical-HWND reuse, verified UIPI denial and real-time expiry remain distinct prerequisites; different handles or synthetic denial cannot be mislabeled as those cases. Paired warm checks add no fixed sleeps or extra model rounds.

Live binding tests stay on disposable owned windows. Global discovery and internal launch-enumeration paths must be reviewed for metadata writes; tests that would bind unrelated windows require a suitably isolated session rather than bypassing the user's scoped-test choice.

## Completion criteria

- Every reference capability has a documented implementation mapping and appropriate tests; experimental and unsupported cases are labeled honestly.
- Required portable and live integration suites pass on the agreed hosts, with manual indicator/stop/display checks and user acceptance recorded.
- Clean installation works with default Pi, with runtime/helper dependencies supplied or managed by the package and no extra Pi extension or DSH installation.
- Performance results are compared against the reference; regressions are explained and addressed or explicitly accepted, without removing safeguards.
- README covers installation, prerequisites, development, build/package, tests, troubleshooting, settings/profile locations and known limitations.
- The consolidated scope has been confirmed by the user; implement against the specification and report feasibility failures before changing its contracts.

## Technology choices to resolve through feasibility work

- Packaged worker feasibility and the minimum necessary native interop.
- Library choices that reduce custom browser and Windows interop logic without sacrificing agreed behavior.
- Exact ownership primitive, worker framing, package data paths and bounded shutdown deadlines, supported by the feasibility results.

## Evidence

See [Pi extension research](pi-extension-research.md). The inspected reference is version 0.5.3 at commit `6fb642129595a6357588c70812974951db304662`.
