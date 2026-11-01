# Pi Computer Use

Computer use lets a Pi agent observe and operate Windows desktop applications and web pages.

## Language

**Native Windows host**:
An environment where Pi runs directly on Windows and controls that Windows desktop.

**WSL2 host**:
An environment where Pi runs inside Windows Subsystem for Linux 2 and controls the associated Windows desktop.

**Window lifetime**:
The period from a native window's creation until its destruction. A replacement window has a different lifetime even when the operating system reuses its numeric handle.

**Window reference**:
An observed identity bound to one window lifetime. A reference to an ended lifetime does not identify its replacement.

**Feature parity**:
Coverage of the agreed reference capabilities, including desktop and browser automation, settings, indicators and emergency stopping; experimental capabilities retain their experimental status.

**Desktop ownership**:
Exclusive permission for one Pi session to operate a Windows desktop during a computer-use operation, shared across native Windows and WSL2 hosts.

**Exclusive control**:
A period in which the agent operates the desktop and ordinary physical keyboard and mouse input is suppressed, while emergency stopping remains available.

**Human handback**:
A pause in automation during which exclusive control has ended and the user can interact normally. Resuming requires an explicit user continuation.

**Computer-use operation**:
A session's related computer-use activity across model turns until processing settles or the operation is stopped. Individual tool calls are steps within the operation.

**Emergency stop**:
A user request to stop active input and reject further actions in the stopped operation; it cannot undo actions already delivered to an application.
