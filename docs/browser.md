# Browser read channel

Pi's normal tools route to the Windows browser worker when given `browserTab` or a browser element ID. `set_value` with `elementId: new-tab` opens a URL in a dedicated browser context; `<tab>:address` navigates it. `list_windows` annotates connected browser/tab IDs. Snapshot, accessibility_tree, find, element_info and screenshot work in this channel. Snapshot emits its PNG as an image block, with base64 omitted from text metadata.

Installed Chrome and Edge are discovered from Windows default-browser registration, App Paths and conventional locations. The worker uses pinned puppeteer-core 25.16.0 with explicit installed executables, CDP, no managed browser downloads and no daily profiles. Temporary profiles and an isolated browser context are created by the worker. Background target creation is explicit. The Chromium channel supports reading/navigation and guarded element interactions, page text/key input, scrolling, explicit waits, JavaScript dialogs, popups, upload/download metadata and tab closure. Experimental installed Firefox uses a separate WebDriver BiDi channel described below. Persistent profiles are a separate lifecycle slice. Browser drag remains unsupported as in the reference.

## Identity and coordinates

Tab IDs are salted per launch; element IDs are scoped to one tab document. Navigation clears observed element handles; disconnection withdraws tabs. Re-observe after navigation/reconnect rather than reusing old IDs. Never mix native HWND/PID/title or desktop x/y with browser references. Browser image bounds use page pixels and carry their actual width, height and imageScale; they are not desktop screen coordinates.

## Validation

Run `npm run build`, then `npm run test:browser -- edge` or `npm run test:browser -- chrome` from Windows Node or WSL2. Append `--headless` for a hidden test. The fixture starts its HTTP server on Windows and uses only disposable profiles. It sends no physical input and does not attach to daily browsers. It verifies Pi tool calls, tree/find/inspection, scaled screenshots, unchanged foreground, stale-ID rejection and disconnect/reconnect. Keep the desktop steady during the visible foreground check.

Corrected named-browser validation in this workspace: installed Edge headless read/lifecycle and full actions, installed Chrome headless full actions and visible read/lifecycle from WSL2, with returned executable, version and actual process headless flags asserted. Earlier fixture runs did not forward disposable settings through WSLENV and could select the personal browser setting; their requested browser labels alone are not reliable evidence. The fixtures only read settings and used temporary profiles, so daily browser profiles were not accessed. Windows process launches require sandbox escalation in this development environment; that is not an end-user extension dependency. Portable worker tests verify malformed/unknown requests without claiming native browser proof.

## Configuration and limits

Use `/computer-settings` to select browserApp and browserVisible in personal settings. Default is a visible browser following the Windows Chrome/Edge default, with installed-browser fallback. `PI_CU_BROWSER_EXECUTABLE` is an optional local executable-path override, not a model tool parameter. Fixtures use isolated settings files and never modify personal settings.

The Chromium outline comes from the accessibility tree. Traversal returns explicit truncation at budgets, but fetching an underlying AX tree or native browser protocol command can outlast the traversal budget; worker deadlines remain the outer safeguard. Page text is untrusted. An outline/page change proves neither user intent nor objective success. Browsers may activate for native dialogs; interaction behavior is validated in its own slice.

Own browser processes and temporary profiles are closed/removed at worker disposal. Abrupt OS termination can leave temporary profile directories; persistent profile policy and idle retirement are completed with the profile lifecycle slice. Do not describe this read slice as full browser parity.

