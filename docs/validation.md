# Release validation

Release status: **not accepted**. Automated and passive fixture results are evidence for their stated paths, not proof that all applications, physical input, displays or user acceptance work. The [spec](spec.md) defines requirements; this page maps them to runnable checks and pending evidence.

The next validation cycle follows the [current implementation phases](implementation-plan.md#detailed-milestones). The [alignment scenario catalog](#alignment-scenario-catalog) below is planned coverage, not additional passing evidence.

## Reproduce automated checks

From a clean checkout with Node 22.19+ and npm:

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm run test:package
npm run test:parity -- /path/to/dsh-computer-use-win
```

`test:package` packs/extracts the actual distribution and verifies its required assets plus every local Markdown link/heading. `test:parity` reads the reference's advertised schemas without desktop calls, comparing all 25 declarations and supported parameter types, defaults, enums, required fields, array/numeric/string bounds, patterns and additional-property restrictions. It does not compare prose or prove runtime behavior. Extra native signed-32-bit bounds on move_window X/Y are reported explicitly. The inspected reference baseline is 0.5.3 at commit `6fb642129595a6357588c70812974951db304662`.

On WSL2, serialize all live checks:

```sh
flock -w 120 /tmp/pi-cu-live-tests.lock npm run test:pi
```

`test:pi` creates a new tarball and installs it in a disposable consumer directory with development and peer packages omitted. It loads the result through the real Pi CLI using Pi's public offline faux provider. Normal agent turns execute only health/list_windows, reach settlement and shut down the worker; no paid model, physical input, clipboard mutation, normal browser profile or daily Pi settings are used. On WSL2 it also launches a native Windows Pi CLI with the private runtime. On Windows it exercises that host alone. It verifies host-provided packages resolve without being bundled in the consumer package. `PI_CU_RELEASE_OUTPUT` can name a directory for sanitized JSON evidence; raw desktop window titles are not retained.

This runner uses the installed development Pi 1.4.0 distribution as the test host, not a fresh OS/Windows Pi install. Its scripted provider is a test fixture, never a production dependency. Real provider quality, interactive terminal workflows, and dedicated input/user acceptance remain separate checks.

### Current host acceptance evidence

Ticket #34 was rechecked on 2026-10-30 from WSL2, using Pi **1.4.0**, Linux Node **22.20.0**, the private Windows Node **22.23.4**, and Windows build **26200.9711**. The validation worktree started at `a905fde`; production code remained unchanged from `7a7c0c5`. Windows fixture commands ran outside the subprocess-restricted development sandbox, serialized with the shared live-test lock. No physical input, clipboard mutation, live model request, daily settings change or normal browser-profile access was performed.

| Check | Observed result and scope |
| --- | --- |
| `npm run check` and build | Type checking, linting, all 42 portable tests and build passed. Existing public host/worker tests cover lazy startup, shutdown rejection, failed launch/recovery, runtime checksum rejection, preset transitions, invalid settings, disabled execution and queued saves; these are not clean-OS installation evidence. |
| `test:pi` | Production-only tarball installed with development/peer dependencies omitted. Real Pi CLI health/list turns passed from WSL2 and a native Windows process, reached `agent_settled`, produced empty stderr and left no worker process. The provider was the public scripted offline fixture, not GPT or OpenRouter. |
| `test:wsl` | Both WSL-filesystem and Windows-filesystem disposable copies passed with spaces, Unicode and quotes in their paths; worker reuse, shutdown, parent-exit cleanup, active cancellation and timeout cleanup were observed. See the fixture correction below. |
| `test:settings` | Native-write/WSL-read and WSL-write/native-read round trips passed with isolated settings; lazy startup, disabled execution, unrelated-tool preservation and visible malformed-file error passed. First environment lookup took 42 ms on this run. |
| `test:indicators` | Offscreen rendering/protocol checks passed: quiet startup, two reported monitors, configured shortcut, invalid-target quietness and stopping while indicators were disabled. Visible preview was not enabled. Actual shortcut presses and visual/display behavior remain pending. |
| Native capture fixture | Public Pi tool results contained correctly sized PNG image blocks and coordinate metadata. Snapshot-with-image, no-image and UIA-failure-with-image cases retained their correct error distinctions; native PrintWindow/WGC, covered/minimized fallback, pixels and wrong-owner checks passed. |

The native capture fixture initially failed before execution because Windows Node could not resolve `typebox` through this worktree's absolute Linux dependency symlink. It was rerun from the main checkout's Windows-readable dependency tree after verifying the capture runner, production source and assets were identical. This was a test-environment correction, not a package or production-code fix.

The first `test:wsl` run failed because its stale assertion expected `COMPUTER_USE_CANCELLED`, while the public client's abortable call surfaces the signal's `AbortError`. The fixture now checks that public result **and** independently reads the cooperating Windows peer's count of cancelled active requests; exactly one must have received cancellation. The corrected fixture passed both filesystem locations. The original failure is retained here; merely accepting any rejected promise would not establish active cancellation.

Remaining host acceptance is grouped into three sessions rather than another sequence of individual prompts:

1. **Clean installation:** native Windows and WSL2 environments without the development tree; install/update/removal and missing/corrupt runtime or network diagnostics. Current-host package and portable failure tests do not close this gate (#2, #21).
2. **Interactive Pi presentation:** actual terminal settings editor and reload, rendered images/errors and user-visible lifecycle. Automated CLI/provider and tool-result checks do not prove the full interactive experience; the remaining gate stays owned by #21 after the automated baseline in #34 completes.
3. **Dedicated desktop presentation/interference:** the [indicator checklist](indicators.md#manual-acceptance-checklist), physical shortcuts, pointer/key cleanup, mixed DPI/display changes and screen-sharing/recording behavior. The user deferred physical-input tests; all such checks remain **not run**, not passing (#20, #21, #31).

This establishes the automated/passive host-validation baseline and records its gaps. It does not establish clean-machine readiness, physical-input acceptance, real-model reasoning quality or overall release acceptance. Real-agent tasks remain in #35/#36; DSH setup prerequisites are recorded in the [baseline identity audit](#baseline-identity-and-schema-evidence).

### Passive operation evidence

Ticket #31 was investigated on 2026-10-30 from WSL2 at integration base `4514b5d`, using the same Pi/Node/Windows versions recorded above. Production source and assets were unchanged. Windows checks ran outside the restricted subprocess sandbox under `flock -w 120 /tmp/pi-cu-live-tests.lock`. No key/button injection, clipboard mutation, physical-input opt-in or daily document interaction occurred.

| Evidence | Result and limit |
| --- | --- |
| Public Pi/worker portable suites | Busy protocol-peer stopping, queued cancellation, operation identity across turns/custom continuations, settlement, Pi abort, blocked retries, new-user recovery, process retirement and sticky cleanup failure passed. Peer dispatch counts show queued work was not sent; process-existence checks establish retirement. This is protocol evidence, not a blocked native UIA provider or physical-input run. |
| Timeout non-replay regression | The external peer now journals received actions across replacement processes. Exactly `uncertain-action`, then the caller's explicit `health`, were received by distinct PIDs; the old PID had exited. Previously this test asserted rejection and recovery without independently observing non-replay. The action is a disposable protocol operation, not desktop input. |
| `test:stop` | Three fresh enhanced runs passed. Independent PowerShell processes opened the actual Windows event and observed unsignaled before stop, signaled afterward, then a distinct unsignaled event for a fresh operation. Same-operation calls were blocked and the next operation recovered. The deliberately invalid HWND/PID click was source-checked to fail identity resolution before dispatch and returned `TARGET_IDENTITY_CHANGED`; it is no evidence of successful clicking or held-button cleanup. |
| `test:ownership` | Three fresh runs passed using registered Pi tools in separate WSL/native Windows hosts. Competitors were rejected, low-level `agent_end` retained ownership, settlement handed off ownership, a live owner was not displaced during the fixture's one-second observation, and killing its worker allowed recovery. This bounded observation plus the OS-mutex implementation is not a long-duration soak test. |
| `test:native:waits` with private Windows Node | The existing passive fixture passed window/control transitions, complete timeout versus incomplete absence, OCR transitions, cancellation and subsequent new-operation recovery/window disappearance. It sent no physical input. |

Reference comparison is source-based for this scope, **not a live DSH host cancellation comparison**. Pinned reference `mcp/server.mjs` (`dispatchNextBackend`, `cancelBackendRequest`, `dispatchBackend`) also serializes before starting execution deadlines, discards unsent cancelled work, distinguishes interruptible quiet reads from actions needing cleanup, and retires a timed-out backend. Its `mcp/activity.mjs` keeps conversation/turn ownership in the DSH host, releases at `turn/end` and has a 30-second idle fallback; `mcp/takeover.mjs` tracks stopped series and resumes for a new user turn. Pi's settlement/operation identifiers and Windows named mutex are the required Pi/WSL host adaptation, not an assertion that these lifetimes are identical. The cached DSH SDK has no per-session abort API; killing its process would not prove the normal DSH stop-button path.

**Still open in #31:** a genuinely blocked native UIA/input operation, actual held-key/button release and bounded cleanup during input, real Esc/custom shortcut while busy, and user-interference/restoration checks. The user explicitly deferred the dedicated physical session. Earlier manual reports remain historical observations; the current automated results do not close these criteria. Continue the short dedicated session when available rather than repeating passive checks or marking all stopping/ownership acceptance complete. No production repair or new mechanism is justified by this passive run alone; newly diagnosed product gaps belong to #37.

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


## Reference difference register

The 2026-10-30 source/declaration audit below records confirmed differences and remaining runtime investigations. It is not full behavioral parity. The cached DSH host is identified, but the inspected web profile has no configured computer-use extension; the remaining setup disposition is explicit below. Source locations are relative to their respective checkouts; reference locations refer to the pinned commit.

| ID | Starting difference | Initial disposition | Scenarios |
| --- | --- | --- | --- |
| D01 | DSH adapter/MCP server versus Pi extension/launcher/worker | Required adaptation: compare DSH `mcp/dsh-plugin.mjs` bridge with Pi `src/extension.ts`, `src/launcher.ts`, `src/worker.ts`; preserve operation lifecycle, stop and ownership contracts | C01, C09, C10; #31, #34 |
| D02 | Action-specific compact MCP descriptions versus shared generic Pi descriptions | Confirmed guidance gap: DSH `mcp/server.mjs` conciseDescriptions/compactSchema and `mcp/settings.mjs` routing; Pi `src/extension.ts` registration loops. Audit actual declarations, not only long source descriptions; no runtime repair yet | C00, A01–A06; #35, #36 |
| D03 | Pi per-unit 50 ms Unicode pacing, separate event calls and Enter/Tab mapping versus unpaced reference batching | Unverified deviation with demonstrated workaround: DSH `scripts/windows-uia.ps1` Unicode sender; Pi `assets/text.cs`; commits `4e4b061`, `dc95162`; successful cases do not isolate mechanism | C05; #26 |
| D04 | Pi public OLE format validation/ownership-nonce restoration changed after unsupported-snapshot failures | Unverified comparative behavior: Pi `assets/text.cs`, commit `b966475`; DSH clipboard type_text path in `scripts/windows-uia.ps1`. Worker regression proves scoped preservation, not all-format parity | C06; #27 |
| D05 | Foreground activation, lock diagnostics and restoration | Missing BringWindowToTop was aligned in `7a7c0c5`; locked-session diagnosis added in `89b0d80`. Reference also uses an Alt fallback; Pi `assets/window-management.cs` does not. Necessity/outcomes need paired evidence, not immediate removal of guards | C03, C07; #30 |
| D06 | Explicit existing-app/tab reuse guidance | User-requested behavior in Pi `src/extension.ts`, commit `f4d6473`. Reference launch and browser routing permit reuse but do not provide equivalent general native-tab instructions; retain provisionally and test preserved work | A01, A03; #35, #36 |
| D07 | Launch string bounds and health additionalProperties are absent from Pi declarations | Confirmed declaration gaps: DSH `mcp/server.mjs` versus Pi `src/window-management.ts`/health registration. Four launch string constraints and one health object restriction now fail the comparator; production behavior unchanged | C00, C03; #24 baseline, #37 repair triage |
| D08 | Pi browser library/Windows helper implementation differs from reference direct CDP/PowerShell | Implementation choice, not demonstrated improvement: compare public page-change, fallback, profile, capture and failure semantics using existing capability mapping; source similarity is not the acceptance criterion | C02, C08, C11–C13; #28, #29, #32, #33 |


### Baseline identity and schema evidence

On 2026-10-30 the local reference checkout reported version **0.5.3**, commit **6fb642129595a6357588c70812974951db304662**. Pi audit base was **19bc425** (production code through **7a7c0c5**), package **0.1.0**. The controller ran Node **22.20.0** on genuine WSL2, kernel **6.18.54.1-microsoft-standard-WSL2**. This pins the inspected source, not the user's installed DSH host.

**Installed/cached host and selected profile:** the user supplied `npx @deepseek-ai/dsh web`. Read-only inspection found one matching existing npm execution-cache package, **@deepseek-ai/dsh 0.2.1-rc.2**, with base, web-app and MCP-client packages also **0.2.1-rc.2**. The cached CLI maps `web` to the web profile. The inspected shell has no DSH_HOME override; the default WSL web profile declares base/web bundles, empty plugin dependencies and an empty root tree. Neither its patch nor the inspected bundle patches references computer-use, wincu or windows-uia. The cached dependency tree contains no dsh-computer-use-win package.

This identifies the installed cached host but **not an installed reference extension**: the pinned source checkout is not configured in the inspected default web profile. The user's DSH host installation and computer-use plugin installation are separate prerequisites. Real-agent DSH comparison needs the reference plugin configured and its loaded revision verified before execution. The unpinned `npx` command could resolve another version on a later invocation, so record the actual host/extension version when running; do not silently fetch a newer baseline. No DSH process was launched, no package downloaded, and no credential or session contents were read. Earlier Windows StartApps/uninstall/process probes were negative because the supplied launch method uses WSL's npm cache, not an identified Windows Desktop installation.

Read-only inspection of that cached host found supported headless JSON and SDK JSON-RPC profiles, with a disposable `DSH_HOME` for isolation. Its SDK provides prompt/wait/events/shutdown but no per-session abort; process termination must not be reported as the normal web stop action. Headless JSON can truncate nonfinal events, so full tool evidence needs SDK events or persisted logs. These are available interfaces, not completed host/model tests.

The unchanged reference adapter uses its host's `process.execPath` and temporary/script paths without WSL translation. Loading it directly into Linux DSH is therefore not an established Windows backend setup. Before #35/#36, preflight a pinned isolated Windows-host composition or explicitly document a WSL-to-Windows MCP adaptation; the latter does not automatically preserve the reference adapter's settings/activity hooks. Verify module loading, tool discovery and health before any model task. This prerequisite does not block standalone Windows reference-backend comparisons through the agreed MCP seam.

The earlier `Reference exited 0` result was reproduced under the development sandbox. A minimal child-process probe also failed with `EPERM`/empty child output; the identical original schema command outside that sandbox passed all its checked fields. The server itself initializes normally. Therefore this exit is an environment restriction, not a reason to change Windows automation or reference startup. Use the environment's approved execution mechanism for subprocess checks; do not bake a sandbox bypass into the package.

A separate read-only capture of public MCP `initialize`/`tools/list` and Pi registered definitions found restrictions the old comparator omitted. The strengthened `test:parity` now emits a structured report before failing and checks string bounds, patterns and additional-property restrictions. On the same unsandboxed WSL invocation it returns **exit 1 with a valid comparison**, not a transport failure:

| Declaration | Reference | Pi declaration |
| --- | --- | --- |
| `launch_app.target` | `minLength: 1`, `maxLength: 32767` | Neither advertised |
| `launch_app.arguments` | `maxLength: 32767` | Not advertised |
| `launch_app.workingDirectory` | `maxLength: 32767` | Not advertised |
| `health` object | `additionalProperties: false` | Unspecified |

All **25 names** are present; the five restriction mismatches above are retained for repair triage. The previously documented four extra signed-32-bit bounds on move_window coordinates remain explicitly reported. The audit does not establish that runtime validation is identical or defective in the same way as the declarations. Historical schema passes below remain evidence only for the fields their comparator checked; they are not current full-restriction passes.

### Model-visible guidance inventory

The reference sends **compact action-specific descriptions and compact parameter guidance** through `tools/list`, with full descriptions available through management describe; its long source strings are not all sent on every turn. Pi often uses longer but generic shared descriptions. Word count is not the gap: missing action semantics are. Both systems also supply browser-first guidance and distinguish dispatch from verification. Pi's same-target and non-replay safeguards must remain intact during later guidance alignment.

| Tool | Reference guidance to preserve or compare | Pi baseline finding / follow-up |
| --- | --- | --- |
| health | Backend availability | Pi describes worker connectivity; do not imply full capability health; C01 |
| snapshot | Combined tree/image, partial evidence and sparse OCR | Generic observation description omits combined behavior/browser viewport; C02 |
| accessibility_tree | Bounded tree, incomplete absence, browser outline | Generic observation description omits browser outline semantics; C02 |
| list_windows | Native identity and browser-tab discovery | Native identity described; browser discovery supplied in shared guidelines; C02/C11 |
| find | Sparse-search OCR and screen coordinates versus IDs | Generic description loses this action-specific distinction; C02/C08 |
| element_info | ID or physical screen point inspection | Generic description lacks point lookup distinction; C02 |
| click | Element/background versus physical point, restoration and unverified background delivery | Shared browser-action description omits dispatch distinctions; C07/C11 |
| double_click | Element or screen point, background unverified | Shared browser-action description omits dispatch distinctions; C07 |
| move | Pointer movement to element/screen point | Shared description does not explain hover behavior; C07 |
| drag | Physical screen path and foreground use | Pi pointer guard description omits path meaning; C07 |
| scroll | Background-first element scroll, positive deltaY down | Shared description omits direction/routing; C04/C07 |
| type_text | Current focus, auto background edit/clipboard routing and restoration | Shared description and absent focusMode prose lose method distinctions; C05/C06 |
| keypress | Chord example, Windows-key restriction and background printable-character limit | Shared description omits these limits; C05 |
| focus | UIA keyboard focus | Shared description lacks action-specific focus meaning; C04 |
| invoke | Supported patterns, optional click fallback, expand/collapse/scroll actions | Shared description lacks action selection/fallback semantics; C04 |
| set_value | Background value/fallback; page fill and address/new-tab navigation | Dedicated Pi promptGuidelines restore browser routing, but shared description lacks native method detail; C04/C11 |
| activate_window | Always activates; shared flag cannot suppress | Shared description omits unconditional behavior; C03 |
| wait | Delay then observe | Pi describes explicit waiting; verify no objective-success claim; C09 |
| ocr | Literal matching, inspect lines on miss, screen word coordinates | Pi covers literal matching but fewer usage details; C08 |
| screenshot | No UIA; image-to-screen formula versus page pixels | Pi describes native capture metadata but not full coordinate distinction; C08 |
| wait_for | Observable conditions, partial absence inconclusive | Shared description loses wait semantics; C02/C11 |
| close_window | Background graceful close with possible save dialog | Shared description loses veto/dialog behavior; C03/C12 |
| move_window | Physical position, no resize, coordinate cache refresh | Pi generic management description lacks position-specific meaning; C03 |
| launch_app | Shell lifetime, interpreter restrictions, verify resulting window | Pi gives explicit reuse guidance; missing declared string bounds remain D07; C03 |
| tools | List/describe/enable/disable/reset and startup exposure | Compare full versus compact describe payload and preset behavior; C00/C10 |

The existing capability matrix and C00–C13/A01–A06 catalog map these entries to executable or missing checks. This inventory identifies what to investigate; it does not prescribe copying reference wording or prematurely modifying production guidance.

### Unicode mechanism investigation

The reference Unicode sender (`scripts/windows-uia.ps1`, lines 192–225 in the pinned checkout) batches up to 64 events without per-character sleeps. Pi's [text helper](../assets/text.cs) sends key events separately and waits 50 ms per UTF-16 unit/key pair; it also maps line endings and tabs to functional keys. The reference checkout is an external test prerequisite, not a packaged documentation dependency.

The existing Notepad regression (`tests/native-notepad-unicode.mjs` in the source checkout) and [text notes](text.md) provide useful success/failure evidence, but combined pacing and control-character changes do not isolate causation. The current delay assertion identifies an implementation, not the required outcome.

Use the same Notepad version, seed text, keyboard/IME state and focus conditions for DSH and Pi. Include blank insertion, seeded append with a leading newline, ASCII, Chinese, accented characters, emoji, CR/LF/CRLF, tabs and a longer mixed string. Independently compare exact accessible text and disposable saved-file bytes where supported, normalizing only documented line endings. Record elapsed time and actual dispatch method. During later diagnosis, vary batching, pacing and control-character handling independently; do not remove the workaround solely because DSH lacks it. The acceptance assertion is correct text and cleanup, not `inputDelayMs === 50`.

## Alignment scenario catalog

These IDs define the planned coverage groups. Expand each group into named cases in the existing test infrastructure; do not create a new test framework or a folder per scenario. Existing runner names below are starting points, not claims of completed paired coverage. The [release matrix](#capability-coverage) supplies tool-by-tool mapping.

| ID | Setup and cases | Independent expected outcome | Reuse |
| --- | --- | --- | --- |
| C00 | Enumerate all tools in matching presets; valid/invalid parameters, descriptions/defaults and disabled execution | Equivalent advertised capability and informative semantics; explicit denial for unavailable tools | `tests/parity-host.mjs`, extension/settings tests |
| C01 | Clean package, native Windows and WSL2 hosts; startup, reload, exit, missing assets | Tools load with default Pi; correct worker lifecycle and cleanup; useful startup errors | Package, Pi-host, runtime and WSL runners |
| C02 | Native and Chromium accessibility fixtures; complete/sparse/truncated/provider-error reads, stale IDs, positive and negative waits | Accurate identities and observed values; partial evidence is not conclusive absence; no wrong-target fallback | Accessibility, nullable-UIA, Chromium and wait runners |
| C03 | Owned windows, same-process distractor, moved/closed targets; launch, activate, move, close and veto dialog | Observe actual window identity, foreground and bounds independently; preserve distractor; accurate activation/refusal result | Window-management and activation runners |
| C04 | Native controls supporting focus, invoke, value, selection, expansion and scroll; unsupported patterns and disabled/read-only controls | Intended state transition once; correct fallback where supported; restrictions remain respected | Controls fixture and native-controls runner |
| C05 | Disposable Notepad documents and native Edit fixture, Unicode cases described above; chords and cancellation | Exact intended text and preserved prefix; released keys; no uncertain-input replay | Notepad-Unicode, native-text and text-physical runners |
| C06 | Seeded disposable clipboard: plain text, supported rich/OLE formats, unsupported/locked content and user-copy interference | Exact pasted text; pre-test clipboard restored where promised; newer user copy preserved; truthful failure/cleanup | OLE fixture, native-clipboard and text-physical runners |
| C07 | Pointer bench with visible counters, hover, drag/drop and inner scroll; occlusion, focus changes, stale targets | Exact counter changes, dropped state and released buttons; intended panel scroll; correct pointer/foreground restoration | Pointer physical/guard fixtures and activation runner |
| C08 | Capture/OCR fixture with known labels, cropped text, occlusion and mixed DPI/negative origins | Image-to-screen mapping correct; OCR limitations reported; capture fallback evidence accurate | Capture/OCR fixtures; manual display checks |
| C09 | Busy input/UIA, wait, competing host, cancellation, timeout and owner crash | Stop prevents further operation input; bounded cleanup; no replay; correct ownership recovery and new-operation behavior | Stop, ownership and wait runners; physical Esc check |
| C10 | Settings/presets, indicator options, Pi rendering, images and errors | Settings persist; tools denied correctly; presentation matches actual operation; no false verification claims | Settings, indicators and Pi-host runners; visual checks |
| C11 | Local browser form: fields, checkbox/select, delayed results, disabled/read-only controls, screenshot | Exact submitted values and independently observed page state; restrictions intact | Browser-actions server/host |
| C12 | Browser navigation, new/closed tabs, stale IDs, dialogs, uploads/downloads, disconnect and reconnect | Intended tab/document and files; no duplicate uncertain action; reference-supported recovery and truthful limitations | Browser actions/host and profile runners |
| C13 | Temporary and kept profiles, browser closure, external Firefox endpoint and native-dialog boundary | Isolation, ownership and cleanup preserved; no daily profile attachment; experimental scope retained | Browser profiles, Firefox endpoint and foreground runners |

Physical cases run serially on a dedicated interactive desktop. Passive fixtures do not substitute for physical-input outcomes. Run ordinary success cases before their injected-failure variants. Both Windows and WSL2 launch paths remain required; do not multiply every desktop-only case across hosts unless host differences can affect it.

### Accessibility comparison evidence

The paired public-interface collector is `benchmark:accessibility`; `test:accessibility:report` checks that it retains both engines' outcomes, independent fixture values and cleanup evidence even when the product comparison exits nonzero. `test:reference:transport` checks initialization, all 25 advertised tools and raw MCP error preservation without invoking desktop actions. These commands reuse the pinned reference MCP server and Pi's normal worker request interface; no new production API is exposed.

From WSL2 after building, use the existing serialized live-test discipline:

```sh
PI_CU_RELEASE_OUTPUT=/tmp/pi-cu-accessibility-evidence flock -w 120 /tmp/pi-cu-live-tests.lock npm run benchmark:accessibility -- /path/to/dsh-computer-use-win
```

`test:accessibility:diagnostics` runs the collector CLI without Windows interaction and verifies that assertion failures retain original action arguments/responses and that an interrupted case is recorded before dependent execution halts. Each live case now retains relevant public-interface observations before assertions. Discovery traces retain only owned fixture/browser windows plus total/omitted counts; unrelated desktop titles are excluded, including embedded MCP JSON.

The source/version/hash metadata and full JSON report are written to the selected output directory; a nonzero comparison means failures or incomplete coverage, not necessarily a transport failure. The separate report regression can pass while preserving a failing product comparison. Never turn its green result into a parity claim.

The 2026-10-30 run used Windows Node 22.23.4 from WSL2, reference 0.5.3 and Pi 0.1.0. It exercised owned native controls, a stable small Edit fixture, the existing newer-control-type provider, and an isolated installed Chromium page through native UIA. No keyboard, mouse or clipboard input was sent. Value-setting and invocation explicitly prohibited physical fallback; native scroll remained blocked because its public API has no no-fallback option. Fixture state, logical active child, actual foreground HWND/PID and last-input tick were observed independently over fixture IPC. Cleanup confirmed controller disposal, owned fixture exit and temporary-directory removal.

The final retained run collected **58 cases: 51 passed, five unexpected outcomes and two blocked native-scroll cases**, with controller/fixture/browser-root exit and directory cleanup confirmed. The product-comparison CLI correctly returned exit 1; the report-collection regression passed. Type checking, linting and all 42 portable tests passed. Artifacts were kept separately through collector/oracle corrections; the full target-bound report is `accessibility-comparison.json` under the chosen output directory. The WSL relay awaits stdout/stderr completion before exiting so the larger raw-observation report is not cut short; the public CLI regression caught the earlier truncated stream, whose complete Windows-written artifact was preserved.

The four reference unexpected outcomes were ambiguous-title selection, the zero-depth truncation flag, a negative element wait ending inconclusive after a complete empty pre-observation, and removed-element inspection returning partial cached metadata. Pi's unexpected outcome was foreground restoration after logical focus: with `activate: false`, the requested root HWND and returned `inputTargetHandle` matched the independent owned fixture root, yet the foreground moved from the prior application to that fixture with the same last-input tick. Pi reported `left: another window is in front`; the exact requested element was a `uia:rt` reference. This repeated observation is a diagnosis input, not proof of the guard's internal cause. The reference restored the original foreground in the same scenario. Logical active-child focus succeeded in both engines.

A subsequent owned-provider subset independently confirmed four fault/hang cases. The custom provider exposes one-shot Name-property modes, announces entry over fixture IPC, and has an independent release plus a 12-second automatic bound. Both engines entered the injected COM exception; Windows UIA normalized it rather than exposing an explicit provider error: reference returned a complete 10-node tree, while Pi returned 10 nodes with the existing unknown-type limitation. This tests an actual faulting provider, but does not prove the `UIA_PROVIDER_ERROR` payload path. Both blocked calls were still pending when aborted through the public request seam; the caller completed with reference `COMPUTER_USE_CANCELLED` in 327 ms and Pi's abort-reason rejection in 220 ms. These timings bound caller completion, not underlying blocked-reader termination: no reader-process death was independently observed before release. The fixture was then released independently before disposal, and subsequent cleanup was confirmed. These are passive cancellation tests, not physical Escape/input acceptance.

For only this subset, run `test:accessibility:report -- /path/to/reference --providers`. The initial 100 ms trial exhausted the reference traversal budget before reaching the custom provider (zero/two nodes), so its missing-entry timeout was a collector prerequisite failure. Its artifact was preserved; the entered-provider trial uses a 3000 ms traversal budget and separately asserts cancellation before the automatic release.

The current ticket remains open for deferred native scroll; an explicit error-metadata payload was not produced by this OS/provider combination. Comparison findings are triage inputs, not automatic instructions to change production behavior.

| Observation | Interpretation |
| --- | --- |
| Unique native discovery, trees/snapshots, find/info, Unicode background value, invoke counter, read-only/disabled preservation, unsupported-pattern denial, wrong-owner/unseen references, positive waits and native Chromium reads | Compare independently observed effects and result meaning; DSH `results` and Pi `matches` are normalized by the collector, not treated as a product failure. |
| Reference ambiguous title selection and zero-depth truncation flag differ from Pi | Retain the actual outcomes for #37; do not assume every stricter Pi behavior is necessarily preferable or blindly change it to the reference. |
| Reference removed-element inspection returns partial cached metadata where Pi rejects the reference | Record the stale-result semantics; the observation alone does not establish how a later input action would behave. |
| Reference negative element wait ends inconclusive after an earlier complete empty observation on an unchanged small fixture | The raw prior find and final wait are retained. A final short-budget poll is a source-level hypothesis; the test does not tune the timeout until the result turns green. Native-window absence supplies a separate deterministic negative wait case. |
| Unsupported control type normalizes differently | Both return ten nodes and retain the known surrounding controls. Reference reports a null type with no truncation; Pi reports `Unknown`, `controlTypeUnavailable` and one unknown type. This is a metadata/completeness trade-off, not demonstrated superiority of either implementation. |
| Logical focus versus foreground restoration | `Control.Focused` alone was an invalid oracle for a background action: it can become false when the original foreground is restored. The corrected oracle observes a changed `Form.ActiveControl` independently and records foreground/input state separately. |

One later target-bound run recorded a partial `taskkill` warning as unconfirmed browser cleanup. Read-only process inspection found the owned root/children gone. The collector now waits for the actual owned browser-root exit and directory removal, retaining any termination warning instead of equating the command exit code with process lifetime; controller cleanup uncertainty also prevents a confirmed aggregate result. The earlier failed cleanup record remains preserved.

Collector development failures were kept distinct from engine findings: the initial smoke emitted only a summary, then durable artifact collection was added; an unsupported `find.detailLevel` argument and an assumed identical `matches` field were corrected as test defects. An early reference-focus failure was retracted when the `Focused`-only oracle was corrected. Earlier logs/artifacts remain separate from the final baseline rather than being silently overwritten.

### Agent tasks

These are outcome briefs, not step-by-step tool scripts. Supply identical goals and disposable starting states to each host. Agent tests may re-observe, scroll, refresh stale references, handle fixture dialogs and choose supported alternative methods. Explicit method-specific diagnostic tests retain their method constraint.

| ID | Ordinary task brief | Controlled variant and pass criteria |
| --- | --- | --- |
| A01 | Use an existing Notepad window to create a separate test document, enter two multilingual lines, append a third and verify the result | Existing unrelated tabs and a distractor window; exact three-line result, existing content unchanged, no unnecessary new app instance |
| A02 | Complete the local form with supplied values, submit it and report the delayed confirmation | Control initially offscreen and delayed content; correct payload and confirmation, no unnecessary user help |
| A03 | Navigate between fixture pages and complete a second form in the intended browser context | Navigation invalidates IDs and opens a fixture dialog; fresh identification and correct dialog handling, no duplicate submission |
| A04 | Read a known label and operate its associated fixture control | Incomplete accessibility with supported visual/OCR alternative; correct intended result, or accurate limitation if evidence is insufficient; no unrelated target |
| A05 | Upload the disposable sample and download the resulting fixture file, verifying its expected content | Reference-supported file/native-dialog boundary; correct owned files and preserved unrelated windows/profile |
| A06 | Complete a disposable input task while cancellation or user focus interference is introduced | Cancellation variant must stop and clean up, not finish the task; interference variant follows reference behavior and preserves user changes |

A01–A05 require outcome success unless a limitation is explicitly accepted; an accurate blocker is useful evidence but not a completed task. A06 has intentionally different success criteria. Each required task/recovery scenario needs three consecutive successful reset runs on the accepted candidate; retain earlier failures in the record.

## Comparison and diagnosis

Two comparisons answer different questions:

1. **Tool comparison:** equivalent public calls, identical fixture state, independently observed effects. Compare meaning, not literal JSON, generated IDs or identical internal call sequences. Extend the existing paired benchmark (`tests/benchmark-reference.mjs` in the source checkout), which currently covers background native Edit behavior only. Reset between engines and alternate run order where practical.
2. **Agent comparison:** ordinary goals through real host/model sessions. Pi uses the user's GPT-6.1 Sol low-reasoning setup; DSH uses the available OpenRouter model because OpenAI access there is geographically restricted. Record the exact DSH model and both hosts' effective settings. These compare host/model combinations, not isolated model or extension superiority. Existing Pi faux-provider tests do not supply this evidence.

If an agent fails, retain its tool trace and reproduce the relevant calls against a reset fixture. A direct call failure points toward a tool, target or environment issue; a successful direct call does not alone prove a reasoning failure because timing and state may differ. Check tool descriptions, returned evidence, fixture state and model decisions before assigning cause. Mark unresolved attribution as unknown.

Do not build an elaborate new recovery controller. Investigate how the reference makes recovery possible through guidance, actionable results and supported internal fallbacks. Runner watchdogs bound hung tests; they do not impose a new production recovery policy.

## Execution and evidence

Automate preparation, reset, tool calls, independent assertions and reporting wherever possible. Investigate supported DSH/Pi host interfaces before promising unattended model runs. Human participation remains for genuine interference, physical stopping and visual/display checks; group these into short sessions instead of asking the user to paste every test prompt.

Every expanded case records:

- Scenario/case ID, purpose, reference contract and involved tools.
- Owned fixture setup/reset, expected outcome, allowed recovery, stop conditions and scoped cleanup.
- DSH/Pi source and installed versions, host, model/reasoning settings where relevant, enabled tools/instructions, OS/app/browser versions, display/input state and run order.
- Exact expected/actual state, tool outcomes, independent observations, timings, interventions, cleanup and relevant sanitized evidence.
- Result: pass, fail, blocked or not run; cause: implementation, agent decision/guidance, environment, test defect, shared limitation or unknown. Cause attribution requires supporting evidence.
- Fix/deviation decision, targeted rerun and affected regression results. Do not discard failed attempts to report only a final pass.

Continue independent cases after ordinary assertion failures once cleanup and reset are confirmed. If a stop occurs or cleanup/desktop ownership is uncertain, halt that physical run and report dependent cases blocked; never auto-resume stopped input merely to complete a batch. Preserve unrelated work. Do not reuse the reference Notepad E2E script's process-wide kill cleanup: target only owned disposable fixtures.

Reconcile historical manual reports with [validation evidence](#review-trace-and-evidence). Reuse unchanged, adequately identified evidence; rerun when changed code, missing environment details or an unresolved failure makes it insufficient. Three consecutive passes are a practical initial gate, not a statistical reliability guarantee.

## Reference benchmark

Run on the same interactive machine under the same serialized live-test discipline. From WSL2, the configured command relays to the package-managed Windows Node and translates paths; from Windows it uses the invoking Node executable:

```sh
npm run benchmark:reference -- C:\path\to\dsh-computer-use-win 3
```

For WSL2 use a Linux reference path and prefix with `flock -w 180 /tmp/pi-cu-live-tests.lock`.

The benchmark creates its own non-activating native Edit fixture. It compares reference Node/MCP/PowerShell calls with this package's Windows worker using the **same Windows Node executable** and alternating engine order. It measures process-cold health, process-cold native-ready find, warm find, background value dispatch, and a find → set_value → read-and-verify workflow. `fallbackType: false` prevents physical typing fallback; the fixture never requires clipboard input. Full browser/physical/model-driven workflows are outside this benchmark.

Both engines receive an untimed warmup before measured new-process samples. Runtime downloads, helper file compilation caches and OS caches are therefore warm; process-cold means a new controller process, not installation-cold or clean OS. Health payloads differ, so health timing alone is not an equivalent-feature comparison. Native-ready and verified-workflow timings compare useful equivalent effects. Pi model/agent overhead is excluded. JSON includes versions, OS/CPU, artifact hashes, individual samples, aggregates and methodology. Each measured case records status/cause separately, expected/actual text, independent reset evidence, timing and scoped cleanup. Failed attempts remain in `cases`; timing summaries include passing samples only. Use at least three repetitions; no statistical significance is claimed from three samples. Set `PI_CU_RELEASE_OUTPUT` for `benchmark.json`.

### Comparison report and failure collection

The fixture resets its own editor to the literal `initial` before and after each engine. Its UI thread independently returns the actual text over the owned fixture pipe, in addition to the engine's `element_info` readback. This prevents a tool response alone from proving the intended edit. Ordinary assertion failures are retained while later cases continue only after controller disposal and editor reset are confirmed. Cancellation/stopping or unconfirmed cleanup blocks remaining dependent cases. Final cleanup closes only the owned fixture and removes its temporary directory; this is not a claim that all product cleanup paths pass.

The CLI exits nonzero when a case, warmup or cleanup fails, but still emits its structured report, including through the WSL relay. Invalid invocation arguments remain immediate CLI errors. Run the passive reporting regression from WSL2 after building:

```sh
flock -w 120 /tmp/pi-cu-live-tests.lock npm run test:benchmark:report -- /path/to/dsh-computer-use-win
```

This regression runs the same public benchmark CLI with `--verify-failure-collection`. It deliberately changes the first verification expectation, labels that case `injected: true` and `cause: test-defect`, and asserts the benchmark exits 1 with the failed case retained, five later passing cases, reset text before every case, alternating engine order and confirmed fixture cleanup. The regression itself exits 0 only when that reporting behavior is correct. Do not count the injected mismatch as a DSH/Pi product defect or include it in ordinary comparison evidence. No physical input, clipboard mutation, daily profile access or production behavior is added by either command.

The separate stop regression substitutes one deliberate MCP `isError` response at the reference request seam, before the first measured health dispatch. Both warmups still use the real engines. It checks that all text blocks and the complete error result survive in the report, the owned editor remains `initial`, all five later cases are blocked without execution, and cleanup completes:

```sh
flock -w 120 /tmp/pi-cu-live-tests.lock npm run test:benchmark:stop -- /path/to/dsh-computer-use-win
```

This uses `--verify-stop-collection`, labels the failed case as injected/test-defect, and does not exercise a real emergency-stop mechanism. Its red run exposed the old generic `Reference health failed` assertion discarding cancellation evidence and continuing later cases; the corrected collector retains the MCP error and blocks them. Keep this deliberate failure separate from normal product outcomes.

On 2026-10-30 this regression failed against the old collector (`ok: true` concealed the requested diagnostic expectation) and passed after the reporting/reset extension. A normal three-repetition run against reference 0.5.3 and Pi 0.1.0 passed all six measured cases and both warmups on Windows Node 22.23.4 via WSL2. The independently observed values and resets matched, and controller/editor plus final fixture cleanup were confirmed. These are background native Edit results only; physical, browser and real-agent workflows remain separate tickets.

### Paired capture and OCR comparison

Run from WSL2 after building, under the same serialized live-test discipline:

```sh
PI_CU_RELEASE_OUTPUT=/tmp/pi-cu-capture-evidence flock -w 120 /tmp/pi-cu-live-tests.lock npm run test:reference:capture -- /path/to/dsh-computer-use-win
npm run test:reference:capture:report -- /path/to/dsh-computer-use-win
```

Serialize the report-contract command too when other live checks are active. `test:reference:capture` relays to the package-managed Windows Node and compares the public reference MCP and Pi worker interfaces. It creates only owned, non-activating capture/OCR fixtures; no physical input or clipboard actions are sent. The fixtures independently report geometry and minimized state. A separate offscreen rendering of the known painted label supplies ink coordinates without using either engine's screenshot/OCR implementation. PNG dimensions, center pixels, origins/scales, literal queries, word bounds, clipped text and unavailable-target results are retained. Screenshots remain in memory; the optional JSON artifact contains sanitized metadata, source hashes and observations rather than image payloads. A minimized-target fallback can capture desktop pixels internally, but those pixels are not persisted.

The public CLI contract was exercised red → green as scaled capture, native-resolution capture, fallback and OCR evidence were added. Its pass means the collector faithfully reports both engines and propagates the comparison exit status; it does **not** require every product observation to pass. Ordinary case failures remain recorded while independent cases continue. Cancellation/stopped evidence blocks later tool calls and fixture scenarios; uncertain fixture cleanup halts collection. Report cleanup confirms owned fixture exit and temporary-directory removal, not universal product cleanup. For a focused rerun, append `--scenario minimized --engine reference`; a partial rerun does not replace full coverage.

On 2026-10-30, reference **0.5.3** and Pi **0.1.0** ran from WSL2 through private Windows Node **22.23.4**, Windows build series **26200**. The final 24-case report recorded **23 passing checks and one retained reference minimized-capture failure**, with cleanup confirmed:

| Observation | Reference | Pi | Disposition |
| --- | --- | --- | --- |
| Normal native/scaled and covered green fixture | Correct green center pixels, PrintWindow, physical mapping within independent fixture bounds | Same known content and valid mapping | Scoped fixture pass, not every display/capture path |
| Black target behind magenta cover | Flagged `screen-region`, `occludedPossible: true`; target content was not established | WGC with independently verified black center | Both uncertainty reporting and actual method are retained; no general performance/superiority claim |
| Independently minimized green target | `ok: true`, unflagged PrintWindow caption at offscreen bounds near (-31993,-32000), no known green client content | Desktop fallback explicitly marked `windowCaptureFailed` | Reference outcome fails the fixture's “known target content or explicit unavailable/inconclusive” oracle; retain for #37 disposition rather than copy it into Pi |
| Wrong owner and closed target | Explicit failure, no image | Explicit failure, no image | Expected negative outcomes |
| OCR native/scaled and literal metacharacter miss | Recognized expected text; no regex interpretation or invented IDs | Same semantic checks | Known-label fixture pass |
| Painted-ink localization diagnostic | Native first-word X offset **+7 px**, scaled **+6 px** relative to independently rendered ink; Y offset 0 | Native offset 0; scaled approximately (+0.13,-0.36) px | Diagnostic difference, not a pixel-perfect OCR assertion; investigate before generalizing coordinate accuracy |
| Clipped fourth row | Three expected labels plus garbled extra recognized text | Three expected labels | Actual text retained; no assumption that clipped OCR must agree |
| Minimized OCR | Empty caption OCR with no query match and no conclusive-absence claim | Explicit `OCR_CAPTURE_FAILED` refusal | Different observable outcomes, not silently normalized to identical results |

The existing Pi native capture and OCR regressions also passed against the extended non-activating fixtures. Type checking, linting, all 42 portable tests, build and package/documentation checks passed. The live Pi regressions used a temporary Windows-readable copy of the runtime test dependency because Windows Node cannot resolve the worktree's absolute Linux dependency symlink; production source was unchanged.

The original overly specific minimized assertion required Pi's fallback flag from both engines. It was replaced with the semantic oracle above and a fixture-reported minimized-state check. The retained reference caption result still fails that broader oracle; the test adjustment did not erase the observation. No production capture/OCR code was changed.

Remaining capture/OCR acceptance is grouped into: (1) 100/150/200% mixed-DPI layouts, negative-origin monitors and changed primary/display layout, checking known fixture points before any input; (2) missing-language/WinRT availability and protected/elevated surfaces on suitable test installations; and (3) physical visual-targeting acceptance after the user enables the dedicated desktop runs. These are not inferred from the single tested display layout. The user currently deferred physical-input runs; #6/#7/#21 retain the broader release obligations.

## Paired browser-form comparison

Run `npm run test:browser:comparison -- /path/to/dsh-computer-use-win edge 3` from WSL2 under the shared live-test lock. The command relays to the private Windows Node, uses the same explicit installed executable for both engines, and runs the existing local browser-actions server's form route. It creates isolated headless profiles and disposable settings; no physical pointer/keyboard, clipboard or daily profile is used. `PI_CU_RELEASE_OUTPUT` retains `browser-comparison.json`, including nonzero-result evidence through the WSL relay.

The outcome oracle is the fixture application's submitted HTTP payload plus the visible confirmation read through normal tools. Tests do not fill fields through injected page JavaScript. Each navigation resets the fixture's receipt state, and each engine starts in a new browser/controller. The workflow reads/fetches IDs, inspects restricted fields without editing them, focuses/types/chords into Name, sets multilingual Notes and selection/checkbox values, clicks Submit, waits for the receipt, invokes a delayed result, scrolls, captures a PNG and rejects an old ID after navigation. The report retains page-change evidence and before/after native foreground, pointer and last-input tick.

On 2026-10-30, reference **0.5.3** and Pi **0.1.0** passed **three alternating pairs (six workflows)** using installed Edge **156.0.4314.50**, Windows Node **22.23.4**, driven from WSL2. Every independent payload matched `Pi 中文 café 😀`, the exact two-line Notes, accepted=true and choice=beta. Delayed waits were observed, restricted values were inspected before input, screenshots were PNGs of width 400, old references were rejected after navigation and native foreground/pointer/input ticks were unchanged. Controller/fixture exit and owned-folder removal were confirmed. The final assertion check additionally records positive page-scroll movement, requires a stale/document error rather than any generic failure, and verifies each owned process's actual executable/version and headless command-line flag.

A review found that the original `valuesPreserved` report was based only on the initial inspection. The workflow now re-finds both restricted controls and reads their values through public element_info after form actions, scrolling and screenshot, before navigation destroys the document. It records literal initial/post-action values and sets `valuesPreserved` only after both post-action values equal their originals. Run `npm run test:browser:comparison:oracle -- /path/to/dsh-computer-use-win edge --filled` to check this evidence and phase in both engine reports; this check first failed on the missing post-action evidence. A targeted paired rerun on 2026-10-30 passed for both engines: each fresh post-action observation returned exactly `Disabled value` and `Read-only value`, and cleanup was confirmed. The earlier six runs do not establish this post-action preservation result.

The deliberate `--verify-unfilled` mode established red before the workflow: both engines submitted the known empty/default payload, and exact payload assertions failed. It is labelled `diagnosticInjection: true` with a test-defect cause and kept separate from ordinary results. `test:browser:comparison:oracle` verifies both deliberate failures, their actual payloads, nonzero CLI status and cleanup through the public command. An earlier new-runner attempt observed Pi `spawn UNKNOWN` once; the existing root headless fixture passed, the failure did not recur in subsequent paired runs, and its cause remains unknown. Another early assertion incorrectly required the same disabled metadata from each engine's element_info; this was a test defect corrected by using each engine's public find/info evidence. These attempts are retained in the local evidence directories rather than counted as successful runs.

Observed semantic differences remain visible: DSH returns compact diff page changes, whereas Pi returned full page changes in this fixture. DSH element_info exposed disabled but not readonly; Pi's find/tree exposed both while element_info omitted those flags. The known read-only control was inspected without attempting to edit or bypass it. This metadata difference is not hidden by literal-JSON comparison or called runtime equivalence.

This is a paired **tool/backend** baseline, not a DSH or Pi model/session benchmark. It covers the named headless Edge workflow only: visible/native-dialog focus, other browsers, real-agent recovery, broader transfers/navigation and physical input remain in their existing release/ticket gates. User input during a run can invalidate foreground/pointer preservation attribution; retain the observations rather than assuming an engine caused any change.

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

## Locked-session diagnosis

On 2026-10-29 the live activation probe observed LockApp in the foreground, `AttachThreadInput` access denied, and WTS session flag 0 (locked). The generic foreground-refusal result was replaced with explicit `DESKTOP_SESSION_LOCKED` refusal before activation and physical pointer/text input. The opt-in [locked-session regression](windows.md#locked-session-refusals) reproduced the prior misleading result, then passed activation/movement/text refusal, cleanup and quiet observation on its disposable fixture. This does not establish the cause of every earlier refusal; the unlocked acceptance-bench retest and foreground-restoration checks remain pending.

## Unlocked foreground correction

On 2026-10-30, an unlocked VS Code → Notepad transition succeeded but the warm-helper return failed. Instrumentation showed input-thread attachment succeeded and SetForegroundWindow still returned false. The reference's BringWindowToTop step was missing from the attached fallback. Adding it (with a fresh ownership check before the second foreground request) corrected that live transition without injecting keys or changing lock/input guards. The [unlocked round-trip regression](windows.md#unlocked-activation-round-trips) failed on the prior source, then passed six disposable native/Chrome transitions, independently observed native hover, and return to prior foreground. The user's full acceptance-bench pointer workflow and automatic foreground-restoration cases remain pending.
