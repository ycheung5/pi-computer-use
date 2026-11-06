# Control indicators

The candidate ties the required border to [exclusive-control acquisition and release](spec.md#exclusive-control). Appearance is accepted; lifecycle, physical and display acceptance remains scoped under #20/#31.

The independent Windows stop helper also draws Pi-branded screen edges, a status bar and a pointer tag. The screen border uses a per-pixel translucent blue falloff with a bright core, following the reference glow at 1.5 times its width: a 3-pixel core plus 27-pixel falloff at reference width scale 1, scaled by monitor width (clamped from 1 to 2). The separate Pi status bar and pointer tag retain their existing appearance. If frame preparation or presentation fails, that frame stays hidden and its error is reported until configuration or display layout causes a rebuild; the other indicators continue. It uses non-activating, disabled, layered windows; the pointer guard additionally skips the verified helper process if a Windows point-query API still returns an overlay. The tag follows the pointer, accounts for the current cursor bitmap size and stays inside its monitor's working area.

## Current operation lifetime

Arming alone does not acquire physical control or show the border. Before a physical action, the worker acquires suppression and verifies the border; quiet-only actions do neither. The border remains through subsequent reads, tool gaps and model thinking, without an idle expiry. Stop or confirmed operation settlement releases control and hides it. Failed border creation refuses acquisition; loss of the interactive desktop or required border signals stop. Optional screen/pointer preferences cannot disable the local control border; `indicatorIdleMs` remains a saved compatibility preference and does not delay release or expire exclusive control.

Settings come from the existing personal settings manager. Screen and pointer presentation are independent; disabling either or both never disables global stopping. Configured changes are applied to a running helper, including when a UIA request is blocked. Esc remains reserved and an extra Ctrl/Alt/Shift/Win shortcut can be configured. Injected and lower-integrity-injected keyboard events are ignored by the stop hook so an agent's Escape action can dismiss UI without stopping its own operation.

Own native screenshots/OCR suspend overlay windows and restore presentation in `finally`, retaining the armed stop event throughout. Remote/recording visibility selects Windows display affinity; helper status reports whether that call actually succeeded. [Microsoft documents this as applying to supported capture APIs](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity); it does not establish universal recorder behavior. Actual recorder results need a named application/method and human observation.

## Preview and diagnostics

- `/computer-settings preview check` draws an offscreen sample and reports monitor layout/settings without displaying overlays or arming physical stopping.
- `/computer-settings preview` displays a two-second preview without input and without arming Esc. It does not modify saved preferences.
- `health` reports control-helper status only if already started; quiet health does not start overlays or a global listener.
- `npm run test:indicators` uses disposable Windows settings and exercises configuration, offscreen rendering, shortcut parsing, operation lifetime, capture suspension and disabled-indicator stopping without physical input.
- `npm run test:indicators -- --recording-preview --plan` describes a backend-free, unarmed preview. The live `--recording-preview` mode displays recording-visible and recording-hidden settings for two approximately eight-second steady phases, with a brief expiry gap between them. Both phases keep the local border visible; it sends no input, acquires no exclusive control and captures no pixels. Use the shared live-test lock. The user operates their recorder and inspects the result locally; the runner's successful helper metadata is not a recorder verdict.
- Set `PI_CU_ENABLE_INDICATOR_PREVIEW=1` for the same runner's brief visible show/hide, native hit-query and capture-suspension checks. Run live checks under `flock -w 120 /tmp/pi-cu-live-tests.lock` from WSL to avoid overlap with other desktop fixtures.

The updated glow border is source-reviewed. Portable checks, package validation and compilation of the Windows stop/indicator helper passed; the helper was not launched for these checks. A later opt-in Windows run passed visible edge/bar/pointer count, frame-error, screenshot-suspension, bar hit-query and hide checks on two monitors with owned process cleanup. This does not establish human visual appearance, edge click-through, alpha fidelity or third-party capture behavior. An earlier transient screenshot invalid-handle failure did not recur and its cause remains unknown. Automated protocol state and native window-query checks establish behavior, not human visual acceptance. Physical keys and mouse input are not emitted by this runner.

A later approximately ten-second preview used temporary settings and showed the expected frame and bar windows on two monitors across six status observations, with no frame errors; the disposable worker and settings were cleaned up and no input or screenshots were sent. The user confirmed that the blue border's appearance and thickness looked right. This does not establish edge click-through, alpha fidelity, third-party capture or real-control lifecycle. A separate read-only Windows hit-test placed a disposable topmost window at each monitor's top-left corner. At one point inside each visible edge, `WindowFromPoint` returned the disposable window both before and during the preview on both monitors; both frames and bars were visible with no frame errors. This samples two edge locations only; actual mouse delivery, remaining edge regions and pointer-tag pass-through remain unverified.

## Acceptance checklist

Current #20 scope reuses accepted control results; an unchecked item here is not a request to repeat a completed physical-stop test.

- [x] Human appearance/thickness acceptance and the two sampled native edge hit-tests above.
- [x] Required border retention across reads, a gap longer than the configured idle value, optional-visual/remote setting changes and a refused settings update; immediate hide after settlement/stop and show for an explicit new operation. See [automated lifecycle evidence](validation.md#automated-border-lifecycle).
- [x] Actual human editing/explicit continuation and physical stopping from [#31's accepted receipts](validation.md#control-interruption-acceptance). The new lifecycle check supplies presentation state across release/reacquisition; no new physical-key test is queued. Injected-key filtering retains its existing source/protocol scope, not a new dialog-keyboard workflow claim.
- [x] Owned strict PrintWindow pixel exclusion, capture restoration and retained control at 100%, 150%/100%, 175%/100% and the changed negative-origin arrangement. [Pixel and layout receipts](validation.md#changed-monitor-arrangement) compose with accepted protocol suspension. This does not claim pixel coverage of every default screen-copy, WGC or OCR path.
- [x] Actual available 100%/150%/175% scales, mixed-DPI window transitions and a changed display arrangement passed. Both scales are restored; the secondary returned to the right with a recorded vertical alignment difference. See [measured stages](validation.md#mixed-dpi-stages). #6's practical first-release scope is accepted; unavailable 200% and other unexercised display variants stay unverified; optional bars/tag are not universally certified by frame-only pixel samples.
- [ ] Third-party remote/screen-sharing/recording behavior with visibility enabled/disabled. Windows affinity application is metadata evidence; it does not prove every recorder obeys it.

The current desktop has two 100%-scale monitors. Unmeasured display/capture configurations, remaining hit-test regions and third-party recording must not be inferred from the accepted strict-path pixels or preview/status assertions. The [execution queue](tickets.md#execution-queue) tracks the remaining #6/#20 closeout.

## Browser cues

Owned Chromium pages use a Pi favicon while active and a small page-coordinate click marker in an isolated, closed shadow root. The host is `aria-hidden` and every marker layer uses `pointer-events: none`. Native browser actions remain quiet: these page cues do not arm desktop stopping or show desktop overlays. Page screenshots hide the marker and restore it in `finally`; results report whether hiding was confirmed.

Visible owned Chromium processes receive a Pi-blue Windows 11 DWM **border** tint, without installing a browser extension or changing the user's daily browser theme. Only windows belonging to the retained Puppeteer child process are considered. Tab cues and owned-frame tint are removed/restored at operation settlement or stop. Cosmetic failures remain visible as presentation warnings rather than being misreported as successful decoration or replaying an action. Experimental Firefox has no browser presentation cues. External Chromium endpoints may receive page cues, but their browser frames are never tinted.

Headless browser fixtures verify badge/marker state, accessibility hiding, closed-shadow isolation, pointer pass-through, screenshot suspension and operation cleanup. Actual browser-border appearance and page-marker visibility still belong to manual visual acceptance.

![Offscreen native statusbar fixture](../assets/indicator-preview.png)

Offscreen native statusbar fixture; not full desktop acceptance.

A visible Edge fixture confirmed the owned DWM call accepted the border tint and the page/screenshot cue assertions passed. Its broader foreground-preservation assertion changed HWND across browser launch and is unresolved; this is not evidence of completed visual/focus acceptance. Headless action and cue lifecycle fixtures passed.
