# Desktop ownership

The Windows worker acquires an OS named mutex on the first desktop request in a computer-use operation. A separate small helper holds the mutex, so UI Automation work cannot block ownership control. The mutex is scoped to the Windows interactive session; both native Windows and WSL2 hosts use Windows workers and therefore contend for the same mutex.

Competing sessions receive `COMPUTER_USE_BUSY` immediately instead of queueing stale actions. The owning client's requests are serialized before execution deadlines start; queued cancellation does not send the cancelled request. A Windows mutex has no heartbeat expiry: a slow live owner is not displaced, and Windows releases the mutex when its owning thread/process exits. No filesystem lease is stolen based on elapsed time.

## Pi lifecycle

The extension assigns an operation identifier when a user run starts, retains it through model turns, low-level `agent_end` events and custom continuations, and sends the internal `operation_end` request at `agent_settled`. A new user run ends prior owned activity before starting another operation. Session shutdown disposes the worker and its helpers. Health does not acquire desktop ownership.

The internal worker envelope accepts an optional operation identifier; direct worker consumers without one use the worker's process-scoped operation. They must end the operation or dispose the worker to release ownership. This control is not an additional model-facing tool.

## Validation

- `npm test`: public worker-interface regressions prove serialized execution budgets and queued cancellation; a Pi-host protocol peer proves operation identity and settlement behavior. These portable tests do not establish real Windows mutex behavior.
- `npm run build` followed by `npm run test:ownership` from WSL2: real native Windows and WSL2 extension factories invoke their registered window-listing tools against distinct Windows workers. The test verifies busy rejection, retention across `agent_end`, settlement handoff, non-stealing of a live owner and recovery after killing the owning worker. It sends no physical input and operates on no application contents.
- Full Pi CLI acceptance remains a release check. Live testing requires WSL interop/Windows process access and the packaged private runtime.

## Before enabling physical input

Ticket #9 must connect independent emergency stopping and bounded native key/button cleanup to operation cancellation. Releasing ownership after a cancelled caller alone does not prove that an in-flight native input routine has finished cleanup. This slice exposes read-only tools; do not treat its mutex/caller cancellation checks as physical-input safety evidence.
