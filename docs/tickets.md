# Implementation tickets

Requirements live in [spec](spec.md), delivery/coverage in [implementation-plan](implementation-plan.md), results in [validation](validation.md). This is the current Pi-first queue, reconciled on 2026-11-06 under [ADR 0004](adr/0004-pi-first-acceptance.md). DSH manual/host/model comparisons, credentials and parity benchmarks are discarded.

## Current investigation and acceptance work

### Current progress

| Measure | Status after scope reconciliation |
| --- | --- |
| Tool implementation | All 25 target tools have implementations. Release acceptance concerns Pi correctness, preservation and usability. |
| Completed issues | 21: #3, #7, #8, #14, #16, #17, #18, #19, #24, #25, #26, #27, #28, #29, #30, #31, #32, #33, #34, #35, #36. Historical comparison completions retain their original evidence scope. |
| Superseded issues | 10: #4, #5, #9, #10, #11, #12, #13, #15, #23, #37. Superseded is not a completed product delivery. |
| Open issues | 5: product #1, release #21 and 3 bounded Pi deliverables below. |
| Accepted Pi outcomes | Windows/WSL2 packaged launch, ownership, waits, settings/tool selection, Chromium and experimental Firefox workflows; six browser/mixed agent scenarios each passed three reset runs. Native creation/preservation, replacement/partial recovery and composed continuation (#35), #31 control interruption/cleanup and human-confirmed GitHub sign-in persistence/removal also passed. |
| Latest recorded checks | 187 passed, one skipped; build and current-scale owned display/border checks passed. Existing package/docs and model-free native document/recovery/handback evidence remains scoped to its receipts. #26 chord/editor-focus and #30 app/workspace outcomes are accepted; earlier failures remain recorded. |

The package is implemented; remaining work is targeted Pi acceptance and repair. An open issue does not reopen its accepted cases. No overall completion percentage is asserted, and no release is declared. The earlier development baseline and historical comparison receipts remain available through commits/archive tags.

### Delivery outcomes and ownership

| Owner | Accepted work | Remaining Pi outcome |
| --- | --- | --- |
| #2 — clean installation | Runtime/package provisioning and both current-machine Pi host paths passed; #3/#34 complete. | Clean disposable Windows/WSL installation and prerequisite failure diagnostics; user-deferred. |
| #6 — screenshot mapping | Capture/fallback, scoped 100% two-monitor/negative-origin mapping and actual 150%/100% and 175%/100% mixed-DPI mapping passed; [stages](validation.md#mixed-dpi-stages). Optional window-only covered/blank pixels and hidden/minimized refusals also passed. | Topology/size-change mapping and original-setting restoration remain; 200% unavailable in this scoped session, not passed. Share display evidence with #20/#30. |
| #7 — OCR failures | Literal/CJK text, bounds and partial-result semantics passed in named cases. | Completed: missing-resource/null-engine refusals, actual profile-language reporting and cancellation after dispatch with helper exit/fresh-operation recovery; [scoped receipt](validation.md#pi-ocr-failure-acceptance). Clean-machine compatibility stays #2; display mapping stays #6. |
| #18 — remembered sign-in | Profile lifecycle evidence plus human-confirmed GitHub authentication across actual Pi restart and verified test-profile removal passed. | Completed; [scoped receipt](validation.md#manual-github-remembered-sign-in). |
| #20 — visible control | Appearance, basic acquire/release/settings/click-through and automated lifecycle accepted. Owned strict PrintWindow border exclusion/control passed at 100%/100%, 150%/100% and 175%/100%; [stages](validation.md#mixed-dpi-stages). | Topology and recording remain; 200% unavailable here, not passed; strict-path pixel evidence does not certify every capture/OCR path. |
| #26 — chords/focus | Six exact-text cases, physical RichEdit chord/selection effects, distinct main/preserve destinations, refusal checks and reused #31 human-edit continuation passed. | Completed for the supported editor scope; [acceptance and limitations](validation.md#pi-chords-and-editor-focus-acceptance). Keep the provisional text delay; no universal shortcut/IME claim. |
| #27 — clipboard preservation | Rich/OLE preservation, unsupported virtual-file refusal and newer-copy preservation passed. | Completed: actual backend-busy refusal, observed exclusion markers and preserved application copy across released-control continuation; [scoped acceptance](validation.md#pi-clipboard-contention-and-privacy-acceptance). |
| #28 — targeting/UIA | Native/Chromium/provider/budget/scroll, lifetime and registered-tool/host receipts [reconciled](validation.md#pi-targeting-and-accessibility-reconciliation); no DSH rerun required. | Completed with user-accepted first-release test limitations on 2026-11-05: genuine same-HWND/PID reuse and verified UIPI denial remain unverified. Identity/access safeguards remain unchanged. |
| #30 — apps/foreground/restoration | Default-handler/native-app and ordinary Chrome reuse, original preservation, three ambiguity and three unavailable-workspace agent decisions, popup/native-menu/cross-process drop and exact cursor/foreground restoration passed. The one-pixel conversion defect is repaired. | Completed for its supported scope: [workspace decisions](validation.md#workspace-decision-acceptance), [pointer receipt](validation.md#scoped-pointer-and-restoration-acceptance). Preserve Windows activation-refusal limits; native create/recovery stays #35 and displays stay #6. |
| #31 — stop/control | Native Pi Esc, worker shortcut/suppression, native/WSL command stop, rejection/recovery and no-input host-exit cleanup passed; queued-settlement bug fixed. Four known-held Ctrl/button cancellation/target-error cases and actual WSL Pi Ctrl+Alt+F9 and human handback/resume also passed. | Completed: native availability-loss response and existing worker/held-input/host/handback results satisfy the narrowed scope; [acceptance](validation.md#control-interruption-acceptance). |
| #35 — native agent goals | Three preopened append/save tasks, three creation/preservation/save resets and three replacement/partial-observation recovery workflows have accepted independent evidence. [Creation](validation.md#native-document-workflow); [recovery and collector-failure disposition](validation.md#native-replacement-and-partial-observation-recovery-preparation). | Completed: three real-Pi continuation resets preserved the labelled stand-in edit after cancelled/retired setup. [Composed handback acceptance](validation.md#native-cancellation-and-handback-continuation) reuses #31 actual human/control proof; no new physical-control claim. |
| #36 — browser/mixed agent goals | Six named Pi scenarios passed three resets: form/delay; navigation/dialog/transfer; stale recovery; quiet mixed task; partial-observation recovery; held-navigation cancellation. | Completed for this scope. Shared physical control stays #31/#20; native creation/recovery stays #35. No DSH leg remains. |
| #21 under #1 — release | Capability mapping, existing checks and accepted scopes retained. | Reconcile the Pi owners above, known failures/limits, useful responsiveness, package/docs/version and final user acceptance; then publish. |

### Execution queue

Work on one bounded missing outcome at a time. Reuse accepted evidence across issues and diagnose an observed Pi failure before changing its mechanism.

| Order / owner | Next action | User involvement |
| --- | --- | --- |
| 1 — #6/#20 | 100%/150%/175% mapping and strict border/control checks passed. Confirm original scaling restored, then reconcile topology/recording/unavailable-200% gaps. | User restores the secondary from 175% to 100% after testing; no custom scaling/sign-out. Actual topology/recording judgment where required. |
| Deferred — #2 | Validate clean installation once a resettable disposable guest exists. | User explicitly deferred the environment. Do not repeatedly ask or change host virtualization. |
| Final — #21/#1 | Reconcile all Pi outcomes and accepted limitations, perform final required checks and prepare release. | Final supported-workflow acceptance after agent-owned work is ready. |

Standing scoped idle-test authorization remains. Preserve unrelated applications, documents, clipboard and profiles, serialize desktop activity and request human participation only for genuine physical/private/visual steps. Unknown input cleanup retains actual owners and blocks dependent activity. No DSH/OpenRouter credentials, DSH installation or side-by-side tests are needed.

### Comparison and agent-ticket accounting

| Tickets | Disposition |
| --- | --- |
| #24/#25/#29/#32/#33/#34 | Previously completed baseline/audit scopes; retained evidence is useful context, not a future DSH test programme. |
| #36 | Completed on existing named Pi workflow evidence after dropping the DSH leg. This does not assert that its older quiet scenarios tested the later physical-control implementation. |
| #23/#37 | Superseded, not completed. Pi diagnosis stays with capability owners; native outcomes with #35; aggregate evidence/failure disposition and release reconciliation with #21 under #1. |
| #26/#27/#28/#30/#31 | Existing Pi behavior/correctness owners; comparison-only clauses removed. |
| #16/#17/#19/#14/#8/#3 | Completed product slices retain their accepted scope; remaining shared obligations stay with their current owners. |

### Cleanup dispositions

| Candidate | Disposition | Reason |
| --- | --- | --- |
| Repeated Pi host mocks and guard-probe setup | Consolidated into existing helpers | One host adapter retains both current tools and registration history, preserving duplicate-registration assertions. The same guard probe serves retained and running states. |
| Child processes used only to call the pure report verifier | Removed | Call the existing verifier directly with serialized report facts. Keep subprocesses where the behavior under test actually involves a process or host. |
| Duplicate browser budget checks and unreachable `set_value` validation | Removed | Existing routed action schemas already enforce the same or stricter limits; `set_value` always uses its action normalizer. Public worker argument checks preserve those contracts. |
| Repeated accepted evidence in this execution queue | Consolidated | Current status remains in the delivery map; source-scoped receipts remain in validation. The queue now states unfinished next actions. |
| Windows worker/native bridge/independent stop and ownership | Keep | These isolate host differences, native execution and stopping of busy work. Removing them would remove required behavior or move the same complexity into callers. |
| Process/job/supervisor diagnostic fixtures | Keep only for a named remaining Pi question | Remove a diagnostic when its question is resolved or a retained behavior-level case replaces it; size alone does not establish redundancy. |
| Browser engine-specific code | Keep concrete supported behavior | Chromium and Firefox are real variations, but an engine adapter must hide actual repeated differences. Do not add a class hierarchy or split files merely to move line counts. |

## Original issue disposition

The 2026-10-31 consolidation transferred source obligations rather than claiming them completed. On 2026-11-02 the user removed DSH manual/parity acceptance. #36 can close on its recorded Pi results; #23/#37 retire as duplicate/superseded umbrellas. Their remaining Pi obligations are owned below and in #21, not discarded.

| Superseded source | Current owner | Retained Pi scope |
| --- | --- | --- |
| #4/#5/#10 | #28 | Discovery, stale/wrong/inaccessible targets, native/Chromium observations and supported control/scroll behavior. |
| #9 | #31 | Stop protection, bounded cleanup, same-operation rejection/new-user recovery and genuine physical-stop evidence. |
| #11 | #30/#31 | Pointer geometry/restoration versus held-button release/cancellation/non-replay. |
| #12 | #26/#27/#31 | Text/chords/focus; clipboard/privacy/restoration; input cancellation/held-key release/non-replay. |
| #13 | #30 | Application/window management, targeting, lifecycle and failure behavior. |
| #15 | Completed #16 | Supported Chromium tool workflows; broader profile/sign-in completed in #18. |
| #23/#37 | #1/#21 and existing capability owners | Current Pi failure diagnosis/targeted repairs with the owning issue; aggregate capability/agent evidence, model/host identity, failure disposition and readiness with #21. |

Closed historical issues retain their original results with a scope-supersession notice. Do not reopen them to demand DSH comparisons. Close a Pi deliverable as completed only when its Pi criteria have evidence; use `not_planned` for superseded scope, preserving explicit ownership. No new umbrella, test framework or replacement ticket set is introduced.
