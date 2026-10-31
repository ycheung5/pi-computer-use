---
status: accepted
---

# Bind observed targets to a window lifetime

The user chose stronger window-lifetime tracking beyond DSH's HWND/PID checks; this records the reviewed implementation design, not delivered feature acceptance. Keep the reference authority beside the existing native UIA cache, using a unique private window property as a lifetime witness; expose one opaque `windowRef` target field and retain raw selectors as explicit compatibility selection. This avoids a second registry and asynchronous event-delivery assumptions, at the cost of window-metadata writes, UIPI restrictions, conservative invalidation after native-child restart and possible scalar-marker residue after abrupt native-child exit.

The owned-window probe confirmed marker isolation, removal and replacement behavior; it did not achieve identical-HWND reuse. [UIA RuntimeIds can be reused](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationelement-getruntimeid), [WinEvent delivery can be asynchronous](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook), and [SetProp requires ownership hygiene and respects UIPI](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setpropw). Validation cannot atomically lock a foreign window through a later action; the contract rejects already-lost proof and prevents subsequent steps rather than promising to undo racing effects. Implementation and acceptance follow [the #28 plan](../implementation-plan.md#window-lifetime-design).

Unavailable binding leaves read metadata available without actionable native reference IDs. Existing desktop-image snapshots retain separate desktop provenance; stronger window identity does not change their image scope.
