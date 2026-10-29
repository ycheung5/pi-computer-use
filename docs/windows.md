# Windows discovery

## Screenshots

`windows_computer_use_screenshot` accepts native window identity/title/process targeting, `scope: active_window | desktop`, `maxWidth` (0 means original size), and optional explicit activation. Capture does not resolve UIA elements. PNG data is returned as a Pi image block; text and rendering details contain metadata without duplicated base64.

The capture chain prefers verified unobstructed foreground pixels, then `PrintWindow`. A failed or apparently blank render tries an isolated Windows.Graphics.Capture helper using HWND interop and a free-threaded frame pool. The helper has bounded frame/copy polling plus an external worker deadline, so unavailable WinRT metadata and stalled capture do not disable ordinary window enumeration. A final screen-region fallback is marked `occludedPossible: true`. Hidden/minimized/unavailable target surfaces return a desktop fallback marked `windowCaptureFailed: true`; callers must not treat it as the target's content. Capture errors and fallback warnings remain explicit.

`bounds` and `origin` are physical screen coordinates, including negative virtual-desktop positions. `width`/`height` describe the actual PNG. Map image X using `origin.x + imageX / imageScale` and Y using `origin.y + imageY / imageScaleY`; a separate Y scale accounts for height rounding during resizing. Target identity and geometry are checked around capture. No tool automatically activates a window unless `activate: true` is requested.

Run `npm run test:native:capture` with Windows Node after building. Its dedicated passive fixtures verify actual green pixels behind a magenta cover, PNG dimensions, coordinate mapping, wrong-owner refusal, a black-frame-triggered WGC fallback and explicit minimized-target metadata. Screenshots remain in test process memory; the suite sends no physical input. Multi-monitor layouts and changes across mixed DPI displays still require recorded manual validation rather than being inferred from this fixture.

