# Control indicators

Current build: presentation follows the lifetime/settings described below. The required border lifetime for [exclusive control](spec.md#exclusive-control) is pending under #20/#31.

The independent Windows stop helper also draws Pi-branded screen edges, a status bar and a pointer tag. The screen border uses a per-pixel translucent blue falloff with a bright core, following the reference glow at 1.5 times its width: a 3-pixel core plus 27-pixel falloff at reference width scale 1, scaled by monitor width (clamped from 1 to 2). The separate Pi status bar and pointer tag retain their existing appearance. If frame preparation or presentation fails, that frame stays hidden and its error is reported until configuration or display layout causes a rebuild; the other indicators continue. It uses non-activating, disabled, layered windows; the pointer guard additionally skips the verified helper process if a Windows point-query API still returns an overlay. The tag follows the pointer, accounts for the current cursor bitmap size and stays inside its monitor's working area.

## Current operation lifetime

Arming the stop listener alone does not show indicators. Native pointer/text paths announce their first physical-input attempt only after target guards pass; background-only actions and browser calls do not start desktop indicators. Once started, presentation remains held through subsequent reads and model thinking in that computer-use operation. Individual input-completion events do not hide it. Final settlement schedules hiding after `indicatorIdleMs`; stopping hides it immediately. Thirty seconds without activity hides stale presentation, and subsequent physical input can show it again.

Settings come from the existing personal settings manager. Screen and pointer presentation are independent; disabling either or both never disables global stopping. Configured changes are applied to a running helper, including when a UIA request is blocked. Esc remains reserved and an extra Ctrl/Alt/Shift/Win shortcut can be configured. Injected and lower-integrity-injected keyboard events are ignored by the stop hook so an agent's Escape action can dismiss UI without stopping its own operation.

Own native screenshots/OCR suspend overlay windows and restore presentation in `finally`, retaining the armed stop event throughout. Remote/recording visibility selects Windows display affinity; helper status reports whether that call actually succeeded. Third-party capture behavior still requires manual validation.

## Preview and diagnostics

- `/computer-settings preview check` draws an offscreen sample and reports monitor layout/settings without displaying overlays or arming physical stopping.
- `/computer-settings preview` displays a two-second preview without input and without arming Esc. It does not modify saved preferences.
- `health` reports control-helper status only if already started; quiet health does not start overlays or a global listener.
- `npm run test:indicators` uses disposable Windows settings and exercises configuration, offscreen rendering, shortcut parsing, operation lifetime, capture suspension and disabled-indicator stopping without physical input.
- Set `PI_CU_ENABLE_INDICATOR_PREVIEW=1` for the same runner's brief visible show/hide, native hit-query and capture-suspension checks. Run live checks under `flock -w 120 /tmp/pi-cu-live-tests.lock` from WSL to avoid overlap with other desktop fixtures.

The updated glow border is source-reviewed. Portable checks, package validation and compilation of the Windows stop/indicator helper passed; the helper was not launched for these checks. A later opt-in Windows run passed visible edge/bar/pointer count, frame-error, screenshot-suspension, bar hit-query and hide checks on two monitors with owned process cleanup. This does not establish human visual appearance, edge click-through, alpha fidelity or third-party capture behavior. An earlier transient screenshot invalid-handle failure did not recur and its cause remains unknown. Automated protocol state and native window-query checks establish behavior, not human visual acceptance. Physical keys and mouse input are not emitted by this runner.

A later approximately ten-second preview used temporary settings and showed the expected frame and bar windows on two monitors across six status observations, with no frame errors; the disposable worker and settings were cleaned up and no input or screenshots were sent. The user confirmed that the blue border's appearance and thickness looked right. This does not establish edge click-through, alpha fidelity, third-party capture or real-control lifecycle. A separate read-only Windows hit-test placed a disposable topmost window at each monitor's top-left corner. At one point inside each visible edge, `WindowFromPoint` returned the disposable window both before and during the preview on both monitors; both frames and bars were visible with no frame errors. This samples two edge locations only; actual mouse delivery, remaining edge regions and pointer-tag pass-through remain unverified.

## Manual acceptance checklist

- [ ] Verify the required border and control acquisition/release in the [exclusive-control delivery cases](implementation-plan.md#exclusive-control-delivery); quiet-only UIA/browser work remains outside takeover.
- [ ] Verify border visibility through reads/thinking and idle periods, release before human handback, and reacquisition on explicit continuation. A stale-presentation timer must not silently hide active exclusive control.
- [ ] Press physical Esc and the configured extra shortcut while UIA is busy. Confirm suppression and held input are released and same-operation retries remain blocked; optional indicator settings must preserve the required local control border.
- [ ] Send an agent Escape action to a disposable dialog and confirm it does not trigger global stopping. Injected-key filtering is source/protocol checked automatically; this complete keyboard workflow remains unrun until dedicated-desktop acceptance.
- [ ] Click/drag beneath each overlay region and pointer tag on disposable fixtures. Verify focus/pointer restoration and absence of own-overlay occlusion errors.
- [ ] Change monitor arrangement, scaling and primary display; check edges, bar placement and the large-cursor tag on each display.
- [ ] Compare remote-desktop/screen-sharing/recording with visibility enabled and disabled; record Windows affinity status and actual capture behavior.
- [ ] Check native screenshot/OCR output excludes overlays and resumes them afterward without disarming stopping.

Mixed-DPI/display changes, physical stopping, actual click-through and third-party recording are pending manual acceptance until recorded; those checks are not inferred from settings persistence or preview status.

## Browser cues

Owned Chromium pages use a Pi favicon while active and a small page-coordinate click marker in an isolated, closed shadow root. The host is `aria-hidden` and every marker layer uses `pointer-events: none`. Native browser actions remain quiet: these page cues do not arm desktop stopping or show desktop overlays. Page screenshots hide the marker and restore it in `finally`; results report whether hiding was confirmed.

Visible owned Chromium processes receive a Pi-blue Windows 11 DWM **border** tint, without installing a browser extension or changing the user's daily browser theme. Only windows belonging to the retained Puppeteer child process are considered. Tab cues and owned-frame tint are removed/restored at operation settlement or stop. Cosmetic failures remain visible as presentation warnings rather than being misreported as successful decoration or replaying an action. Experimental Firefox has no browser presentation cues. External Chromium endpoints may receive page cues, but their browser frames are never tinted.

Headless browser fixtures verify badge/marker state, accessibility hiding, closed-shadow isolation, pointer pass-through, screenshot suspension and operation cleanup. Actual browser-border appearance and page-marker visibility still belong to manual visual acceptance.

![Offscreen native statusbar fixture](../assets/indicator-preview.png)

Offscreen native statusbar fixture; not full desktop acceptance.

A visible Edge fixture confirmed the owned DWM call accepted the border tint and the page/screenshot cue assertions passed. Its broader foreground-preservation assertion changed HWND across browser launch and is unresolved; this is not evidence of completed visual/focus acceptance. Headless action and cue lifecycle fixtures passed.
