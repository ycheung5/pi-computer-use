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
- The existing paired accessibility provider subset (`test:accessibility:report -- /path/to/reference --providers`) independently confirms the identified reader is alive after provider entry and absent after cancellation, before releasing its owned provider, followed by fresh-read recovery. This is native read-process cleanup, not held-input cleanup; see [provider evidence](validation.md#accessibility-comparison-evidence).
- Actual physical Esc stopping while a fixture is busy, and key/button cleanup during physical actions, remain manual/dedicated-desktop acceptance checks. Hook registration and explicit signaling are not reported as a physical-key test.

The [passive operation baseline](validation.md#passive-operation-evidence) records current results and reference source comparison. User-reported earlier Esc/command checks do not replace a recorded busy-input/held-key acceptance run. A rejected promise, hook registration or `cleanupConfirmed` alone cannot establish actual key/button release.

## Held-key acceptance boundary

Neither Pi nor DSH exposes a public key-down/hold/key-up operation; each `keypress` dispatches a complete chord. Observing a modifier up after cancellation does not establish that it was held when cancellation arrived. The existing Pi-only long-typing fixture also replaces the original clipboard without restoring it and is not a safe paired test for ordinary user data. A paired long-typing cancellation case needs an independently observed input-settlement boundary before retiring its worker or fixture: Pi abort rejection can precede worker cleanup, and the DSH MCP adapter has no equivalent verified cleanup event. If cleanup cannot be confirmed, retain the owned processes/files and report uncertainty instead of killing a possible input owner or replaying input. Real Esc/custom shortcut behavior requires the actual host and a dedicated session; MCP cancellation alone is not that evidence. See [dedicated session evidence](validation.md#dedicated-physical-comparison-evidence).

### Clipboard-free manual worker fixture

After `npm run build`, run `npm run test:stop:busy -- esc` on a dedicated, unlocked Windows desktop with `PI_CU_DEDICATED_INPUT_DESKTOP=1`. The runner waits up to two minutes at a start gate: once the user is ready, send `start` followed by Enter to the runner's stdin. After it reports typing has started, physically press Esc once within 40 seconds. Use `shortcut` instead of `esc` in a separate fresh run to test the fixture's isolated `Ctrl+Alt+F9` setting. Both indicators are disabled in the fixture settings. Do not operate the desktop during the run except for the requested key. The fixture never reads or changes the clipboard.

When stdout is buffered, set `PI_CU_STOP_STATUS_FILE` to a new, nonexistent file in a private Windows-readable directory before starting the runner. Its JSON `phase` changes from `setup` to `ready`, then `started`; monitor it independently and relay the key prompt when it reports `started`. The caller sends the stdin start command only after the user is ready. The runner refuses to overwrite an existing status file.

The runner observes the disposable editor, the worker stop event, rejection of the stopped operation, acknowledged operation settlement, stable partial text, and released mouse buttons, modifiers, Esc and F9. After settlement it polls key state for up to five seconds to allow the user to release the physical shortcut; keys still held after that period fail the check. A pass also requires the input result itself to report `COMPUTER_USE_STOPPED` with confirmed cleanup; a generic worker cancellation or other input error is inconclusive. It checks a subsequent new worker operation. If input settlement cannot be confirmed, it retains the fixture, worker and temporary files rather than terminating a possible input owner; manual investigation is required. A timeout sends the normal stop control once and remains a failed physical-key test. These results cover the Pi worker and listener, not a real Pi session, DSH host, or cancellation while a modifier is known held. `npm run test:stop:busy:check` checks the outcome evaluator without desktop input.
