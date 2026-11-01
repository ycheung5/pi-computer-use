# Personal settings and tool loading

## Commands and storage

Use `/computer-settings` (or `edit`) to edit the personal settings JSON in Pi's editor. `show` reports the loaded values, notices and location; `set {"key":value}` merges a validated patch. Examples:

- `/computer-settings set {"toolPreset":"lite"}`
- `/computer-settings set {"toolPreset":"custom","enabledTools":["health","list_windows","find","screenshot","tools"]}`
- `/computer-settings set {"browserApp":"edge","browserVisible":false}`

The Windows-side file is `%LOCALAPPDATA%\pi-computer-use\settings.json`, shared across projects and native Windows/WSL2 hosts. A missing file uses explicit new-personal defaults. Malformed JSON, unreadable files or invalid numeric/text fields produce visible errors and block execution rather than pretend defaults were loaded. Unknown saved enum/switch choices are repaired in memory with notices; unknown tool names are dropped. User-entered values are validated strictly before atomic save. `PI_CU_SETTINGS_FILE` is an explicit alternate location used by disposable fixtures; ordinary users need no environment variable.

Settings writes are serialized behind active calls in each Windows worker and use a cross-process save lock plus atomic file replacement. Other workers apply the file at their next call boundary. Concurrent live saves receive `SETTINGS_BUSY` rather than overwrite each other silently. A settings change does not replay an action or clear a stopped operation. Session startup restores tool exposure by reading settings without starting the worker; WSL discovery is shared/cached with the launcher. See [runtime overhead](runtime.md#runtime-provisioning).

## Presets and management

`toolPreset` supports `full`, `lite`, `lazy`, `custom` and legacy `auto`. Full allows/loads implemented tools. Lite allows the reference common set: list windows, find, click, scroll, text, keypress, OCR, screenshot, wait-for, launch and management. Lazy allows all tools but initially loads only management. Custom uses `enabledTools` as both allowlist and initial selection. Legacy `auto` resolves to full when all names are selected, otherwise custom; the explicit preset takes precedence over legacy `mode`.

`windows_computer_use_tools` accepts `operation: list | describe | enable | disable | reset` and optional `names`. Names may be short or fully prefixed. Describe requires one name; enable/disable require names; `['*']` is supported only alone for enable/disable; reset takes no names. Every name is resolved before mutation, so a typo cannot partially alter the selection. Reset restores the saved startup preset. Temporary loading changes are scoped to the worker and do not rewrite personal settings.

The canonical catalog includes all 24 automation names plus management, with separate `available`, `allowed` and `enabled` fields. Capabilities not implemented in this build are explicitly unavailable; enabling them fails. Pi exposure changes only this extension's actually registered tools and preserves unrelated tools. Execution checks the Windows-side policy independently, so invoking a hidden or settings-disabled tool directly is still refused. Custom selection can disable management itself; recover through `/computer-settings set {"toolPreset":"full"}`. Persisted selection errors can be corrected in the displayed settings file when it cannot be parsed.

## Browser and presentation preferences

Defaults: browser-first routing, visible browser, Windows default browser preference, remembered sign-ins off; screen/pointer/remote indicators on; Pi-branded one-line indicator text, top position, 800 ms idle delay; extra stop shortcut empty (Esc remains reserved). App/visibility/profile changes close an idle owned browser before the next call reconnects, so refresh tab/element references afterward. Browser-first guidance is included with user-started Pi runs while respecting disabled navigation.

These are current-build settings semantics. The pending [exclusive-control contract](spec.md#exclusive-control) requires a local border regardless of optional presentation settings or idle timers. Stop shortcuts and presentation use the independent helper described in [indicators](indicators.md). Remembered sign-in behavior belongs to the dedicated browser-profile slice. A saved preference alone is not proof that a later capability is implemented. `indicatorIdleMs` is 200–3000, text is a trimmed single line up to 120 characters, and resume/preview tokens are nonnegative safe integers. Extra shortcuts accept Ctrl/Alt/Shift/Win plus one supported letter, digit, function or navigation key; modifiers are canonicalized and Esc cannot be replaced.

## Validation

`npm run check` includes worker policy and Pi command tests: persistence/reload, lazy/custom/full/lite transitions, invalid edits, repaired choices, malformed reads, all-or-nothing management, queued saves, disabled execution, and preservation of unrelated tools. Tests exercise the approved worker/Pi seams; they do not assert private implementation state.

After build, `npm run test:settings` runs from WSL2 and uses a disposable Windows-side settings file. A native Windows peer saves values that WSL Pi reads, then WSL's settings command saves values read by the Windows peer. It verifies lazy startup, tool denial, error visibility and literal Unicode/shell-character environment lookup. It never changes daily personal settings, browser profiles or physical input. Live evidence on 2026-10-29 passed on Windows 11 x64 with first shared settings discovery measured at 39 ms. Full Pi terminal editor interaction remains part of user acceptance testing; its host contract is automated here.
