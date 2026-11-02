---
status: accepted
---

# Follow Windows defaults and reuse the user's workspace

On 2026-11-02 the user chose Windows default apps and a new task tab/document in the intended existing window, with coherent foreground handling, because separate browser launches and repeated focus changes disrupted normal use. This supersedes the specification's dedicated-browser-profile default: existing profile acceptance remains valid for the explicit dedicated mode, while ordinary-app reuse may require native UI rather than the current browser protocol channel. Requirements live in the [spec](../spec.md#default-apps-workspaces-and-foreground); #30 owns implementation and acceptance, with editor-focus behavior shared with #26.