Source: [Puppeteer installation](https://pptr.dev/guides/installation), [background page options](https://pptr.dev/api/puppeteer.createpageoptions), [accessibility snapshots](https://pptr.dev/api/puppeteer.accessibility.snapshot). Puppeteer is Apache-2.0 licensed; the package includes its license notice.

## Chromium interactions

Use observed browser element IDs for click, double-click, hover, focus, invoke and field values; browserTab selects the page for typing, keypress, scrolling and waits. Inputs stay inside the browser protocol. Target/disabled/readonly/occlusion checks run in a separate browser world so page code cannot simply replace the guard's DOM methods. The Windows worker serializes calls, retains operation ownership and honors stop/cancellation before subsequent inputs.

Ordinary browser actions return a bounded fresh outline/page-change report with `verification: sent`; this is evidence to inspect, not proof of the user's objective. Explicit waits return observed, timeout or inconclusive when budgets prevent proving absence. A post-action observation failure is recorded separately without replaying the action. Pending navigation is reported as still loading rather than navigated successfully.

An open JavaScript dialog blocks other page reads/actions. `keypress` Enter accepts it and Escape dismisses it; `type_text` supplies a prompt answer before Enter. Browser-window shortcuts such as Ctrl+L/T are refused; use address/new-tab tools. Background operation is the default; explicit activate_window is allowed to activate. Native JavaScript dialogs may affect foreground in visible browsers, matching the reference limitation.

File inputs take existing absolute Windows file paths, one per line or separated by `|`. An intercepted chooser reports an observed input ID instead of opening the OS file dialog. Chromium downloads report their state/name/file metadata under the package's Windows downloads directory; action-triggered popups return new tab IDs. None of these operations uses the user's daily browser profile.

Run `npm run test:browser:actions -- edge` or `-- chrome` after building. The default action fixture is headless; append `--visible` for the visible-browser check. It exercises text/chords, occlusion (including a page override of elementFromPoint), disabled/readonly controls, select/checkbox, dialogs, scroll/waits, transfers, popup/close and operation cancellation recovery through the Pi tool/worker interfaces. Live suites are serialized externally with the shared lab lock when multiple development agents use the same desktop.

Action validation uses the executable/version/headless assertions above; see corrected evidence and Firefox proof below. Physical keyboard/mouse input was not used.


## Experimental installed Firefox

Select `browserApp: firefox`; automatic Firefox-family launches are always headless, and settings normalize browserVisible to false. An OS Firefox default alone does not enable this experimental channel. Discovery checks the Firefox default ProgID command first, then registered App Paths and conventional Firefox locations. Both application.ini and browser/application.ini are accepted only with Firefox's App.ID in the App section; names alone do not establish engine compatibility. `PI_CU_BROWSER_EXECUTABLE` can select an unmodified Firefox-family executable explicitly. No managed or patched Firefox is downloaded by the extension.

The Firefox outline is explicitly `browser-dom-heuristic`, not a native accessibility tree. Roles and names are approximations from DOM controls, labels and ARIA. Elements remain document-scoped, with isolated-realm guards, ownership, stop/cancellation, dialogs, waits and post-action outlines shared with Chromium. The adapter's narrow isolated-realm seam uses a pinned Puppeteer internal interface because the public BiDi API does not expose accessibility or an isolated guard world; upgrades require live guard validation.

Reference limitations remain explicit: iframe contents, closed shadow roots, canvas semantics, file upload/download, browser drag and visible Firefox focus/sign-in flows are unsupported. Firefox screenshots capture the viewport and explicitly report that maxWidth is ignored. Forks and ESR versions require their own validation. Automatic crash replay is never attempted; a caller can explicitly create a new tab after a disconnected session has been withdrawn.

`PI_CU_BROWSER_BIDI_URL` explicitly connects to a loopback `ws:` endpoint with no credentials or fragment (root path becomes /session). It creates an isolated context for this worker; disposal closes that context and disconnects without closing the external browser process. Do not configure daily-profile endpoints. Run `npm run test:browser:firefox:endpoint` from Windows Node with PI_CU_BROWSER_EXECUTABLE to validate external process preservation in an owned fixture.

Proof in this workspace used an official unmodified Mozilla Firefox 144.0 Windows binary extracted into a disposable fixture directory, without running its installer or changing browser registration. WSL2 Pi tool tests passed DOM outline/find/inspection, viewport screenshots, stale IDs, explicit reconnect, CJK/emoji/multiline values, password-value redaction, guarded actions, text/chords, scroll/waits, all three JavaScript dialogs, popup/close, transfer refusal and operation cancellation/recovery. The full action suite also passed from a native Windows Pi host. A native Windows endpoint fixture rejected a non-loopback URL and preserved its externally owned process on valid disconnect. No Firefox forks/ESR or visible/sign-in workflows are claimed validated. No physical desktop input was used.

For installed Firefox run `npm run test:browser -- firefox --headless` and `npm run test:browser:actions -- firefox`. An optional explicit executable is forwarded by WSL fixtures; each fixture asserts the actual launched executable/version/headless flags. Serialize live suites with the shared lab lock when multiple agents use the desktop.

## Browser presentation

See [browser cues](indicators.md#browser-cues) for owned Chromium frame/tab/click markers, image suppression and manual visual acceptance. Experimental Firefox and external endpoints do not receive these cues.
