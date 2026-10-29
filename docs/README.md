# Documentation index

Read the row matching the task; follow section links before reading whole documents.

| Task | Read |
| --- | --- |
| Requirements and scope | [Spec: solution](spec.md#solution), [user stories](spec.md#user-stories), [out of scope](spec.md#out-of-scope) |
| Implementation contracts | [Spec: implementation decisions](spec.md#implementation-decisions) |
| Delivery and feasibility | [Plan: detailed milestones](implementation-plan.md#detailed-milestones), [feasibility gates](implementation-plan.md#feasibility-gates) |
| Test design and release validation | [Spec: testing decisions](spec.md#testing-decisions), [plan: coverage matrix](implementation-plan.md#coverage-matrix) |
| Pi interfaces and sources | [Pi extension research](pi-extension-research.md) (research context; current spec takes precedence over earlier proposals) |
| Domain terminology | [Glossary](../GLOSSARY.md) |
| Why behavior parity was chosen | [ADR 0001](adr/0001-preserve-reference-behavior.md) |
| Publish or read issues | [Issue tracker](agents/issue-tracker.md), [triage labels](agents/triage-labels.md) |
| Implementation task graph | [Tickets](tickets.md) |
| Worker setup, protocol and test evidence | [Runtime and validation](runtime.md) |
| Stop command, listener and physical-input gate | [Stopping](stopping.md) |
| Desktop ownership and operation lifecycle | [Ownership](ownership.md) |
| Native window discovery and validation | [Windows discovery](windows.md), [accessibility observations](windows.md#accessibility-observations) |
| Browser read channel and fixtures | [Browser](browser.md) |
| Domain-document consumer rules | [Domain docs](agents/domain.md) |

## Repository layout

```text
README.md              project entry point
AGENTS.md              short contributor rules and routing
GLOSSARY.md            domain terms
src/                   flat TypeScript modules
tests/                 tests and native smoke fixtures
assets/                packaged resources and runtime notices
docs/
  README.md            this index
  spec.md              authoritative requirements
  implementation-plan.md  delivery, feasibility and coverage
  pi-extension-research.md  cited Pi interface research
  adr/                 durable decision rationale
  agents/              issue tracker, triage and domain configuration
```

Create source, test and asset directories with their first real files. Start with responsibility-named modules such as extension, launcher, worker, desktop, browser, settings and stop; split by demonstrated complexity rather than pre-creating a directory per module.
