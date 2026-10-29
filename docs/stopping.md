# Emergency stopping

Use `/computer-stop` to stop the current computer-use operation without waiting for a tool response. Pi cancellation also stops the operation. Queued calls are cancelled, active work is signaled, and subsequent calls in that operation are rejected with `COMPUTER_USE_STOPPED`. A model turn, retry or custom continuation does not reset stopping; a genuine new user run does.

## Independent Windows listener

A small separate Windows process installs a low-level keyboard hook. It is armed by the internal `prepare_input` request, not by quiet reads or browser work. Esc signals an operation-specific manual-reset Windows event directly, then notifies the worker. The listener never calls UI Automation and can signal while a native provider is blocked. Keyboard events continue to the target application; the hook does not swallow ordinary Esc behavior.

The explicit stop control bypasses the worker request queue. The worker blocks the operation before cleanup, signals its listener/event if armed, cancels active and queued requests and retires the read-only desktop bridge. Retirement waits for confirmed child exit; failure to confirm exit is an error, rather than permission to release ownership. Final settlement waits for this stop cleanup before releasing desktop ownership. Cancellation is not an instruction to replay any action.

## Physical input contract

This slice does not enable physical input. `prepare_input` reports the cancellation event and `inputReady: false`. Input actions remain gated until their implementation:

1. Arms the independent listener before sending input and checks the operation's cancellation event.
2. Checks cancellation between input steps and releases every held key/button in `finally`.
3. Confirms cleanup before retiring a native input bridge or releasing desktop ownership.
4. Handles listener failure and timeout without silently replaying input or claiming success.

A blocked read-only UIA/capture process can be killed after a bounded grace period. That policy alone is not proof of safe held-input cleanup; input tickets must supply dedicated fixture tests before removing their gate.

## Validation

- `npm test` covers a busy disposable protocol peer, queued cancellation, same-operation rejection, custom-continuation rejection, Pi abort, new-user recovery and confirmed retirement of an unresponsive peer.
- After `npm run build`, `npm run test:stop` verifies real Windows hook registration, named-event signaling through the normal stop control, worker rejection/recovery and the physical-input gate. It sends no keys or pointer input.
- Actual physical Esc stopping while a fixture is busy, and key/button cleanup during physical actions, remain manual/dedicated-desktop acceptance checks. Hook registration and explicit signaling are not reported as a physical-key test.
