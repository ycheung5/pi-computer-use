# Repository Guidelines

## Find context

Start with [docs/README.md](docs/README.md) and read only the sections relevant to the task. Requirements live in [docs/spec.md](docs/spec.md); delivery, feasibility and coverage live in [docs/implementation-plan.md](docs/implementation-plan.md). Consult [GLOSSARY.md](GLOSSARY.md) when using domain terms and relevant ADRs before changing their decisions.

## Structure

Application code lives in `src/`, tests in `tests/`, and packaged resources in `assets/`. Keep flat, responsibility-named modules; introduce subdirectories only when concrete complexity warrants them. Keep host-specific integrations separate from reusable logic.

Maintain the documentation index when adding or moving docs. Keep each requirement in the spec, delivery detail in the plan, and rationale in an ADR; link rather than duplicate.

## Development and validation

Introduce language-standard formatting, linting and tests alongside the first implementation. Check in configuration and the dependency lockfile; document clean installation, development, build, tests, formatting and linting commands in README.md. Use only configured commands.

Test external behavior, including failures, through the agreed interfaces. Keep tests deterministic and document live Windows prerequisites; run physical-input tests on a dedicated interactive desktop. See the plan's coverage matrix for release checks.

## Changes and configuration

Use concise imperative commit subjects and focused changes. PRs explain behavior, relevant issues and validation results; include screenshots for visible changes and note setup changes.

Keep credentials and local settings out of version control. Provide placeholder configuration and document required environment variables when introduced.

## Agent skills

### Issue tracker

GitHub Issues: ycheung5/pi-computer-use. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Use the five default triage labels. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single-context: root glossary and docs/adr/. See [docs/agents/domain.md](docs/agents/domain.md).
