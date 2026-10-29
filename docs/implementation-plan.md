# Pi computer-use implementation plan

Status: scope confirmed by the user; specification synthesized. No application implementation exists yet.

Requirements and behavioral contracts are authoritative in the [specification](spec.md). Use the [documentation index](README.md) to load only relevant context.

## Structure

Start with flat, responsibility-named TypeScript modules in `src/`, tests in `tests/`, and packaged assets in `assets/` when needed. Keep host-specific launcher and Windows interop logic separate from reusable orchestration through modules, without pre-creating nested directories. The [repository layout](README.md#repository-layout) is the navigation guide.

## Feasibility gates

Complete these early in milestone 1, before investing in the full implementation:

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

Use deterministic local browser pages and dedicated disposable Windows fixture apps for automation. Do not drive the user's normal apps or profiles in automated suites. Separate portable unit/contract tests from live Windows integration suites, and separate tests that emit physical input so they run only on a dedicated interactive desktop.

Exercise the integrated extension through both native Windows Pi and WSL2 Pi; worker-only tests do not prove both launch paths. Pin/document tested Pi and dependency versions. Retain failure logs and timing artifacts without persisting sensitive desktop content unnecessarily. CI may run portable tests and suitable Windows fixtures; interactive-desktop, multi-monitor, emergency-stop and user acceptance runs must be recorded separately when CI cannot reproduce them.

## Detailed milestones

1. **Foundation and feasibility:** package/toolchain/lockfile; worker protocol and launcher; runtime packaging and native-interop experiments; ownership proof; initial contract tests; reference capability/parameter inventory and benchmark harness.
2. **Pi and desktop integration:** native tool registration, personal settings command, tool loading modes, lifecycle/operation tracking, worker queue and cancellation; Windows observation, capture/OCR, guarded input/window actions, independent stopping and indicators.
3. **Browser and presentation parity:** Chrome/Edge and experimental Firefox paths; isolated/kept profiles; browser page-change results; Pi rendering and settings; integration tests for browser actions and failures.
4. **Release validation:** complete coverage matrix on both hosts; clean-install checks, performance comparison and documented limitations; user acceptance testing; resolve failures before declaring release readiness.

Each milestone must be runnable and testable. Full feature parity remains the first-release criterion; incremental milestones are not a reduced-scope release.

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
