# Implementation tickets

Parent: [spec #1](https://github.com/ycheung5/pi-computer-use/issues/1). All tickets use `ready-for-agent`; execute only when their blockers are complete. The current connector has no native dependency-link operation, so issue bodies record explicit blocking links. The parent was not changed.

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
