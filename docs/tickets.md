# Implementation tickets

## Current investigation and acceptance work

Parent: [spec #23](https://github.com/ycheung5/pi-computer-use/issues/23). The approved first wave establishes reproducible evidence; targeted production repair tickets follow the findings in #37. Open tickets use their recorded triage labels (`ready-for-agent` or `needs-info`); only work whose blockers are complete can start. Baseline completion does not turn failed product outcomes into passing acceptance.

GitHub supports native dependencies, but the connected tools expose no dependency-write operation and GitHub CLI is unavailable here. Ticket bodies therefore record explicit blocking issue links; native dependency links have not been created. No parent issue was modified.

Current progress (2026-10-30): #24, #25, #29, #32, #33 and #34 have completed their audit or automated/passive comparison scopes (6 of 14 tickets). #28 and #31 retain partial evidence and open acceptance gates; paired native element scroll now passes on both engines but differs in distance, and a provider-unavailable probe records Pi partial evidence while reference propagation remains blocked. #26, #27 and #30 now have a first authorized physical baseline: Pi Unicode and corrected pointer cases passed, and paired Pi/DSH window-management fixtures passed eight scoped cases; virtual-file indexed coverage found Pi safe refusal/preservation and DSH loss after dispatch; reference failures are retained. Follow-up one-variable Unicode probes found that removing Pi pacing corrupted one controlled case, while either DSH key-up or batch-size changes alone did not fix it; the exact cause and minimum delay remain unknown. Clipboard startup safely refused an unsupported original value; after the user supplied a plain-text sentinel, the custom indexed fixture failed its precondition; a standard virtual-file fixture exposed readable indexed bytes despite a failed predictive query and was compared on both engines. A separate newer-copy case passed Pi and failed DSH; both fixtures restored the sentinel. The reference scroll step calculation follows Windows wheel lines while Pi uses one step per notch, matching the observed distance difference. These tickets remain open for their outstanding criteria. #35/#36 real-agent tasks and #37 final diagnosis/repair breakdown remain pending their prerequisites. Comparison completion does not mean every product outcome passed: retained findings include schema/guidance gaps, foreground restoration, reference minimized capture, temporary profile cleanup and Firefox reconnect. No production repair or optimization was applied in this baseline cycle. See [validation evidence](validation.md).

Current run status (2026-10-30): the user authorized a dedicated idle desktop session after the initial deferral. The first scripted physical baseline has finished and desktop input is stopped. Keep unexecuted physical/manual criteria open; see [dedicated-session evidence](validation.md#dedicated-physical-comparison-evidence). Further live runs require an available dedicated idle session.

| Issue | Deliverable | Blocked by | Status |
| --- | --- | --- | --- |
| [#24](https://github.com/ycheung5/pi-computer-use/issues/24) | Establish the DSH baseline and deviation inventory | None | Done — comparison/audit scope |
| [#25](https://github.com/ycheung5/pi-computer-use/issues/25) | Run one reproducible DSH/Pi comparison end to end | #24 | Done — comparison/audit scope |
| [#26](https://github.com/ycheung5/pi-computer-use/issues/26) | Compare Unicode typing and multiline append | #25 | Partial — criteria remain |
| [#27](https://github.com/ycheung5/pi-computer-use/issues/27) | Compare clipboard entry and preservation | #25 | Partial — criteria remain |
| [#28](https://github.com/ycheung5/pi-computer-use/issues/28) | Compare accessibility targeting and waits | #25 | Partial — criteria remain |
| [#29](https://github.com/ycheung5/pi-computer-use/issues/29) | Compare screenshot, OCR and coordinate mapping | #25 | Done — comparison/audit scope |
| [#30](https://github.com/ycheung5/pi-computer-use/issues/30) | Compare window management and pointer workflows | #29 | Partial — criteria remain |
| [#31](https://github.com/ycheung5/pi-computer-use/issues/31) | Verify stopping, ownership and interrupted-operation cleanup | #25 | Partial — criteria remain |
| [#32](https://github.com/ycheung5/pi-computer-use/issues/32) | Compare browser form completion and delayed results | #25 | Done — comparison/audit scope |
| [#33](https://github.com/ycheung5/pi-computer-use/issues/33) | Compare browser navigation, dialogs, transfers and profiles | #32 | Done — comparison/audit scope |
| [#34](https://github.com/ycheung5/pi-computer-use/issues/34) | Verify the installed Pi experience on Windows and WSL2 | #24 | Done — comparison/audit scope |
| [#35](https://github.com/ycheung5/pi-computer-use/issues/35) | Measure real-agent native tasks and recovery | #26, #27, #28, #30, #31, #34 | Blocked — prerequisites |
| [#36](https://github.com/ycheung5/pi-computer-use/issues/36) | Measure real-agent browser and mixed workflows | #30, #33, #34 | Blocked — prerequisites |
| [#37](https://github.com/ycheung5/pi-computer-use/issues/37) | Diagnose baseline failures and define targeted repairs | #35, #36 | Blocked — prerequisites |

## Original issue disposition

Checklist audit after the dedicated physical session: completed subcriteria are checked on open GitHub issues where evidence supports them; compound criteria stay unchecked until all clauses are covered. No additional whole issue was closed from a partial pass. Requirements in #1/#23 and release gates in #21 remain unchanged.

Reconciled on 2026-10-30 against recorded implementation/fixture evidence through `7a7c0c5`; no new desktop tests were run. Original issues #2–#20 now contain evidence summaries and links to the current follow-up tickets. These dispositions concern their original implementation scope, not acceptance of the whole product.

| Disposition | Issues | Meaning |
| --- | --- | --- |
| Closed as completed | #3, #8, #14, #19 | Recorded evidence supports the original WSL2-launch, ownership, wait and settings criteria; paired comparison and broader acceptance remain in the new tickets. |
| Open, `needs-info` | #2, #4–#7, #9–#13, #15–#18, #20 | Implementation exists, but the issue body identifies missing evidence; current tickets own the next validation work. Do not restart these implementations. |
| Open, unchanged | #1, #21 | Original product and release gates retain their scope and existing labels. |

- Keep #1 as the original product parent and #21 as the release gate, including clean-install, physical/manual and compatibility obligations.
- Close an original implementation issue as completed only when its own criteria have evidence.
- Before closing an issue as superseded, transfer every unmet criterion and evidence link to a named successor; do not falsely mark the work completed.
- Retain issues with meaningful pending work, distinguishing completed implementation from missing validation rather than commissioning duplicate implementation.
- Revisit these dispositions if new comparisons demonstrate a regression. Closure of an original slice never exempts its behavior from current acceptance or repair.

| Original obligations | Current evidence owners |
| --- | --- |
| #2, #3 — package and hosts | #34 |
| #4, #5, #10, #14 — discovery, accessibility, controls and waits | #28; cancellation also #31 |
| #6, #7 — capture and OCR | #29 |
| #8, #9 — ownership and stop | #31 |
| #11, #13 — pointer and windows | #30 |
| #12 — text and clipboard | #26, #27 |
| #15, #16 — Chromium reads/actions | #32, #33 |
| #17, #18 — experimental Firefox and profiles | #33 |
| #19, #20 — settings and presentation | #34 |
| #1, #21 — product and release | #24, #35–#37 supply evidence; original gates remain |

## Original delivery graph

Parent: [spec #1](https://github.com/ycheung5/pi-computer-use/issues/1). Retained for traceability, not an instruction to restart initial implementation. Original blocking edges are preserved below.

| Issue | Deliverable | Blocked by |
| --- | --- | --- |
| [#2](https://github.com/ycheung5/pi-computer-use/issues/2) | Run a packaged Windows worker from native pi | None |
| [#3](https://github.com/ycheung5/pi-computer-use/issues/3) | Run the same worker from WSL2 pi | #2 |
| [#4](https://github.com/ycheung5/pi-computer-use/issues/4) | Discover and identify desktop windows | #2 |
| [#5](https://github.com/ycheung5/pi-computer-use/issues/5) | Read and locate accessible controls | #4 |
| [#6](https://github.com/ycheung5/pi-computer-use/issues/6) | Capture correctly mapped desktop images | #4 |
| [#7](https://github.com/ycheung5/pi-computer-use/issues/7) | Read screen text with OCR | #6 |
| [#8](https://github.com/ycheung5/pi-computer-use/issues/8) | Enforce desktop ownership across sessions | #3, #4 |
| [#9](https://github.com/ycheung5/pi-computer-use/issues/9) | Stop an operation independently of the worker | #8 |
| [#10](https://github.com/ycheung5/pi-computer-use/issues/10) | Operate accessible controls in the background | #5, #9 |
| [#11](https://github.com/ycheung5/pi-computer-use/issues/11) | Perform guarded pointer actions | #6, #9 |
| [#12](https://github.com/ycheung5/pi-computer-use/issues/12) | Enter text and key chords safely | #10, #11 |
| [#13](https://github.com/ycheung5/pi-computer-use/issues/13) | Launch and manage application windows | #4, #9 |
| [#14](https://github.com/ycheung5/pi-computer-use/issues/14) | Wait for observable desktop outcomes | #5, #7 |
| [#15](https://github.com/ycheung5/pi-computer-use/issues/15) | Browse isolated Chrome and Edge pages | #8 |
| [#16](https://github.com/ycheung5/pi-computer-use/issues/16) | Complete Chromium browser interactions | #15, #9 |
| [#17](https://github.com/ycheung5/pi-computer-use/issues/17) | Support experimental installed Firefox | #15, #9 |
| [#18](https://github.com/ycheung5/pi-computer-use/issues/18) | Remember dedicated browser sign-ins | #16, #17 |
| [#19](https://github.com/ycheung5/pi-computer-use/issues/19) | Configure personal settings and available tools | #8 |
| [#20](https://github.com/ycheung5/pi-computer-use/issues/20) | Show configurable control indicators | #9, #11, #19 |
| [#21](https://github.com/ycheung5/pi-computer-use/issues/21) | Validate parity and prepare the release | #7, #10, #11, #12, #13, #14, #16, #17, #18, #19, #20 |
