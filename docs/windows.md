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

Live proof on 2026-10-29 used Windows 11 x64 through WSL interop and the private package-managed Node runtime. Both portable worker/Pi tests and the real fixture test passed. Per-monitor DPI awareness is requested before enumeration; multi-monitor geometry remains a later capture/manual release check.

## Remaining targeted behavior

Listing establishes identity metadata but does not resolve an action target. Ambiguous-title rejection, previously observed HWND/PID rejection after replacement, and inaccessible UIA targets must be tested through the first real targeted observation/action in the accessibility slice. No test-only `resolve_window` tool or request was added to claim those behaviors prematurely. Browser tab annotations also belong to browser integration.
