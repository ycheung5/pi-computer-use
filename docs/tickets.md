# Implementation tickets

## Current investigation and acceptance work

Current delivery view, reconciled against GitHub on 2026-10-31. Requirements remain in [spec](spec.md); results and retained failures live in [validation](validation.md). Product parent [#1](https://github.com/ycheung5/pi-computer-use/issues/1), repair parent [#23](https://github.com/ycheung5/pi-computer-use/issues/23), and release gate [#21](https://github.com/ycheung5/pi-computer-use/issues/21) remain open.

The goal is one standalone Pi package that completes Windows tasks from native Windows and WSL2, follows pinned DSH behavior, preserves user work and supports recovery. A completed comparison establishes its stated evidence scope; it does not certify the product or close an original requirement.

### Delivery outcomes and ownership

Rows map requirements to implementation, representative checks and the next action. Paths are navigation pointers, not proof every line or environment has been reviewed. Active owners listed below own their original and explicitly transferred criteria. Superseded source issues retain historical evidence; completed comparison issues supply results rather than commission duplicate implementation.

| User outcome / requirement owner | Implementation | Existing checks / evidence | Current state and next completion action |
| --- | --- | --- | --- |
| Install one package and use Pi from Windows or WSL2 — #2, #3 | `src/extension.ts`, `launcher.ts`, `runtime.ts`, `client.ts`, `worker.ts` | `tests/package-host.mjs`, `pi-host.mjs`, `wsl-health.mjs`; [host evidence](validation.md#current-host-acceptance-evidence), #34 | Both current host paths passed scripted packaged health/list. #3 complete; #2 needs clean-Windows provisioning evidence. Reuse host runners. |
| Discover and operate the intended accessible control — #28 (sources #4, #5, #10; completed waits #14) | `src/accessibility.ts`, `desktop.ts`, `waits.ts`; `assets/windows.cs`, `accessibility.cs`, `controls.cs` | `tests/native-accessibility.mjs`, `native-controls.mjs`, `native-waits.mjs`, `accessibility-comparison.mjs`; #28 | #14 complete. Quiet-scroll cancellation/parity, inaccessible and genuinely reused HWND targets, and provider/targeting coverage remain. HWND/PID cannot distinguish same-process reuse; see [Windows guidance](windows.md). |
| Read screenshots/OCR and mapped coordinates — #6, #7 | `src/capture.ts`, `ocr.ts`; capture/OCR C# assets | `tests/native-capture.mjs`, `native-ocr.mjs`, `reference-capture.mjs`; #29 | Scripted comparison complete. Original mixed-DPI/display and OCR availability/language/cancellation evidence remains. Reuse fixtures and grouped manual checks. |
| Manage windows and pointer input while preserving other work — #30 (sources #11, #13; release cleanup #31) | `src/pointer.ts`, `window-management.ts`; corresponding C# assets | `tests/native-pointer-physical.mjs`, `native-pointer-drop.mjs`, `window-management-comparison.mjs`; #30 | Scoped management/counters/drag-drop passed. Foreground restoration, user interference and menu cases remain incomplete. Diagnose observed failures before changing activation. |
| Enter exact text and preserve clipboard state — #26, #27 (source #12; input release #31) | `src/text.ts`; `assets/text.cs`, `clipboard.cs` | `tests/native-notepad-unicode.mjs`, `native-ole-clipboard.mjs`; #26, #27 | Pi exact-text and supported preservation cases passed; pacing remains provisional. Locked-backend, history/cloud and broader interruption coverage remain. These checks do not complete the ordinary Notepad task. |
| Stop safely and resume in a new operation — #31 (source #9; completed ownership #8) | `src/client.ts`, `worker.ts`, `ownership.ts`, `stop.ts`; corresponding C# assets | `tests/ownership-host.mjs`, `native-stop-busy.mjs`, `input-preparation-worker.test.ts`; #31 | #8 complete. Scoped worker Esc/release passed. Pi-host/DSH stop, configured shortcut and known-held-key cases remain. Physical Pi-host runner retains its unproved-cleanup guard. |
| Work in isolated Chrome/Edge pages — #16 (source #15) | `src/browser.ts`, `browser-actions.ts` | `tests/browser-host.mjs`, `browser-actions-host.mjs`, `browser-comparison.mjs`; #32, #33 | Tool acceptance evidence ready for review: named Chrome/Edge actions/transfers/cancellation, both controller paths, current Chrome shared-guard recheck and new truthful startup-failure/cleanup case. [Criterion map](validation.md#consolidated-chromium-tool-acceptance); real-agent recovery remains #36. |
| Use experimental installed Firefox and dedicated sign-ins — #17, #18 | `src/browser.ts`, `browser-profiles.ts` | `tests/browser-firefox-endpoint.mjs`, `browser-profiles-host.mjs`, `browser-advanced-comparison.mjs`; #33 | Official Firefox workflow/reconnect #17 is completed within its experimental scope. Cooperative worker shutdown corrects a demonstrated premature-retirement residue mechanism; [controlled Edge and protocol evidence](validation.md#cooperative-worker-cleanup-control). Historical residue attribution, retained Firefox profiles, live-orphan recovery and real sign-in remain under #18. |
| Configure tools and see active control — #19, #20 | `src/settings.ts`, `stop.ts`, `browser-indicators.ts`; `assets/indicators.cs` | `tests/settings-host.mjs`, `indicators-host.mjs`; [indicator evidence](indicators.md), #34 | #19 complete. User accepted blue gradient appearance/thickness. Two edge hit-test points passed; physical delivery, lifecycle/display/recording checks remain under #20. |
| Complete an ordinary document task and recover — #35 | Pi tool boundary and native modules above | [Native pilots](validation.md#pi-only-ordinary-native-control-pilot), [Notepad failures](validation.md#pi-notepad-activation-refusal) | Owned UIA and sibling-target tasks each passed once. A fresh scoped Notepad run verified exact background append with matching observation/action roots; Save was first guard-blocked, then directly refused by production with foreground unavailable. Saved bytes remained the seed. The prior false match flags came from an uninitialized collector target; ownership cause remains unknown. Next: resolve the actual foreground/save boundary and complete repeated acceptance. DSH model leg is credential-blocked. |
| Complete ordinary browser and mixed tasks with recovery — #36 | Pi tool boundary and browser/native modules above | [Scoped browser pilot](validation.md#scoped-pi-browser-agent-form-pilot) | Scoped exact Pi form submission and delayed confirmation passed three reset runs with independent payload/event oracles; prior guard failures retained. Next: navigation/stale references/dialogs, supported transfers and mixed workflows. DSH leg remains open. |
| Deliver a mature release with traceable departures — #21, #23, #37 | Package and modules above; D01–D08 differences | [Difference register](validation.md#reference-difference-register), [coverage](validation.md#capability-coverage), [manual gates](validation.md#manual-release-gates) | Release incomplete. Diagnose available failures now; final reconciliation still requires all results, regressions, manual gates and comparative performance evidence. |

### Execution queue

| Order | Deliverable and owner | Completion condition |
| --- | --- | --- |
| Done | Reconciliation and justified cleanup — #37 | Delivery map and issue ownership reconciled; eight overlapping issues superseded with transferred criteria. This preparation does not complete #37's full diagnosis. |
| Blocked | Scoped Pi Notepad insertion/append/save — #35 | Actionable error/owned-target evidence, supported recovery, exact accessible/saved result and unrelated fixture state preserved; required three reset successes on final candidate. |
| Active repair | Browser disposal cleanup — #18; informs #16 | Prove truthful graceful retirement and profile removal on the reproduced lifecycle; retain active-input protections and bounded unhealthy-worker handling. Manual sign-in still remains for full #18. |
| Next workflow | Scoped Pi browser outcome/recovery — #36 | Form submission/delayed confirmation completed three resets. Advanced navigation/prompt passed, but a misleading cue-cancellation warning stopped two runs; targeted dialog-cue repair passed its tool regression, real-agent acceptance pending. Confirmation/alert/transfers, stale-reference recovery and mixed workflows still require independent oracles and three reset successes. |
| Remaining | Remaining product acceptance — #2, #6, #7, #16, #18, #20, #26–#28, #30, #31, #21 | Resolve unchecked criteria with named cases/manual checks; reconcile paired DSH results when available. No release from partial success. |

For each repair record the requirement, failure, reference behavior or justified Pi departure, source change, regression and independent outcome. Run relevant checks once per candidate; repeat when a change or unresolved failure warrants it. A new runner needs a named missing case and why existing fixtures cannot cover it.

The user chose scoped disposable tests in the current Windows session and granted standing idle-test authorization. Serialize desktop activity and preserve unrelated apps/documents and clipboard. Request physical participation or visual judgment when needed. DSH real-model runs need `OPENROUTER_API_KEY`, absent from this WSL process; the user chose continued Pi work. Missing DSH credentials or an unrestricted clean session do not block independently safe Pi work.

### Comparison and agent-ticket accounting

| Tickets | GitHub state | Meaning / dependency scope |
| --- | --- | --- |
| #24, #25, #29, #32, #33, #34 | Closed, completed | Six of fourteen follow-up tickets completed audit/comparison scopes. Original requirements retain their acceptance. |
| #16, #26, #27, #28, #30, #31 | Open, active tool deliverables | Original plus transferred product criteria and remaining comparison evidence; each issue identifies its inherited source criteria. |
| #17 | Closed, completed | Official Firefox 144.0 read/lifecycle and actions passed on current sources after a fixture-only date-role correction; prior native-host/paired evidence supplies the remaining supported scope. Retained action-profile cleanup and manual sign-in remain under #18. |
| #35, #36 | Open, partial | Pi pilots exist; recovery/repeated acceptance incomplete. Each safe scenario runs when its actual prerequisites are met. Full closure requires all coverage. |
| #37 | Open, active | Diagnose known cases and maintain repair ownership now. Final aggregate reconciliation waits for #35/#36 and other required results. |

### Cleanup dispositions

| Candidate | Decision | Reason and validation |
| --- | --- | --- |
| Chronological status prose in this document | Replaced by current tables | Detailed evidence remains in validation and issue history; requirements retain owners. |
| Blanket baseline-before-diagnosis sequencing and overlapping issues | Corrected in plan, active issues and parents | Diagnose available failures independently; criteria transferred before eight sources closed as superseded. Final acceptance remains open. |
| Retired `tests/native-text-physical.mjs` execution body | Removed; plan/refusal stub retained | The unconditional refusal made the body unreachable. Existing safety regression passed before/after cleanup; full checks passed 117 tests (one skipped), and package/documentation validation passed. No desktop actions. |
| Process/job/supervisor diagnostic fixtures | Keep for unresolved #27/#31 diagnosis | Different probes establish different cleanup limits. Add work only for a question that can change the next decision; preserve blocked-host guards. |
| Paired runners and portable report/retention tests | Keep | Live effects and offline reporting exercise different boundaries; similar names or size do not prove duplication. |
| `src/browser.ts` and native helper organization | Keep pending concrete simplification evidence | File size does not identify removable behavior. Broad rewriting would obscure alignment/regressions. |
| Unmerged `implement/scroll-reference-28` | Retain unmerged | Increased quiet-scroll steps can outlast timeout; cancellation/partial-effect ownership is unresolved. |

## Original issue disposition

GitHub consolidation on 2026-10-31 reduced open issues from 26 to 18 without declaring new product acceptance. Four original issues (#3, #8, #14, #19) and six comparison issues (#24, #25, #29, #32, #33, #34) were already completed. Subsequent current Firefox validation completed #17, bringing the current open count to 17.

Eight overlapping source issues were closed as **superseded**, using GitHub's not-planned closure reason rather than completed. All original criteria and evidence remain readable in those source issues. Each unchecked criterion was transferred to an open destination before closure; split compound criteria name an owner for every facet.

| Superseded source | Active owner of remaining criteria | Transfer scope |
| --- | --- | --- |
| #4 — discovery | #28 | Criterion 3: ambiguous, disappeared, stale/reused and inaccessible targets. |
| #5 — accessible observations | #28 | Criteria 1 and 3: reference observation options, stale/owner validation and Chromium accessibility. |
| #9 — independent stop | #31 | Criteria 3 and 4: bounded cleanup, stop protection and busy-worker/abort/recovery/manual evidence. |
| #10 — background controls | #28 | Criteria 1 and 2: supported element actions/scroll and owner/foreground/pointer safeguards. |
| #11 — guarded pointer | #30, #31 | Restoration, geometry/occlusion/target-change fixtures: #30. Button release, drag cancellation and non-replay: #31. |
| #12 — text/chords | #26, #27, #31 | Typing/chords/focus: #26. Clipboard/history/cloud: #27. Foreground recheck, release, cancellation/non-replay: #31. Fixture criterion 4 is divided along the same boundaries. |
| #13 — window management | #30 | Criteria 1 and 4: targeting, management lifecycle, cancellation and restriction fixtures. |
| #15 — Chromium setup | #16 | Criteria 1 and 4: installed Chrome/Edge/background compatibility and both-browser/host failure/cleanup fixtures. |

The 17 open issues are three parents/gates (#1 product, #23 repair program, #21 release) and 14 deliverables (#2, #6, #7, #16, #18, #20, #26, #27, #28, #30, #31, #35, #36, #37). Parents route work to these owners. The active repair is #18 disposal cleanup; #35 save remains foreground-blocked, and #36 retains later workflow scenarios. Clean-install, capture/OCR, profiles and indicator obligations remain distinct from closed baseline comparisons.

Close an active deliverable as completed only when all its own and transferred criteria have evidence. Reopening a superseded source is unnecessary while its active owner retains the requirement. Preserve failures and limitations; use the [execution queue](#execution-queue) and [plan](implementation-plan.md#detailed-milestones) for current sequencing.
