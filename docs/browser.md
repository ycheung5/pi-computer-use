# Browser read channel

Pi's normal tools route to the Windows browser worker when given `browserTab` or a browser element ID. `set_value` with `elementId: new-tab` opens a URL in a dedicated browser context; `<tab>:address` navigates it. `list_windows` annotates connected browser/tab IDs. Snapshot, accessibility_tree, find, element_info and screenshot work in this channel. Snapshot emits its PNG as an image block, with base64 omitted from text metadata.

Installed Chrome and Edge are discovered from Windows default-browser registration, App Paths and conventional locations. The worker uses pinned puppeteer-core 25.16.0 with explicit installed executables, CDP, no managed browser downloads and no daily profiles. Temporary profiles and an isolated browser context are created by the worker. Background target creation is explicit. This slice covers reading/navigation; browser interaction, dialogs/transfers and experimental Firefox arrive in the subsequent tickets. Persistent profiles are a separate ticket.

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
