# Pi extension integration research

Checked 2026-10-29. This document records verified interfaces separately from proposed design choices. It does not claim that desktop behavior has been tested.

## Version and identity

The local installed package is `@earendil-works/pi-coding-agent` **1.4.0**, under `/home/ycheung5/.nvm/versions/node/v22.20.0/lib/node_modules/`. Its installed declaration files were checked against the official source. Current package metadata uses the `@earendil-works` namespace and identifies `earendil-works/pi` as the repository; older `badlogic/pi-mono` links still expose the project. Implementation should target the installed version rather than assume older tutorials match. [Official package metadata](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json)

## Verified extension interfaces

- An extension exports a default factory receiving `ExtensionAPI`. TypeScript loads without a separate compilation step. Register long-lived resource cleanup with `session_shutdown`; start processes lazily or during `session_start`, rather than inside the factory. Legacy `@mariozechner/*` imports remain mapped, but new code can use current names. [Extension documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- `pi.registerTool()` accepts a name, label, description, TypeBox parameter schema, and `execute(toolCallId, params, signal, onUpdate, ctx)`. The optional `executionMode: "sequential"` requests serialization with other calls. `ctx.abort()` aborts the current operation. Tool exposure and activation are separate concepts; `setActiveTools()` changes declarations and does not make deferred tools uncallable. [Extension types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)
- Pi also exposes `registerMcpServer()`, `unregisterMcpServer()`, and `getMcpServers()`. An extension can therefore register the reference's standalone stdio server as an incremental migration path. [MCP registration interface](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)
- A tool result has model-facing `content` and rendering/state `details`. It may additionally carry `structuredContent`, `isError`, and `terminate`. Error text alone does not signal failure: throw or return `isError: true`. Partial updates use the same result shape. `terminate` is a batch-level hint, effective only when every finalized result in that batch terminates. [Agent result contract](https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts)
- `content` supports images with `{ type: "image", data, mimeType }`; `data` is base64. Thus screenshots can accompany textual window/coordinate metadata without inserting base64 into text. Actual visual reasoning still depends on the selected model. [Image content definition](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts)

## Verified lifecycle and packaging

`agent_end` is not the final idle notification: retries or queued work can start another run. `agent_settled` represents final settlement. `turn_end` is one assistant response plus its tools, not an entire user task. Session replacement and reload invoke shutdown, followed by startup for the replacement runtime. Tool execution events include terminal outcomes even when execution was blocked or aborted. The documentation explicitly demonstrates checking the tool's abort signal and passing it to subprocess work. [Lifecycle and tool documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)

A package can declare `"pi": { "extensions": ["./src/extension.ts"] }`. Test a local entry with `pi -e`; install a directory with `pi install ./local-package`. Published runtime dependencies belong in `dependencies`; host-provided Pi packages and TypeBox belong in peer dependencies, not bundled runtime copies. Project-local package loading follows project trust. [Package documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)

The official tool-selector example uses `getAllTools()`, `getActiveTools()`, and `setActiveTools()`. It persists selection with `appendEntry()` and restores state from the current branch on `session_start` and `session_tree`. [Tool-selector example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/tools.ts)

## Recommendations for this project

These are design proposals, not guarantees supplied by Pi:

1. Use native Pi tools backed by a host-independent Windows engine. MCP is optional transport, rather than a required intermediary for every desktop call.
2. Keep an engine queue despite Pi's sequential tool setting: commands, native stop events, and separate Pi processes are outside that tool batch. Add desktop ownership across processes.
3. Connect each tool's abort signal to queued-request cancellation and native cooperative stopping. Keep the independent Windows stop helper; terminal shortcuts are insufficient when another app has focus.
4. Maintain an explicit operation identifier spanning model turns. End indicators on settlement and shutdown; block further actions after emergency stop until a new user operation. Do not reset stop state merely at `turn_end`.
5. Return compact model-readable evidence and typed metadata; use images only for screenshot payloads. Preserve `sent` versus `observed` verification.
6. Treat settings-based tool denial as engine policy. Merely hiding a declaration is not an authorization mechanism.

## Proposed implementation shape and milestones

```text
Pi extension (tools, commands, status, lifecycle)
  -> DesktopRuntime (execute(request, signal), dispose())
     -> Windows worker transport -> UIA/native automation
     -> independent emergency-stop helper
     -> browser adapter (later milestone)
```

`DesktopRuntime` should hide queueing, ownership, worker recovery, target validation, and evidence normalization. The Pi adapter should translate host events and results without implementing Windows behavior. Registering the existing MCP server is a useful baseline for comparison, but does not carry over DSH's adapter-level conversation ownership or operation tracking.

Suggested milestones:

1. Establish the TypeScript package, worker protocol, ownership rules, and deterministic lifecycle/cancellation tests.
2. Deliver Windows observation and guarded actions: windows, snapshots, screenshots/OCR, element actions, typing, and verification. Carry over applicable MIT notices when reusing code.
3. Exercise real Windows fixtures, emergency stop, queue cancellation, worker timeouts, clipboard restoration, and multi-process ownership.
4. Add dedicated browser automation and optional MCP transport after the desktop contract is stable.

## Remaining validation

Recommend native Windows Pi as the first supported configuration. This workspace runs under WSL2 (verified from `/proc/sys/kernel/osrelease`) and exposes Windows `powershell.exe` through `/mnt/c/`; path conversion, process lifecycle, and desktop access remain unverified. Before implementation, define engine ownership and shutdown deadlines, and confirm the chosen image model's screenshot behavior. Test cancellation while queued, during real input, on reload, and after worker failure. No Pi settings or installed extensions were changed during this research.
