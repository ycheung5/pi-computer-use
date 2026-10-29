# Browser read channel

Pi's normal tools route to the Windows browser worker when given `browserTab` or a browser element ID. `set_value` with `elementId: new-tab` opens a URL in a dedicated browser context; `<tab>:address` navigates it. `list_windows` annotates connected browser/tab IDs. Snapshot, accessibility_tree, find, element_info and screenshot work in this channel. Snapshot emits its PNG as an image block, with base64 omitted from text metadata.

Installed Chrome and Edge are discovered from Windows default-browser registration, App Paths and conventional locations. The worker uses pinned puppeteer-core 25.16.0 with explicit installed executables, CDP, no managed browser downloads and no daily profiles. Temporary profiles and an isolated browser context are created by the worker. Background target creation is explicit. The Chromium channel supports reading/navigation and guarded element interactions, page text/key input, scrolling, explicit waits, JavaScript dialogs, popups, upload/download metadata and tab closure. Experimental Firefox and persistent profiles are separate tickets. Browser drag remains unsupported as in the reference.

## Identity and coordinates

Tab IDs are salted per launch; element IDs are scoped to one tab document. Navigation clears observed element handles; disconnection withdraws tabs. Re-observe after navigation/reconnect rather than reusing old IDs. Never mix native HWND/PID/title or desktop x/y with browser references. Browser image bounds use page pixels and carry their actual width, height and imageScale; they are not desktop screen coordinates.

## Validation

Run `npm run build`, then `npm run test:browser -- edge` or `npm run test:browser -- chrome` from Windows Node or WSL2. Append `--headless` for a hidden test. The fixture starts its HTTP server on Windows and uses only disposable profiles. It sends no physical input and does not attach to daily browsers. It verifies Pi tool calls, tree/find/inspection, scaled screenshots, unchanged foreground, stale-ID rejection and disconnect/reconnect. Keep the desktop steady during the visible foreground check.

Executed in this workspace: Edge and Chrome headless/visible from WSL2; visible Edge and Chrome from a Windows Node host. Windows process launches require sandbox escalation in this development environment; that is not an end-user extension dependency. Portable worker tests verify malformed/unknown requests without claiming native browser proof.

## Configuration and limits

Until the personal settings command is implemented, `PI_CU_BROWSER_APP=default|edge|chrome` chooses the installed browser, `PI_CU_BROWSER_VISIBLE=false` selects headless, and `PI_CU_BROWSER_EXECUTABLE` overrides the executable path. These are local environment settings, not model tool parameters. Default is a visible browser following the Windows Chrome/Edge default, with installed-browser fallback.

The Chromium outline comes from the accessibility tree. Traversal returns explicit truncation at budgets, but fetching an underlying AX tree or native browser protocol command can outlast the traversal budget; worker deadlines remain the outer safeguard. Page text is untrusted. An outline/page change proves neither user intent nor objective success. Browsers may activate for native dialogs; interaction behavior is validated in its own slice.

Own browser processes and temporary profiles are closed/removed at worker disposal. Abrupt OS termination can leave temporary profile directories; persistent profile policy and idle retirement are completed with the profile lifecycle slice. Do not describe this read slice as full browser parity.

Source: [Puppeteer installation](https://pptr.dev/guides/installation), [background page options](https://pptr.dev/api/puppeteer.createpageoptions), [accessibility snapshots](https://pptr.dev/api/puppeteer.accessibility.snapshot). Puppeteer is Apache-2.0 licensed; the package includes its license notice.

## Chromium interactions

Use observed browser element IDs for click, double-click, hover, focus, invoke and field values; browserTab selects the page for typing, keypress, scrolling and waits. Inputs stay inside the browser protocol. Target/disabled/readonly/occlusion checks run in a separate browser world so page code cannot simply replace the guard's DOM methods. The Windows worker serializes calls, retains operation ownership and honors stop/cancellation before subsequent inputs.

Ordinary browser actions return a bounded fresh outline/page-change report with `verification: sent`; this is evidence to inspect, not proof of the user's objective. Explicit waits return observed, timeout or inconclusive when budgets prevent proving absence. A post-action observation failure is recorded separately without replaying the action. Pending navigation is reported as still loading rather than navigated successfully.

An open JavaScript dialog blocks other page reads/actions. `keypress` Enter accepts it and Escape dismisses it; `type_text` supplies a prompt answer before Enter. Browser-window shortcuts such as Ctrl+L/T are refused; use address/new-tab tools. Background operation is the default; explicit activate_window is allowed to activate. Native JavaScript dialogs may affect foreground in visible browsers, matching the reference limitation.

File inputs take existing absolute Windows file paths, one per line or separated by `|`. An intercepted chooser reports an observed input ID instead of opening the OS file dialog. Chromium downloads report their state/name/file metadata under the package's Windows downloads directory; action-triggered popups return new tab IDs. None of these operations uses the user's daily browser profile.

Run `npm run test:browser:actions -- edge` or `-- chrome` after building. The default action fixture is headless; append `--visible` for the visible-browser check. It exercises text/chords, occlusion (including a page override of elementFromPoint), disabled/readonly controls, select/checkbox, dialogs, scroll/waits, transfers, popup/close and operation cancellation recovery through the Pi tool/worker interfaces. Live suites are serialized externally with the shared lab lock when multiple development agents use the same desktop.
