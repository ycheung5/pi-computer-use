# Implementation tickets

## Current investigation and acceptance work

Current delivery view, reconciled against GitHub on 2026-10-31. Requirements remain in [spec](spec.md); results and retained failures live in [validation](validation.md). Product parent [#1](https://github.com/ycheung5/pi-computer-use/issues/1), repair parent [#23](https://github.com/ycheung5/pi-computer-use/issues/23), and release gate [#21](https://github.com/ycheung5/pi-computer-use/issues/21) remain open.

The goal is one standalone Pi package that completes Windows tasks from native Windows and WSL2, follows pinned DSH behavior, preserves user work and supports recovery. A completed comparison establishes its stated evidence scope; it does not certify the product or close an original requirement.

### Delivery outcomes and ownership

Rows map requirements to implementation, representative checks and the next action. Paths are navigation pointers, not proof every line or environment has been reviewed. Original issues own product criteria; comparison issues supply evidence rather than commission duplicate implementation.

| User outcome / requirement owner | Implementation | Existing checks / evidence | Current state and next completion action |
| --- | --- | --- | --- |
| Install one package and use Pi from Windows or WSL2 — #2, #3 | `src/extension.ts`, `launcher.ts`, `runtime.ts`, `client.ts`, `worker.ts` | `tests/package-host.mjs`, `pi-host.mjs`, `wsl-health.mjs`; [host evidence](validation.md#current-host-acceptance-evidence), #34 | Both current host paths passed scripted packaged health/list. #3 complete; #2 needs clean-Windows provisioning evidence. Reuse host runners. |
| Discover and operate the intended accessible control — #4, #5, #10, #14 | `src/accessibility.ts`, `desktop.ts`, `waits.ts`; `assets/windows.cs`, `accessibility.cs`, `controls.cs` | `tests/native-accessibility.mjs`, `native-controls.mjs`, `native-waits.mjs`, `accessibility-comparison.mjs`; #28 | #14 complete. Quiet-scroll cancellation/parity, inaccessible and genuinely reused HWND targets, and provider/targeting coverage remain. HWND/PID cannot distinguish same-process reuse; see [Windows guidance](windows.md). |
| Read screenshots/OCR and mapped coordinates — #6, #7 | `src/capture.ts`, `ocr.ts`; capture/OCR C# assets | `tests/native-capture.mjs`, `native-ocr.mjs`, `reference-capture.mjs`; #29 | Scripted comparison complete. Original mixed-DPI/display and OCR availability/language/cancellation evidence remains. Reuse fixtures and grouped manual checks. |
| Manage windows and pointer input while preserving other work — #11, #13 | `src/pointer.ts`, `window-management.ts`; corresponding C# assets | `tests/native-pointer-physical.mjs`, `native-pointer-drop.mjs`, `window-management-comparison.mjs`; #30 | Scoped management/counters/drag-drop passed. Foreground restoration, user interference and menu cases remain incomplete. Diagnose observed failures before changing activation. |
| Enter exact text and preserve clipboard state — #12 | `src/text.ts`; `assets/text.cs`, `clipboard.cs` | `tests/native-notepad-unicode.mjs`, `native-ole-clipboard.mjs`; #26, #27 | Pi exact-text and supported preservation cases passed; pacing remains provisional. Locked-backend, history/cloud and broader interruption coverage remain. These checks do not complete the ordinary Notepad task. |
| Stop safely and resume in a new operation — #8, #9 | `src/client.ts`, `worker.ts`, `ownership.ts`, `stop.ts`; corresponding C# assets | `tests/ownership-host.mjs`, `native-stop-busy.mjs`, `input-preparation-worker.test.ts`; #31 | #8 complete. Scoped worker Esc/release passed. Pi-host/DSH stop, configured shortcut and known-held-key cases remain. Physical Pi-host runner retains its unproved-cleanup guard. |
| Work in isolated Chrome/Edge pages — #15, #16 | `src/browser.ts`, `browser-actions.ts` | `tests/browser-host.mjs`, `browser-actions-host.mjs`, `browser-comparison.mjs`; #32, #33 | Scripted comparisons complete; disabled/read-only/nested-focus fixes have regressions. Original installed-browser, cancellation, background and transfer obligations retain missing evidence. |
| Use experimental installed Firefox and dedicated sign-ins — #17, #18 | `src/browser.ts`, `browser-profiles.ts` | `tests/browser-firefox-endpoint.mjs`, `browser-profiles-host.mjs`, `browser-advanced-comparison.mjs`; #33 | Experimental scope retained. Reconnect/profile recovery and interactive sign-in obligations remain; comparison findings do not certify product acceptance. |
| Configure tools and see active control — #19, #20 | `src/settings.ts`, `stop.ts`, `browser-indicators.ts`; `assets/indicators.cs` | `tests/settings-host.mjs`, `indicators-host.mjs`; [indicator evidence](indicators.md), #34 | #19 complete. User accepted blue gradient appearance/thickness. Two edge hit-test points passed; physical delivery, lifecycle/display/recording checks remain under #20. |
| Complete an ordinary document task and recover — #35 | Pi tool boundary and native modules above | [Native pilots](validation.md#pi-only-ordinary-native-control-pilot), [Notepad failures](validation.md#pi-notepad-activation-refusal) | Owned UIA and sibling-target tasks each passed once. Notepad append/save failed on activation, then unexplained ownership. Next: retain diagnostic evidence and solve this scoped workflow. DSH model leg is separately credential-blocked. |
| Complete ordinary browser and mixed tasks with recovery — #36 | Pi tool boundary and browser/native modules above | [Scoped browser pilot](validation.md#scoped-pi-browser-agent-form-pilot) | One scoped Pi form workflow passed; guard failures retained. Next: delayed confirmation, navigation/stale references/dialogs and supported transfers, then required three reset successes. DSH leg remains open. |
| Deliver a mature release with traceable departures — #21, #23, #37 | Package and modules above; D01–D08 differences | [Difference register](validation.md#reference-difference-register), [coverage](validation.md#capability-coverage), [manual gates](validation.md#manual-release-gates) | Release incomplete. Diagnose available failures now; final reconciliation still requires all results, regressions, manual gates and comparative performance evidence. |

### Execution queue

| Order | Deliverable and owner | Completion condition |
| --- | --- | --- |
| 1 | Reconciliation and justified cleanup — #37 | Current outcome map, explicit blockers, cleanup dispositions and synchronized plan/issues. This preparation does not complete #37's full diagnosis. |
| 2 | Scoped Pi Notepad insertion/append/save — #35 | Actionable error/owned-target evidence, supported recovery, exact accessible/saved result and unrelated fixture state preserved; required three reset successes on final candidate. |
| 3 | Scoped Pi browser outcome/recovery — #36 | Independent submitted/delayed/file oracles, supported recovery and required three reset successes per required scenario. Reuse existing pages. |
| 4 | Remaining original acceptance — #2, #4–#7, #9–#13, #15–#18, #20, #21 | Resolve unchecked criteria with named cases/manual checks; reconcile paired DSH results when available. No release from partial success. |

For each repair record the requirement, failure, reference behavior or justified Pi departure, source change, regression and independent outcome. Run relevant checks once per candidate; repeat when a change or unresolved failure warrants it. A new runner needs a named missing case and why existing fixtures cannot cover it.

The user chose scoped disposable tests in the current Windows session and granted standing idle-test authorization. Serialize desktop activity and preserve unrelated apps/documents and clipboard. Request physical participation or visual judgment when needed. DSH real-model runs need `OPENROUTER_API_KEY`, absent from this WSL process; the user chose continued Pi work. Missing DSH credentials or an unrestricted clean session do not block independently safe Pi work.

### Comparison and agent-ticket accounting

| Tickets | GitHub state | Meaning / dependency scope |
| --- | --- | --- |
| #24, #25, #29, #32, #33, #34 | Closed, completed | Six of fourteen follow-up tickets completed audit/comparison scopes. Original requirements retain their acceptance. |
| #26, #27, #28, #30, #31 | Open, partial | Remaining comparisons and safety/behavior evidence; each issue retains unchecked criteria. |
| #35, #36 | Open, partial | Pi pilots exist; recovery/repeated acceptance incomplete. Each safe scenario runs when its actual prerequisites are met. Full closure requires all coverage. |
| #37 | Open, active | Diagnose known cases and maintain repair ownership now. Final aggregate reconciliation waits for #35/#36 and other required results. |

### Cleanup dispositions

| Candidate | Decision | Reason and validation |
| --- | --- | --- |
| Chronological status prose in this document | Replaced by current tables | Detailed evidence remains in validation and issue history; requirements retain owners. |
| Blanket baseline-before-diagnosis sequencing | Corrected in plan and #23/#35–#37 | Diagnose available failures independently; final aggregate completion still requires complete evidence. |
| Retired `tests/native-text-physical.mjs` execution body | Removed; plan/refusal stub retained | The unconditional refusal made the body unreachable. Existing safety regression passed before/after cleanup; full checks passed 117 tests (one skipped), and package/documentation validation passed. No desktop actions. |
| Process/job/supervisor diagnostic fixtures | Keep for unresolved #27/#31 diagnosis | Different probes establish different cleanup limits. Add work only for a question that can change the next decision; preserve blocked-host guards. |
| Paired runners and portable report/retention tests | Keep | Live effects and offline reporting exercise different boundaries; similar names or size do not prove duplication. |
| `src/browser.ts` and native helper organization | Keep pending concrete simplification evidence | File size does not identify removable behavior. Broad rewriting would obscure alignment/regressions. |
| Unmerged `implement/scroll-reference-28` | Retain unmerged | Increased quiet-scroll steps can outlast timeout; cancellation/partial-effect ownership is unresolved. |

## Original issue disposition

GitHub checked on 2026-10-31: #3, #8, #14 and #19 are closed as completed. #2, #4–#7, #9–#13, #15–#18 and #20 remain open with implementation and missing evidence; owners are mapped above. #1 and #21 remain product/release parents. No issue was closed by this reconciliation.

Close an issue as completed only when its criteria have evidence. Transfer every unmet criterion and evidence link to a named successor before closing as superseded. Retain failures and limitations. Original dependency history remains in GitHub; current execution sequencing is the queue above and [plan](implementation-plan.md#detailed-milestones).
