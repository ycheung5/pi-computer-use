# Pi Windows Computer Use

A native Pi extension being built for Windows desktop and browser automation from native Windows and WSL2 Pi. Follow the [task graph](docs/tickets.md) and [integration draft](https://github.com/ycheung5/pi-computer-use/pull/22) for delivery and validation; the first release is not yet accepted.

Start with the [documentation index](docs/README.md). The [specification](docs/spec.md) records agreed requirements; the [implementation plan](docs/implementation-plan.md#detailed-milestones) describes delivery and validation.

## Development

Prerequisites: Node 22.19 or newer and npm. The tested Pi SDK is 1.4.0.

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

`npm test` runs portable public-interface tests using real subprocesses. `npm run typecheck`, `npm run lint`, `npm run format` and `npm run lint:fix` provide individual checks and formatting. A restricted environment may require permission for subprocess stdio; such a restriction is not a passing test.

Build distributable contents with `npm pack` (which builds first). On Windows or WSL2, try the built package in default Pi with `pi -e .`, or install the checkout with `pi install .`. The manifest loads the built extension; no other Pi extension or DSH installation is required.

The first `windows_computer_use_health` call downloads a private, pinned Windows Node runtime from nodejs.org, verifies its SHA-256 and starts a worker. Subsequent calls reuse it. The runtime is cached below `%LOCALAPPDATA%\pi-computer-use\runtime`; no global Windows Node installation or settings change is made. Initial provisioning requires HTTPS access to nodejs.org. See [runtime and testing](docs/runtime.md) for the protocol, diagnostics and live-check scope.

`windows_computer_use_list_windows` returns native identities, bounds and responsiveness without physical input. Its helper compiles once with Windows' existing .NET Framework compiler. See [Windows discovery](docs/windows.md) for options, failure behavior and `npm run test:native:windows` fixture prerequisites.

Guarded pointer checks: `npm run test:native:pointer:guards` sends no physical input. The opt-in `npm run test:native:pointer:physical` requires a dedicated interactive desktop and `PI_CU_DEDICATED_INPUT_DESKTOP=1`; see [pointer validation](docs/pointer.md). Physical acceptance remains pending.
Personal preferences are shared across projects and hosts. Use `/computer-settings show`, `/computer-settings edit`, or `/computer-settings set {"toolPreset":"lazy"}`. The management tool can describe and load capabilities allowed by the saved selection. See [settings and tool loading](docs/settings.md) for policy, recovery and validation.

Text checks: `npm run test:native:text` uses only passive fixtures. The opt-in `npm run test:native:text:physical` requires `PI_CU_DEDICATED_INPUT_DESKTOP=1` on a dedicated interactive desktop and mutates its clipboard; see [text validation](docs/text.md). Physical/clipboard acceptance remains pending.
