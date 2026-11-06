# Pi Windows Computer Use

Native Pi tools for Windows desktop and browser automation from Windows or WSL2 Pi. **Not released yet:** clean-install acceptance is user-deferred, and final release checks/user acceptance remain. Scoped functional acceptance and known limits are recorded. See [current progress](docs/tickets.md#current-progress) and [remaining work](docs/tickets.md#execution-queue).

## Requirements

- Default Pi; tested SDK/CLI **1.4.0**. No DSH or other Pi extension is needed.
- Windows 11 with an interactive desktop; WSL2 Ubuntu is the tested Linux host. WSL requires Windows executable interop, `cmd.exe` and `wslpath`.
- Windows PowerShell 5.1 and the built-in .NET Framework compiler/desktop assemblies for native helpers. No .NET SDK or separately installed Windows Node is required.
- Installed Chrome/Edge for browser tasks, or an explicitly selected installed Firefox-family browser (experimental). Ordinary requests use [Windows default-app and existing-window guidance](docs/windows.md#default-apps-and-workspaces); #30's scoped default-app/workspace/foreground acceptance is complete. The browser protocol channel uses dedicated automation profiles only when that workspace is explicitly selected.
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

## Install a built archive

For a prebuilt `pi-computer-use-0.1.0.tgz` produced by `npm pack`, extract it and install only runtime dependencies, then register the extracted directory with Pi:

```sh
mkdir pi-computer-use
tar -xzf pi-computer-use-0.1.0.tgz -C pi-computer-use --strip-components=1
cd pi-computer-use
npm install --omit=dev --omit=peer --ignore-scripts
pi install .
```

Pi supplies its SDK and TypeBox peers. The archive already contains compiled code; no TypeScript compiler is needed for this path. Keep the extracted directory while Pi references it. This is the prepared distribution procedure; clean-Windows acceptance remains deferred under #2. A registry package or GitHub release has not been published.

Personal settings apply across projects and hosts. Use `/computer-settings show`, `/computer-settings edit`, or `/computer-settings set {"toolPreset":"lazy"}`. Use `/computer-stop` to stop an active operation; physical Esc is armed when physical input is used. See [settings](docs/settings.md), [stopping](docs/stopping.md) and [indicators](docs/indicators.md).

## Verify

```sh
npm run check
npm run test:package
```

Plan the six opt-in scoped browser/mixed model tasks without a build or credentials using `npm run test:pi:browser -- --plan`. Live execution, prerequisites and retained-owner reports are documented in [release validation](docs/validation.md#reproduce-automated-checks).

Plan the scoped native visual task using `npm run test:pi:visual`. Explicit execution and retained-owner handling are documented in [scoped visual agent checks](docs/windows.md#scoped-visual-agent-check).

Run `npm run test:native:lifetime` on Windows after building for scoped owned-window lifetime checks; see [validation](docs/validation.md#window-lifetime-reference-acceptance).

Individual commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`, and `npm run lint:fix`. CI runs portable checks and package/documentation validation; it does not imply live Windows or manual acceptance.

For real Pi host and scoped live checks, use [release validation](docs/validation.md). Historical reference-schema/benchmark utilities are optional developer tools, not release prerequisites. Serialize live WSL tests with `flock -w 120 /tmp/pi-cu-live-tests.lock`; use dedicated disposable fixture windows and profiles. Physical runners require their documented opt-in and owned-target prerequisites. The legacy `native-text-physical.mjs` runner refuses execution because its fixture did not preserve clipboard/ownership correctly; use the preservation-aware OLE runner for supported clipboard checks. Scoped cancellation/control acceptance is complete; reuse its recorded evidence.

## License

Project code is [MIT licensed](LICENSE). Bundled runtime/dependency notices remain in [Node's license](assets/node-LICENSE.txt) and [Puppeteer's Apache-2.0 license](assets/puppeteer-LICENSE.txt); installed dependencies retain their own licenses. The [release audit](docs/validation.md#final-release-audit) records the tested versions and remaining release gates.

## Troubleshooting

- `WORKER_ASSET_MISSING`: build the checkout or use a built package.
- Runtime download/checksum failure: allow nodejs.org HTTPS; remove only the indicated corrupt private-runtime cache and retry on a trusted connection.
- `WSL_BOOTSTRAP_FAILED`: check Windows executable interop, `cmd.exe` and `wslpath`. Sandbox `UtilBindVsockAnyPort` refusal needs environment permission, not an application workaround.
- Native compiler/OCR unavailable: check Windows Framework/desktop components and OCR language support. Elevated/UAC/protected interfaces may be inaccessible; the extension does not bypass Windows protections.
- Desktop busy or stopped: finish/stop the owning operation, then provide new user input. Never bypass a refusal by changing tools or replay uncertain input.

Start with the [documentation index](docs/README.md) for task-specific context, [spec](docs/spec.md) for requirements and [plan](docs/implementation-plan.md#detailed-milestones) for delivery.
