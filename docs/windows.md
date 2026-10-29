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

Keeping the helper persistent gives subsequent accessibility slices a place for apartment-owned element references. Helper stdin closure ends it; worker disposal closes its transport. The native helper has an execution watchdog, and cancellation rejects a request without replaying it. Input-safe stopping and desktop ownership are separate later tickets; this slice sends no physical input.

## Validation

- `npm run check`: includes invalid listing options, malformed worker envelopes, continued health execution after errors and Pi tool registration/dispatch.
- `npm run build`: produces the worker modules; package contents include the native bridge source.
- `npm run test:native:windows`: run with Windows Node after building. Creates only dedicated passive fixture windows, tests visible/hidden filtering, identity metadata, bounds, responsiveness, limits and window disappearance, then closes fixtures and disposes the worker. It does not send keyboard/mouse input or modify normal applications.

Live proof on 2026-10-29 used Windows 11 x64 through WSL interop and the private package-managed Node runtime. Both portable worker/Pi tests and the real fixture test passed. After integrating the WSL2 launcher, a Linux-side worker client also enumerated one native window through that launcher and disposed successfully; only counts were logged. Per-monitor DPI awareness is requested before enumeration; multi-monitor geometry remains a later capture/manual release check.

## Remaining targeted behavior

Listing establishes identity metadata but does not resolve an action target. Ambiguous-title rejection, previously observed HWND/PID rejection after replacement, and inaccessible UIA targets must be tested through the first real targeted observation/action in the accessibility slice. No test-only `resolve_window` tool or request was added to claim those behaviors prematurely. Browser tab annotations also belong to browser integration.
