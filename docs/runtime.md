# Worker runtime and validation

## Current scope

The native Windows health tool and [window listing](windows.md) are implemented. Health checks the worker connection and reports platform, worker PID and Node version; it does not yet establish UIA/OCR/input capability. The same tools run from WSL2 using Windows executable interop. These read-only capabilities send no physical input.

## Runtime provisioning

The native launcher downloads Windows Node **22.23.4** for x64 or arm64 into `%LOCALAPPDATA%\pi-computer-use\runtime`. SHA-256 values are pinned from the [official release checksums](https://nodejs.org/dist/v22.23.4/SHASUMS256.txt). Downloads are bounded, cancellation-aware and installed atomically only after verification. Cached executables are verified before execution. Node's [license](../assets/node-LICENSE.txt) is included with the package.

A checksum mismatch fails explicitly; remove only the indicated runtime cache and retry from a trusted connection. HTTP failures identify nodejs.org as the required endpoint. Missing compiled worker files instruct checkout users to build. Unsupported hosts/architectures and missing Windows data directories fail without trying a different system runtime.

From WSL2, a bounded fixed-variable `cmd.exe /u /d` query discovers the Windows data directory and architecture. UTF-16LE decoding preserves Unicode, and environment values are never interpolated into commands. Discovery is shared with personal settings and cached for subsequent launcher calls. `wslpath` translates the mounted runtime cache and the compiled worker location, including WSL UNC paths. The launcher executes that same private Windows Node directly with argument arrays, keeping protocol stdout separate from bootstrap diagnostics; it never sends a Linux PID to a Windows process API. Windows executable interop and `cmd.exe`/`wslpath` must be available; browser discovery and some native fixtures also use Windows PowerShell. A failed bootstrap reports `WSL_BOOTSTRAP_FAILED` with its cause.

The runtime and worker start on first tool execution, not extension registration. Restoring tool exposure reads personal settings at session startup; in WSL2 this performs the small shared environment lookup but does not provision or start the worker. The cross-host settings fixture measured 39 ms for this first lookup on the tested host (a prior PowerShell query took about 1.2 seconds); this is measured overhead, not a zero-cost startup claim. The worker stays available until session shutdown/reload. Startup provisioning is cancelled on shutdown, even if a provider fails to observe the abort signal. Worker timeouts reject pending work and retire the worker; a later call can start a replacement. Input is never automatically replayed.

## Interfaces for implementation

The normal worker client interface is `execute(action, args, signal?)` and `dispose()`. The launcher supplies an executable, argument array and optional working directory. Transport is one JSON request/response per line, with numeric request IDs. Responses contain `result` with `ok`, `action` and action-specific evidence. Cancellation is a separate request carrying the cancelled ID. Stdout is protocol-only; diagnostics use stderr.

This read-only client does not yet implement desktop ownership or input-safe cancellation; those tickets must land before input tools are enabled. Keep future tests at the agreed Pi tool and worker request/cancellation interfaces.

## Verification

- `npm run check`: TypeScript, Biome and portable tests for tool execution, lazy reuse, disposal, startup cancellation, failed-start recovery, timeout non-replay and checksum rejection.
- `npm run build`: emits the extension and dependency-free worker modules.
- `npm pack --dry-run`: verifies the published manifest includes the built extension, worker and runtime license.
- `npm run test:wsl`: after building, run from WSL2. It copies the package to disposable WSL and Windows-drive locations containing spaces, Unicode and a quote, then executes the default tool factory through the Windows worker. It also checks active transport cancellation, timeout cleanup and abrupt Linux-parent exit. Like the native smoke, it models Pi registration rather than running an LLM-driven Pi CLI session. It sends no physical input.
- `npm run test:native`: after building, run with Windows Node in the package directory. It executes the default extension factory's health definition through the actual private Windows worker, checks PID reuse and verifies shutdown. Its minimal host harness models Pi registration; it is not an LLM-driven Pi CLI acceptance run.

Live evidence on 2026-10-29: Windows 11, x64, PowerShell 5.1; no Windows Node on PATH. A private bootstrap executable ran the compiled tool factory from a WSL UNC checkout, then the native launcher performed a cold checksum-verified download and returned health twice from one Windows worker. Shutdown and post-shutdown rejection passed. The test sent no desktop input. arm64 and clean-install/full Pi CLI acceptance remain unverified and are release checks, not inferred from this smoke result.

WSL2 live evidence on 2026-10-29: the health-tool smoke passed from both filesystem locations, preserving literal path characters. Repeated calls reused the Windows PID; disposal and abrupt parent exit left no worker process. A disposable Windows protocol peer proved active cancellation and timeout cleanup without input. Sandbox-restricted Windows launches require environment approval; the default sandbox `UtilBindVsockAnyPort` failure is an interop restriction, not an application failure. Full Pi CLI/clean-install acceptance and native input cancellation remain separate release checks.
