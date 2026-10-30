# Emergency stopping

Use `/computer-stop` to stop the current computer-use operation without waiting for a tool response. Pi cancellation also stops the operation. Queued calls are cancelled, active work is signaled, and subsequent calls in that operation are rejected with `COMPUTER_USE_STOPPED`. A model turn, retry or custom continuation does not reset stopping; a genuine new user run does.

## Independent Windows listener

A small separate Windows process installs a low-level keyboard hook. It is armed by the internal `prepare_input` request, not by quiet reads or browser work. Esc signals an operation-specific manual-reset Windows event directly, then notifies the worker. The listener never calls UI Automation and can signal while a native provider is blocked. Keyboard events continue to the target application; the hook does not swallow ordinary Esc behavior. It also supports the personal extra shortcut and ignores injected keyboard events, so agent Escape actions do not stop themselves. See [indicator lifetime and preview](indicators.md).

The explicit stop control bypasses the worker request queue. The worker blocks the operation before cleanup, signals its listener/event if armed, cancels active and queued requests and retires the read-only desktop bridge. Retirement waits for confirmed child exit; failure to confirm exit retains the child handle and sticky failure, blocks replacement work and is not permission to release ownership. Worker stdin closure also retains ownership if prior stop cleanup was unconfirmed. Final settlement waits for this stop cleanup before releasing desktop ownership. Cancellation is not an instruction to replay any action.

## Physical input contract

Pointer and keyboard actions use the cancellation event and report `inputReady: true` with an explicit `readyActions` list. See [pointer guards](pointer.md) and [text/clipboard cleanup](text.md) for pending physical acceptance. Each enabled action must:

1. Arm the independent listener before sending input and checks the operation's cancellation event.
2. Check cancellation between input steps and releases every held key/button in `finally`.
3. Confirm cleanup before retiring a native input bridge or releasing desktop ownership.
4. Handle listener failure and timeout without silently replaying input or claiming success.

A blocked read-only UIA/capture process can be killed after a bounded grace period. Physical actions are implemented and advertised by `readyActions`; this is not proof that held keys/buttons are released correctly. Their dedicated interactive acceptance remains open.

## Validation

- `npm test` covers a busy disposable protocol peer, queued cancellation, same-operation rejection, custom-continuation rejection, Pi abort, new-user recovery and confirmed retirement of an unresponsive peer.
- After `npm run build`, `npm run test:stop` verifies real Windows hook registration, an initially unsignaled kernel event, signaling through the normal stop control, a distinct unsignaled event for the next operation, and worker rejection/recovery and a deliberately invalid pointer target refusal. It sends no keys or pointer input.
- The existing paired accessibility provider subset (`test:accessibility:report -- /path/to/reference --providers`) independently confirms cancellation retires the identified blocked reader before releasing its owned provider, followed by fresh-read recovery. This is native read-process cleanup, not held-input cleanup; see [provider evidence](validation.md#accessibility-comparison-evidence).
- Actual physical Esc stopping while a fixture is busy, and key/button cleanup during physical actions, remain manual/dedicated-desktop acceptance checks. Hook registration and explicit signaling are not reported as a physical-key test.

The [passive operation baseline](validation.md#passive-operation-evidence) records current results and reference source comparison. User-reported earlier Esc/command checks do not replace a recorded busy-input/held-key acceptance run. A rejected promise, hook registration or `cleanupConfirmed` alone cannot establish actual key/button release.
