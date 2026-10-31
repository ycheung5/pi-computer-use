# Documentation index

Read the row matching the task; follow section links before reading whole documents.

| Task | Read |
| --- | --- |
| Requirements and scope | [Spec: solution](spec.md#solution), [user stories](spec.md#user-stories), [out of scope](spec.md#out-of-scope) |
| Implementation contracts | [Spec: implementation decisions](spec.md#implementation-decisions) |
| Delivery and feasibility | [Plan: detailed milestones](implementation-plan.md#detailed-milestones), [feasibility gates](implementation-plan.md#feasibility-gates) |
| Test design and release validation | [Spec: testing decisions](spec.md#testing-decisions), [plan: coverage matrix](implementation-plan.md#coverage-matrix) |
| DSH alignment, phased testing and agent recovery acceptance | [Current phases](implementation-plan.md#detailed-milestones), [baseline audit](validation.md#baseline-identity-and-schema-evidence), [guidance inventory](validation.md#model-visible-guidance-inventory), [scenario catalog](validation.md#alignment-scenario-catalog) |
| Release checks, capability coverage and pending acceptance | [Validation](validation.md) |
| Pi interfaces and sources | [Pi extension research](pi-extension-research.md) (research context; current spec takes precedence over earlier proposals) |
| Domain terminology | [Glossary](../GLOSSARY.md) |
| Why behavior parity was chosen | [ADR 0001](adr/0001-preserve-reference-behavior.md) |
| Publish or read issues | [Issue tracker](agents/issue-tracker.md), [triage labels](agents/triage-labels.md) |
| What works, remaining outcomes, next work and cleanup decisions | [Delivery map](tickets.md#delivery-outcomes-and-ownership), [execution queue](tickets.md#execution-queue), [cleanup dispositions](tickets.md#cleanup-dispositions), [original obligations](tickets.md#original-issue-disposition) |
| Worker setup, protocol and test evidence | [Runtime and validation](runtime.md) |
| Stop command, listener and physical-input gate | [Stopping](stopping.md) |
| Control indicators, preview and manual acceptance | [Indicators](indicators.md) |
| Desktop ownership and operation lifecycle | [Ownership](ownership.md) |
| Native window discovery and validation | [Windows discovery](windows.md), [accessibility observations](windows.md#accessibility-observations), [locked sessions](windows.md#locked-session-refusals) |
| Native interop alternatives and tradeoffs | [Native interop research](native-interop-research.md) |
| Guarded desktop pointer and dedicated input validation | [Pointer actions](pointer.md) |
| Text, chords, clipboard preservation and validation | [Text entry](text.md) |
| Personal settings, commands and tool loading | [Settings](settings.md) |
| Browser reads/actions, dedicated profiles, idle cleanup and fixtures | [Browser](browser.md) |
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

Use the existing source, test and asset directories. Keep responsibility-named modules such as extension, launcher, worker, desktop, browser, settings and stop; split by demonstrated complexity rather than pre-creating a directory per module.
