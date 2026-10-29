# Worker runtime and validation

## Current scope

The native Windows health tool is implemented. It checks the worker connection and reports platform, worker PID and Node version; it does not yet establish UIA/OCR/input capability. WSL2 launcher integration is the next host ticket. No physical input is sent by this slice.

## Runtime provisioning

The native launcher downloads Windows Node **22.23.4** for x64 or arm64 into `%LOCALAPPDATA%\pi-computer-use\runtime`. SHA-256 values are pinned from the [official release checksums](https://nodejs.org/dist/v22.23.4/SHASUMS256.txt). Downloads are bounded, cancellation-aware and installed atomically only after verification. Cached executables are verified before execution. Node's [license](../assets/node-LICENSE.txt) is included with the package.

A checksum mismatch fails explicitly; remove only the indicated runtime cache and retry from a trusted connection. HTTP failures identify nodejs.org as the required endpoint. Missing compiled worker files instruct checkout users to build. Unsupported hosts/architectures and missing Windows data directories fail without trying a different system runtime.

The runtime and worker start on first tool execution, not extension registration. The worker stays available until session shutdown/reload. Startup provisioning is cancelled on shutdown, even if a provider fails to observe the abort signal. Worker timeouts reject pending work and retire the worker; a later call can start a replacement. Input is never automatically replayed.

## Interfaces for implementation

The normal worker client interface is `execute(action, args, signal?)` and `dispose()`. The launcher supplies an executable, argument array and optional working directory. Transport is one JSON request/response per line, with numeric request IDs. Responses contain `result` with `ok`, `action` and action-specific evidence. Cancellation is a separate request carrying the cancelled ID. Stdout is protocol-only; diagnostics use stderr.

This health-only client does not yet implement desktop ownership or input-safe cancellation; those tickets must land before input tools are enabled. Keep future tests at the agreed Pi tool and worker request/cancellation interfaces.

## Verification

- `npm run check`: TypeScript, Biome and portable tests for tool execution, lazy reuse, disposal, startup cancellation, failed-start recovery, timeout non-replay and checksum rejection.
- `npm run build`: emits the extension and dependency-free worker modules.
- `npm pack --dry-run`: verifies the published manifest includes the built extension, worker and runtime license.
- `npm run test:native`: after building, run with Windows Node in the package directory. It executes the default extension factory's health definition through the actual private Windows worker, checks PID reuse and verifies shutdown. Its minimal host harness models Pi registration; it is not an LLM-driven Pi CLI acceptance run.

Live evidence on 2026-10-29: Windows 11, x64, PowerShell 5.1; no Windows Node on PATH. A private bootstrap executable ran the compiled tool factory from a WSL UNC checkout, then the native launcher performed a cold checksum-verified download and returned health twice from one Windows worker. Shutdown and post-shutdown rejection passed. The test sent no desktop input. arm64 and clean-install/full Pi CLI acceptance remain unverified and are release checks, not inferred from this smoke result.
