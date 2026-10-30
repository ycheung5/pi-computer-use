# Implementation tickets

## Current investigation and acceptance work

Parent: [spec #23](https://github.com/ycheung5/pi-computer-use/issues/23). The approved first wave establishes reproducible evidence; targeted production repair tickets follow the findings in #37. All tickets use `ready-for-agent`, but only work whose blockers are complete can start. Baseline completion does not turn failed product outcomes into passing acceptance.

GitHub supports native dependencies, but the connected tools expose no dependency-write operation and GitHub CLI is unavailable here. Ticket bodies therefore record explicit blocking issue links; native dependency links have not been created. No parent issue was modified.

Current progress: #24 resolved on 2026-10-30 with published audit/checker commits `fd51aca` and `a905fde`; #25 and #34 are now in progress on isolated branches. The audit found five declaration differences and missing reference-plugin setup in the inspected DSH web profile. Those findings remain obligations; completing baseline discovery is not a parity pass. See [baseline evidence](validation.md#baseline-identity-and-schema-evidence).

| Issue | Deliverable | Blocked by |
| --- | --- | --- |
| [#24](https://github.com/ycheung5/pi-computer-use/issues/24) | Establish the DSH baseline and deviation inventory | None |
| [#25](https://github.com/ycheung5/pi-computer-use/issues/25) | Run one reproducible DSH/Pi comparison end to end | #24 |
| [#26](https://github.com/ycheung5/pi-computer-use/issues/26) | Compare Unicode typing and multiline append | #25 |
| [#27](https://github.com/ycheung5/pi-computer-use/issues/27) | Compare clipboard entry and preservation | #25 |
| [#28](https://github.com/ycheung5/pi-computer-use/issues/28) | Compare accessibility targeting and waits | #25 |
| [#29](https://github.com/ycheung5/pi-computer-use/issues/29) | Compare screenshot, OCR and coordinate mapping | #25 |
| [#30](https://github.com/ycheung5/pi-computer-use/issues/30) | Compare window management and pointer workflows | #29 |
| [#31](https://github.com/ycheung5/pi-computer-use/issues/31) | Verify stopping, ownership and interrupted-operation cleanup | #25 |
| [#32](https://github.com/ycheung5/pi-computer-use/issues/32) | Compare browser form completion and delayed results | #25 |
| [#33](https://github.com/ycheung5/pi-computer-use/issues/33) | Compare browser navigation, dialogs, transfers and profiles | #32 |
| [#34](https://github.com/ycheung5/pi-computer-use/issues/34) | Verify the installed Pi experience on Windows and WSL2 | #24 |
| [#35](https://github.com/ycheung5/pi-computer-use/issues/35) | Measure real-agent native tasks and recovery | #26, #27, #28, #30, #31, #34 |
| [#36](https://github.com/ycheung5/pi-computer-use/issues/36) | Measure real-agent browser and mixed workflows | #30, #33, #34 |
| [#37](https://github.com/ycheung5/pi-computer-use/issues/37) | Diagnose baseline failures and define targeted repairs | #35, #36 |

## Original issue disposition

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
