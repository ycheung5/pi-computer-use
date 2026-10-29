# Windows discovery

## Implemented scope

`windows_computer_use_list_windows` reads native top-level windows without resolving UI Automation elements or sending physical input. Options match the reference: `includeInvisible` defaults to false and `maxWindows` defaults to 50, with an integer range of 1–200. The default excludes hidden and minimized windows.

Results include a window ID with HWND/PID ownership, name, class, bounding box, enabled/offscreen/focus state, native source and bounded responsiveness information. `truncated` indicates the limit stopped enumeration. A denied responsiveness probe is reported as `responsive: null` and `responsiveness: access_denied`; an unsuccessful probe is not proof that an application is permanently hung. Enumeration rechecks owner PID before returning a record, but its result remains an observation rather than a guarantee that the window still exists at a later action.

Worker request envelopes and listing arguments are validated at execution, independently of Pi's schema. Invalid requests with usable IDs receive failures; unidentifiable malformed requests produce stderr diagnostics without crashing later valid requests.

## Native bridge

TypeScript owns dispatch and lifecycle. A focused C# bridge performs Win32 enumeration on an MTA thread through a persistent JSON-line process. The package contains fresh bridge source, compiled lazily with the Windows .NET Framework64 compiler into a source-versioned cache below `%LOCALAPPDATA%\pi-computer-use\native`. No separately installed .NET SDK is required on the tested Windows 11 baseline. Missing compiler/data-directory and compilation failures are explicit; cache and compilation are not assumed to work on untested Windows configurations.

Keeping the helper persistent gives subsequent accessibility slices a place for apartment-owned element references. Helper stdin closure ends it; worker disposal closes its transport. The native helper has an execution watchdog, and cancellation rejects a request without replaying it. Input-safe stopping and desktop ownership are separate later tickets; this slice sends no physical input.

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

Live evidence: Windows 11 x64, .NET Framework bridge, native form fixtures and installed Edge passed on 2026-10-29. Elevated/UAC target access and five-minute real-time expiry remain release cases. Snapshot image composition depends on the screenshot slice; sparse empty-find OCR composition depends on the OCR slice. Until those integrate, results expose `screenshotPending` / `ocrFallbackPending` rather than claiming those features succeeded. Browser-channel routing is added by the browser slices, not inferred from desktop UIA support.