WGC uses the documented [CreateForWindow interop](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow), [free-threaded frame pool](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.direct3d11captureframepool.createfreethreaded), and [memory-buffer byte access](https://devblogs.microsoft.com/oldnewthing/20240122-00/?p=109304). A composited frame can legitimately be black; only the unreliable PrintWindow path uses black-frame detection to choose a fallback.

## Implemented scope

`windows_computer_use_list_windows` reads native top-level windows without resolving UI Automation elements or sending physical input. Options match the reference: `includeInvisible` defaults to false and `maxWindows` defaults to 50, with an integer range of 1–200. The default excludes hidden and minimized windows.

Results include a window ID with HWND/PID ownership, name, class, bounding box, enabled/offscreen/focus state, native source and bounded responsiveness information. `truncated` indicates the limit stopped enumeration. A denied responsiveness probe is reported as `responsive: null` and `responsiveness: access_denied`; an unsuccessful probe is not proof that an application is permanently hung. Enumeration rechecks owner PID before returning a record, but its result remains an observation rather than a guarantee that the window still exists at a later action.

Worker request envelopes and listing arguments are validated at execution, independently of Pi's schema. Invalid requests with usable IDs receive failures; unidentifiable malformed requests produce stderr diagnostics without crashing later valid requests.

## Native bridge

TypeScript owns dispatch and lifecycle. A focused C# bridge performs Win32 enumeration on an MTA thread through a persistent JSON-line process. The package contains fresh bridge source, compiled lazily with the Windows .NET Framework64 compiler into a source-versioned cache below `%LOCALAPPDATA%\pi-computer-use\native`. No separately installed .NET SDK is required on the tested Windows 11 baseline. Missing compiler/data-directory and compilation failures are explicit; cache and compilation are not assumed to work on untested Windows configurations.

Keeping the helper persistent gives subsequent accessibility slices a place for apartment-owned element references. Helper stdin closure ends it; worker disposal closes its transport. The native helper has an execution watchdog, and cancellation rejects a request without replaying it. [Desktop ownership](ownership.md), [stopping](stopping.md) and [guarded pointer actions](pointer.md) now extend this bridge; discovery itself sends no physical input.

## Validation

- `npm run check`: includes invalid listing options, malformed worker envelopes, continued health execution after errors and Pi tool registration/dispatch.
- `npm run build`: produces the worker modules; package contents include the native bridge source.
- `npm run test:native:windows`: run with Windows Node after building. Creates only dedicated passive fixture windows, tests visible/hidden filtering, identity metadata, bounds, responsiveness, limits and window disappearance, then closes fixtures and disposes the worker. It does not send keyboard/mouse input or modify normal applications.

Live proof on 2026-10-29 used Windows 11 x64 through WSL interop and the private package-managed Node runtime. Both portable worker/Pi tests and the real fixture test passed. After integrating the WSL2 launcher, a Linux-side worker client also enumerated one native window through that launcher and disposed successfully; only counts were logged. Per-monitor DPI awareness is requested before enumeration; multi-monitor geometry remains a later capture/manual release check.

## Remaining targeted behavior

Listing establishes identity metadata but does not resolve an action target. Ambiguous-title rejection, previously observed HWND/PID rejection after replacement, and inaccessible UIA targets must be tested through the first real targeted observation/action in the accessibility slice. No test-only `resolve_window` tool or request was added to claim those behaviors prematurely. Browser tab annotations also belong to browser integration.

## Accessibility observations

`accessibility_tree`, `snapshot`, `find` and `element_info` are registered Pi tools backed by a persistent MTA UIA bridge. The worker validates options before native execution. Tree traversal bounds depth, nodes and elapsed time; a synchronous provider can still block, so the native process has a 40-second watchdog and the extension permits the maximum 30-second traversal budget plus cleanup. Truncated or failed observations remain explicit.

Runtime element references are held for five minutes, scoped to their observed HWND/PID and checked against the current RuntimeId. Unseen, removed and wrong-owner references require fresh observation. Full detail can include a supported value, except password-field values are never read. Native window IDs also validate HWND/PID before UIA access. Title/PID selection refuses ambiguous windows; explicit handles are preferred.

Chromium observations probe renderer accessibility and report `webContent` readiness. A first read can return `starting`; callers should observe again rather than infer that absent page controls do not exist. Unnamed browser layout panes do not consume logical depth. This has been exercised against installed Edge without a forced-accessibility launch flag; other Chromium integrations require their own release checks.

`npm run test:native:accessibility` (Windows Node after build) opens dedicated passive forms and verifies structured trees, values/password protection, find, element inspection, title ambiguity, missing/wrong-owner targets, removed/unseen references and depth/node truncation. `npm run test:native:chromium` opens a disposable visible Chromium profile and local page, reads its page button after lazy initialization, and closes only that browser. Neither test sends physical input; they are live desktop tests, not portable substitutes.

Live evidence: Windows 11 x64, .NET Framework bridge, native form fixtures and installed Edge passed on 2026-10-29. Elevated/UAC target access and five-minute real-time expiry remain release cases. Snapshot now includes a separate PNG by default, preserves explicit UIA failure when an image is attached, and honors `includeScreenshot: false`. Like the reference, `captureWindow: false` defaults to desktop pixels; `captureWindow: true` captures the selected window. Sparse empty-find OCR composition remains assigned to the OCR slice, with `ocrFallbackPending` explicit until integrated. Browser-channel routing is added by the browser slices, not inferred from desktop UIA support.

## Background controls

`focus`, `invoke`, `set_value` and element-targeted `scroll` operate only on fresh observed references and validate the requested owning window. Native Win32 buttons use background button messages, native edit fields use selection/replacement messages without clipboard or keyboard input, and scrolling prefers the nearest native scrollable control before UIA ScrollPattern. Other controls use their supported UIA patterns. Expand/collapse is idempotent; scroll-into-view uses ScrollItemPattern.

A guard records foreground/pointer state around provider calls and attempts restoration when the target's provider took them. It preserves a newly opened menu/dialog, an explicit `activate: true`, and intervening user changes. Windows may refuse foreground restoration; result metadata states what happened. A pointer change outside the control is left alone rather than assumed to belong to automation.

Results report `verification: sent`, not task completion. Use an explicit observation/wait to verify effects. Read-only, disabled, stale and wrong-owner controls fail explicitly. An unavailable background pattern returns `WCU_NEEDS_INPUT` with `inputRequired: true` only when the requested fallback permits it; no physical input is sent. Coordinate scrolling and all physical fallback execution stay gated pending the guarded-input slice.

Run `npm run test:native:controls` with Windows Node after build. It creates a dedicated form, proves Unicode native editing, button dispatch, focus, actual element-scroll state change, read-only refusal, unsupported-pattern/fallback distinction and wrong-owner/stale rejection through registered Pi tools, then closes the fixture. It sends no physical input. Expand/collapse across provider families and menu/dialog/user-interference restoration require additional release fixtures/manual cases; this test does not claim universal provider coverage.

Before targetless physical input is enabled, propagate operation identity into native last-input-window tracking: returning the user's foreground must not redirect the agent's later typing or observations to that user's window. That state is not introduced by these background-only actions.

## OCR and sparse accessibility fallback

`windows_computer_use_ocr` captures through the same screenshot module, then recognizes that PNG in a separate WinRT OCR process. Options preserve the reference target/scope conventions, `maxWidth: 1920` (0–7680), optional literal `query`, `resolveControl: false` and `includeScreenshot: false`. Output lines/words and matched union boxes use physical screen coordinates, applying both horizontal and vertical image scales. Text matching ignores case and whitespace, supports contiguous CJK word runs, treats regex characters literally, and returns at most three line matches.

OCR candidates have `source: ocr`, recognized text, bounds and centers—not invented control IDs. Only explicit `resolveControl` performs a UIA hit-test; it may describe an enclosing document rather than a semantic button. Hit-test failures stay explicit. A capture flagged as potentially occluded cannot establish target text absence or control identity. Missing query results are always inconclusive evidence about the actual interface. Minimized/hidden-target desktop fallbacks are refused as OCR target evidence.

Empty `find` observations with sparse (at most 20 nodes) or incomplete UIA trees attach OCR candidates by default, except when `controlType` is specified or `ocrFallback: false`. The UIA result remains separate from OCR and retains UIA errors/truncation. OCR unavailability does not manufacture a matching element.

The package compiles fresh OCR helper source against installed Windows WinMetadata and .NET Framework assemblies. Recognition uses user-profile OCR languages and reports the actual language plus available recognizers. Missing languages/metadata, image-size limits, native recognition failures, timeout and cancellation remain explicit. The OCR helper is isolated from UIA and retired after cancellation; requests are never replayed. Microsoft documents [Windows.Media.Ocr desktop support as requiring package identity](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr), although the unpackaged helper works on the tested Windows 11 machine. Clean-machine availability remains a release validation requirement, not a universal compatibility claim.

Run `npm run test:native:ocr` using Windows Node after building. A dedicated custom-painted fixture proves actual recognized text, query normalization/literal behavior, three-result limits, image-to-screen mapping across scales, optional screenshots, explicit control lookup, sparse-find fallback and minimized-target refusal. It sends no physical input and does not capture normal applications. Portable contract tests cover validation, pre-cancelled calls and Pi registration. Live OCR evidence on 2026-10-29: Windows 11 x64 with profile recognizer `zh-Hant-HK` recognized fixture English text. Missing-language installations, protected content and mixed-DPI capture still need release checks.

## Explicit waits

`windows_computer_use_wait` performs a cancellable delay (`milliseconds: 500`, integer 1–30000) and makes no verification claim. `wait_for` polls `window`, `element` or literal OCR `text` with `appear: true` by default. Window waits require explicit title/PID/HWND targeting; element/text waits require a nonempty query. Defaults are 5000 ms overall, 250 ms between observations, and a 1000 ms UIA traversal budget. Overall time is 100–60000 ms, interval 50–5000 ms, and reference depth/node/view options apply to element observations.

A satisfied predicate returns `verification: observed`; a complete observation that did not satisfy it before the deadline returns `timeout`. Truncated, unavailable, timed-out or potentially occluded evidence returns `inconclusive`. UIA positive matches can establish presence even when another part of the tree is truncated; truncated absence cannot establish disappearance. Window existence uses native enumeration including invisible windows, bounded at 4096 entries; a truncated enumeration cannot prove absence. Target HWND/PID matching preserves window identity.

Text waits concern literal OCR output from a complete reliable capture, rather than universal truth about application text. OCR exposes `captureConclusive` separately from query-hit certainty so a reliable image without a recognized sequence can satisfy an explicit disappearance predicate, while potentially occluded or failed capture cannot. Native recognition failure never establishes absence. Polls avoid activating targets and disable UIA's OCR fallback for element predicates.

Polling bounds each observation by the remaining deadline and retires a stuck native observation worker; a new provider call is not started with less than 100 ms remaining after a prior observation. Cancellation propagates through the common operation stop path. Valid explicit waits receive a bounded transport allowance (delay plus 2 seconds; condition timeout plus 10 seconds) rather than being cut off by a shorter ordinary request watchdog. Queue time is still outside execution time.

Run `npm run test:native:waits` with Windows Node after building. Its passive fixture proves window existence/disappearance, actual control transitions, complete missing-condition timeout, truncated-absence refusal, OCR text appearance/disappearance and prompt cancellation. Portable worker tests cover argument bounds, plain waits, unavailable native observations and deadlines shorter than a valid explicit wait. Mixed-DPI/protected/occluded target cases remain covered by capture/OCR release validation rather than inferred from this passive fixture.
