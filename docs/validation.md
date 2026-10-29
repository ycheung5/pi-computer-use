# Release validation

Release status: **not accepted**. Automated and passive fixture results are evidence for their stated paths, not proof that all applications, physical input, displays or user acceptance work. The [spec](spec.md) defines requirements; this page maps them to runnable checks and pending evidence.

## Reproduce automated checks

From a clean checkout with Node 22.19+ and npm:

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm run test:package
npm run test:parity -- /path/to/dsh-computer-use-win
```

`test:package` packs/extracts the actual distribution and verifies its required assets plus every local Markdown link/heading. `test:parity` reads the reference's advertised schemas without desktop calls, comparing all 25 declarations and supported parameter types, defaults, enums, required fields and array/numeric bounds. It does not compare prose or prove runtime behavior. Extra native signed-32-bit bounds on move_window X/Y are reported explicitly. The inspected reference baseline is 0.5.3 at commit `6fb642129595a6357588c70812974951db304662`.

On WSL2, serialize all live checks:

```sh
flock -w 120 /tmp/pi-cu-live-tests.lock npm run test:pi
```

`test:pi` creates a new tarball and installs it in a disposable consumer directory with development and peer packages omitted. It loads the result through the real Pi CLI using Pi's public offline faux provider. Normal agent turns execute only health/list_windows, reach settlement and shut down the worker; no paid model, physical input, clipboard mutation, normal browser profile or daily Pi settings are used. On WSL2 it also launches a native Windows Pi CLI with the private runtime. On Windows it exercises that host alone. It verifies host-provided packages resolve without being bundled in the consumer package. `PI_CU_RELEASE_OUTPUT` can name a directory for sanitized JSON evidence; raw desktop window titles are not retained.

This runner uses the installed development Pi 1.4.0 distribution as the test host, not a fresh OS/Windows Pi install. Its scripted provider is a test fixture, never a production dependency. Real provider quality, interactive terminal workflows, and dedicated input/user acceptance remain separate checks.

## Capability coverage

All tool rows share schema comparison above and portable public tool/worker tests. Live runners use disposable windows/profiles and must finish cleanup before another starts. Paths below are commands or fixture names, not claims that a manual case passed.

| Tool | Portable tests | Live evidence / additional acceptance |
| --- | --- | --- |
| health | worker, extension, runtime | `test:native`, `test:wsl`, `test:pi`; cold download/clean-OS acceptance separate |
| list_windows | windows, ownership | `test:native:windows`, `test:wsl`, `test:pi`; HWND/PID, ambiguity, stale windows |
| snapshot | accessibility, capture | `test:native:accessibility`, `test:native:capture`; mixed DPI pending |
| accessibility_tree | accessibility, browser | `test:native:accessibility`, `test:native:chromium`, `test:browser`; truncated/hung providers |
| find | accessibility, ocr, browser | `test:native:accessibility`, `test:native:ocr`, `test:browser`; sparse OCR fallback and stale identity |
| element_info | accessibility, browser | `test:native:accessibility`, `test:browser`; IDs/coordinates, owner and password protection |
| screenshot | capture, browser | `test:native:capture`, `test:browser`; WGC/blank/minimized/occlusion; display changes pending |
| ocr | ocr | `test:native:ocr`; literal/CJK query and bounds; missing languages/protected content pending |
| click | pointer, browser-actions | `test:native:pointer:guards`, `test:browser:actions`; physical runner/manual checklist pending |
| double_click | pointer, browser-actions | Same pointer/browser runners; physical effect pending |
| move | pointer, browser-actions | Same pointer/browser runners; physical hover/restoration pending |
| drag | pointer | Dedicated physical runner only for real effects; bounds/identity/refusal tests are not drag acceptance |
| scroll | controls, pointer, browser-actions | `test:native:controls`, `test:browser:actions`; physical fallback pending |
| type_text | text, browser-actions | `test:native:text`, `test:native:notepad:unicode`, `test:native:clipboard:ole`, `test:browser:actions`; broader clipboard/physical runner pending |
| keypress | text, browser-actions | `test:native:text`, `test:browser:actions`; real chords, release and Esc interaction pending |
| focus | controls, browser-actions | `test:native:controls`, `test:browser:actions`; diverse UIA provider behavior pending |
| invoke | controls, pointer, browser-actions | Same controls/browser/guard runners; expand/collapse and physical fallback acceptance pending |
| set_value | controls, text, browser-actions | Background fixture controls and browser actions; explicit fallback/input acceptance pending |
| launch_app | window-management | `test:native:management`; Shell lifetime, restricted interpreter args, target handling |
| activate_window | window-management, browser-actions | `test:native:management`; OS foreground refusal is explicit, not guaranteed activation |
| move_window | window-management | `test:native:management`; actual multi-monitor layouts pending |
| close_window | window-management, browser-actions | `test:native:management`, `test:browser:actions`; veto/dialog/new target identity |
| wait | waits, worker | `test:native:waits`; bounded delay and abort |
| wait_for | waits, browser-actions | `test:native:waits`, `test:browser:actions`; observed vs incomplete/timeout outcomes |
| tools | settings, extension | `test:settings`, real Pi host; full/lite/lazy/custom and execution-time denial |

Portable file names above refer to the corresponding `.test.ts` suites. Tests assert public behavior, not private code structure. The schema inventory supplements rather than replaces action-specific success/failure tests.

Cross-cutting live runners: `test:ownership` (two-host ownership and crash recovery), `test:stop` (independent explicit stopping and worker cleanup), `test:settings` (personal-file consistency and management), `test:indicators` (native presentation protocol/offscreen checks), `test:browser:profiles` (cookie/profile lifecycle and locks), and `test:browser:firefox:endpoint` (experimental external Firefox ownership). Follow their relevant indexed guide for browser executable selection, headless flags and limits. Stock Firefox forks/ESR and arbitrary UIA providers are not universally validated.

## Reference benchmark

Run on the same interactive machine under the same serialized live-test discipline. From WSL2, the configured command relays to the package-managed Windows Node and translates paths; from Windows it uses the invoking Node executable:

```sh
npm run benchmark:reference -- C:\path\to\dsh-computer-use-win 3
```

For WSL2 use a Linux reference path and prefix with `flock -w 180 /tmp/pi-cu-live-tests.lock`.

The benchmark creates its own non-activating native Edit fixture. It compares reference Node/MCP/PowerShell calls with this package's Windows worker using the **same Windows Node executable** and alternating engine order. It measures process-cold health, process-cold native-ready find, warm find, background value dispatch, and a find → set_value → read-and-verify workflow. `fallbackType: false` prevents physical typing fallback; the fixture never requires clipboard input. Full browser/physical/model-driven workflows are outside this benchmark.

Both engines receive an untimed warmup before measured new-process samples. Runtime downloads, helper file compilation caches and OS caches are therefore warm; process-cold means a new controller process, not installation-cold or clean OS. Health payloads differ, so health timing alone is not an equivalent-feature comparison. Native-ready and verified-workflow timings compare useful equivalent effects. Pi model/agent overhead is excluded. JSON includes versions, OS/CPU, artifact hashes, individual samples, aggregates and methodology. Use at least three repetitions; no statistical significance is claimed from three samples. Set `PI_CU_RELEASE_OUTPUT` for `benchmark.json`.

## Dedicated physical-input runners

These runners require **Windows Node on a dedicated interactive test desktop**. A WSL `npm` command normally runs Linux Node and is not the right entry point. Build the checkout and call the health tool once to provision the verified private runtime. Then open Windows PowerShell on the dedicated desktop, change to the built checkout, read the runner sources, and use the tested Windows x64 runtime:

```powershell
$piCuRuntime = Join-Path $env:LOCALAPPDATA 'pi-computer-use\runtime\node-22.23.4-win-x64\node.exe'
$env:PI_CU_DEDICATED_INPUT_DESKTOP = '1'
try {
    & $piCuRuntime .\tests\native-pointer-physical.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Pointer checks failed; stop and inspect the output.' }
    & $piCuRuntime .\tests\native-text-physical.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Text/clipboard checks failed; inspect the output.' }
} finally {
    Remove-Item Env:PI_CU_DEDICATED_INPUT_DESKTOP
}
```

This path matches the tested runtime pin in this release; use the package's verified runtime if that pin changes. These commands send real input and the text runner replaces clipboard contents temporarily. They have **not** been run on the ordinary user desktop. Record their output alongside the remaining manual checks below; passing scripted cases alone is not full acceptance.

## Manual release gates

These remain **pending until a named person records the environment, steps, expected/actual results and evidence**. The user planned to perform acceptance testing.

- [ ] Clean Windows Pi installation outside this WSL job, and clean WSL2 Ubuntu installation, with no dev dependency tree or separately installed Windows Node; record install/update/removal and missing/corrupt runtime/network diagnostics.
- [ ] Dedicated interactive desktop: run `test:native:pointer:physical` and `test:native:text:physical` with `PI_CU_DEDICATED_INPUT_DESKTOP=1`. The latter mutates the disposable desktop's clipboard; never run against ordinary user work.
- [ ] Repeat input at 100%, 150%, 200% scaling, negative-origin monitors and changed primary/layout. Check screenshots/OCR coordinate accuracy and restoration.
- [ ] Real Esc and extra shortcut while input/UIA is busy; release held keys/buttons, prevent same-operation retries, and recover only on new user input. Repeat with both indicators disabled.
- [ ] Pointer/focus/user-copy interference, same-process windows and menus/dialogs; confirm automation respects intervening user actions. Check cross-application drag destinations and target replacement.
- [ ] Rich clipboard formats, locked/delayed/unsupported clipboard content, history/cloud exclusion and password protection. Synthetic protocol tests cannot establish these physical effects.
- [ ] Human visual indicator lifetime, large cursor, screenshot exclusion, monitor changes and remote/screen-sharing/recording visibility. Confirm actual Chromium border/page cues; API success is not visual acceptance.
- [ ] Interactive sign-in in dedicated kept profiles and clear-profile workflow; daily profiles remain untouched. Cookie fixtures are not human login-flow proof.
- [ ] Missing OCR languages, protected/elevated windows and unsupported provider behavior report limitations honestly.
- [ ] Complete broader visible-browser foreground preservation acceptance, including native dialogs and user interference. The focused nonmodal check below passed; it does not establish every visible workflow.
- [ ] Record representative user workflows and benchmark regressions, then user acceptance. No overall release/parity completion claim until unresolved gates are addressed or explicitly accepted.

## Review trace and evidence

Independent review at integration `3771e77` separated Standards and Spec axes. Standards found no hard rule breaches and two judgement calls (duplicate guarded-input lifecycle and obsolete optional native-source handling). Spec found user-interference restoration and browser key-alias gaps. Root additionally identified popup targeting/drag activation parity cases. Corrective work landed in `5fd9d12` and `29a8a13`, merged as `a7ae50f`. Independent re-review of that candidate reported **Standards: zero unresolved findings; Spec: zero unresolved findings**. Physical restoration/drag acceptance remains pending even after passive fixes and clean reviews.

Initial production preflight at `b988e86` passed real Pi CLI health/list execution and cleanup on both hosts using a production omit-peer install. Updated checked-in runners must be rerun against the final corrected integration before release. See the generated sanitized reports for exact versions/timings rather than promoting historical successful runs into current full-parity evidence.

Validation slice evidence on 2026-10-29, before the corrective branch: `npm run check` passed 42 portable tests plus type/lint checks; the package link regression went from 19 missing links to passing; reference declarations matched all 25 tools and supported parameter fields, with only reported additional signed-32-bit movement bounds. The checked-in real Pi CLI runner passed its production omit-peer package from both WSL2 and native Windows processes, including settlement and confirmed worker exit. These checks use Pi 1.4.0, Windows Node 22.23.4, Windows 11 x64 and WSL2 Ubuntu.

The three-sample same-machine background benchmark produced these means (milliseconds):

| Measurement | Reference 0.5.3 | Pi 0.1.0 |
| --- | ---: | ---: |
| Process-cold health | 2141.68 | 390.52 |
| Process-cold native-ready find | 2752.56 | 1064.14 |
| Warm find | 183.16 | 25.28 |
| Background set_value dispatch | 146.97 | 11.14 |
| Find → set_value → observed value | 349.86 | 28.51 |

Environment: same private Node executable and AMD Ryzen 9 7940HS/Windows build 26200; alternating engine order, warm compilation/runtime caches. These numbers support only the benchmarked background-edit path; they are not whole-product speedups, installation-cold measurements or physical/browser/model-driven workflow evidence. Rerun the checked-in harness after corrective changes rather than extrapolating these samples.

Seventeen serialized passive suites also passed on this validation slice: native health/windows/accessibility/capture/OCR/controls/waits/window-management/pointer-guards/text, cross-host ownership/stopping/settings/offscreen indicators, and headless Edge reads/actions/profiles. These are the named configured runners in the coverage map; Chromium/Firefox cross-browser results from their feature slices remain documented in [browser validation](browser.md), and must be rechecked where corrective changes affect them.

## Corrected-candidate rechecks

Against `a7ae50f` on 2026-10-29, configured type/lint checks and 42 portable tests passed, the production package's 83 entries had no broken documentation links, and schema comparison still matched all 25 reference tools/parameters. Real Pi CLI loading and health/list execution passed again from both WSL2 and native Windows processes with dev/peer dependencies omitted, empty stderr, final settlement and confirmed worker exit. This remains a clean package install on the existing machine, not a clean-OS or physical acceptance claim.

Representative Firefox 144.0 read/actions and external-endpoint preservation passed using the official unmodified executable staged on the Windows local filesystem. A previous attempt to spawn its UNC-extracted executable failed before browser actions; it was not accepted as a product result. Shared Chromium-only cue assertions were corrected in the action fixture so Firefox's documented lack of cues is tested rather than dereferenced as an assumed Chromium capability. Full Firefox actions, including the restored key aliases, and external process/tab preservation then passed.

Targeted corrected native controls, same-process popup guards, background text and window management passed without physical input or clipboard mutation. These checks supplement the earlier passive batch; the entire batch was not repeated without a new concern.

Corrected headless Edge actions also passed. Because shared activation/restoration code changed the timed path, the same three-sample benchmark was rerun: reference/Pi means were health **2233.11/389.47 ms**, native-ready **2860.27/1028.12 ms**, warm find **205.20/25.53 ms**, direct background dispatch **151.65/12.55 ms**, and verified workflow **355.06/28.65 ms**. The methodology and limitations above are unchanged; no broad performance or physical-workflow claim follows from these fixture samples.

### Focused visible foreground diagnosis

Run `npm run test:browser:foreground` with Windows Node after building, serialized with other live fixtures. It starts an isolated visible Edge profile and samples foreground HWND/PID/process plus last-input tick before opening, after opening/reading/value-setting/nonmodal click, after settlement and after disposal. PowerShell probe windows are hidden and their unused stdin is closed; probe PIDs are included to expose console contamination. No native dialogs, physical input, clipboard actions or daily profiles are involved.

The corrected candidate retained the **same original foreground HWND/PID and last-input tick through every sampled stage**; the owned browser PID and each probe PID were different. Classification: `preserved`. The previous broad visible fixture's HWND change was not reproduced in this controlled case. Its earlier cause is not proven to be a product defect, a probe console or user/native-dialog interference; do not infer a general cause from the focused pass. Human visual cues, dialogs and broader visible foreground acceptance remain manual gates.

## Notepad Unicode acceptance regression

On 2026-10-29, explicit `sendinput` typing reproduced corrupted text in installed modern Notepad while a standard WinForms editor received the same string correctly. The opt-in [Notepad regression](text.md#notepad-unicode-regression) failed on the original source, then passed with cancellable 10 ms pacing for the exact acceptance string and a longer ASCII/CJK/accent/emoji sequence. UIA values and independently saved test-file bytes agreed. Only uniquely named temporary test tabs/files were edited, saved and closed; the clipboard and existing documents were untouched. This is targeted worker-interface evidence, not a completed Pi-session retest or proof that automatic activation, physical Esc, clipboard restoration and all other physical-input paths pass.

Follow-up on 2026-10-29: the Pi-session append test disproved the sufficiency of 10 ms pacing: characters were corrupted and a leading LF was dropped. The expanded installed-Notepad regression reproduces that seeded append failure on the prior source. Enter/Tab mapping, acceptance of whitespace-only input, and cancellable 50 ms spacing replace the earlier workaround. The regression now includes whitespace-only strings, seeded append, mixed Unicode, and LF/CR/CRLF/Tab cases and checks the actual helper delay in its result. All six expanded cases passed three consecutive runs (18 case checks), including comparisons against saved bytes; portable tests and existing native text/stop-control checks also passed. This remains a compatibility workaround requiring Pi-session acceptance, not proof of universal input correctness.

## OLE clipboard acceptance regression

On 2026-10-29, an ordinary Unicode-text OLE clipboard reproduced `CLIPBOARD_SNAPSHOT_UNSUPPORTED` because the helper rejected OLE transport markers without examining the public FORMATETC descriptors. A synthetic OLE clipboard through the normal worker reproduced the same failure. The corrected helper validates public OLE formats, excludes process-bound transport markers, and duplicates all preservable native payloads. The regression also exposed sequence changes during format synthesis that previously caused restoration to be skipped; hidden-owner plus transaction-nonce checks distinguish that case from a genuinely newer copy. The opt-in [OLE clipboard regression](text.md#ole-clipboard-regression) passed actual paste, Unicode/HTML/binary preservation, indexed-format refusal before input, and synthetic newer-copy preservation. This remains worker-fixture evidence pending the user's Pi clipboard-preservation retest.
