# Pi Windows Computer Use

Native Pi tools for Windows desktop and browser automation from Windows or WSL2 Pi. **The integration is not release-accepted yet**: dedicated physical-input, visual and user acceptance checks remain pending. Follow the [task graph](docs/tickets.md) and [integration draft](https://github.com/ycheung5/pi-computer-use/pull/22).

## Requirements

- Default Pi; tested SDK/CLI **1.4.0**. No DSH or other Pi extension is needed.
- Windows 11 with an interactive desktop; WSL2 Ubuntu is the tested Linux host. WSL requires Windows executable interop, `cmd.exe` and `wslpath`.
- Windows PowerShell 5.1 and the built-in .NET Framework compiler/desktop assemblies for native helpers. No .NET SDK or separately installed Windows Node is required.
- Installed Chrome/Edge for browser tasks, or an explicitly selected installed Firefox-family browser (experimental). Dedicated automation profiles are used, not daily profiles.
- Available Windows OCR language support for OCR. A vision-capable Pi model is needed to interpret screenshots; no model or credentials are bundled.

Only Windows x64 has live evidence here; runtime digests exist for arm64 but that architecture remains unverified.

## Build and try this checkout

The source branch does not commit build output. With Node 22.19+ and npm:

```sh
npm ci --ignore-scripts
npm run build
pi -e .
```

To retain the built checkout as a local Pi package, run `pi install .` from that directory. `npm pack` builds a distributable tarball with runtime dependencies declared and assets included; an npm release has not been published. Installing raw GitHub source without first building is not a supported shortcut.

Ask Pi to call `windows_computer_use_health` to check its worker. The first computer-use call downloads a pinned, checksum-verified private Windows Node runtime from nodejs.org into `%LOCALAPPDATA%\pi-computer-use\runtime`. Later calls reuse the worker. Initial provisioning requires HTTPS access to nodejs.org; no global Node installation is changed.

Personal settings apply across projects and hosts. Use `/computer-settings show`, `/computer-settings edit`, or `/computer-settings set {"toolPreset":"lazy"}`. Use `/computer-stop` to stop an active operation; physical Esc is armed when physical input is used. See [settings](docs/settings.md), [stopping](docs/stopping.md) and [indicators](docs/indicators.md).

## Verify

```sh
npm run check
npm run test:package
```

Individual commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`, and `npm run lint:fix`. CI runs portable checks and package/documentation validation; it does not imply live Windows or manual acceptance.

For real Pi host, reference-schema and same-machine benchmark checks, use [release validation](docs/validation.md). Serialize live WSL tests with `flock -w 120 /tmp/pi-cu-live-tests.lock`; use dedicated disposable fixture windows and profiles. Physical runners require their documented opt-in on a dedicated interactive desktop. The older `native-text-physical.mjs` fixture replaces the existing clipboard without restoring it; use a disposable clipboard or the preservation-aware OLE runner, and do not run the older fixture against ordinary user work.

## Troubleshooting

- `WORKER_ASSET_MISSING`: build the checkout or use a built package.
- Runtime download/checksum failure: allow nodejs.org HTTPS; remove only the indicated corrupt private-runtime cache and retry on a trusted connection.
- `WSL_BOOTSTRAP_FAILED`: check Windows executable interop, `cmd.exe` and `wslpath`. Sandbox `UtilBindVsockAnyPort` refusal needs environment permission, not an application workaround.
- Native compiler/OCR unavailable: check Windows Framework/desktop components and OCR language support. Elevated/UAC/protected interfaces may be inaccessible; the extension does not bypass Windows protections.
- Desktop busy or stopped: finish/stop the owning operation, then provide new user input. Never bypass a refusal by changing tools or replay uncertain input.

Start with the [documentation index](docs/README.md) for task-specific context, [spec](docs/spec.md) for requirements and [plan](docs/implementation-plan.md#detailed-milestones) for delivery.
