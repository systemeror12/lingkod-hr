## Project sources

Use these project documents as primary sources:

- `docs/mvp-brd.md` — business requirements and scope
- `docs/mvp-workflows.md` — business workflows
- `docs/hris-controls.md` — roles, permissions, states, and controls
- `docs/technical-architecture.md` — architecture and module rules
- `docs/conceptual-erd.md` — conceptual data model
- `docs/erp-ai-coding-practices.md` — coding and integrity rules
- `docs/tech-stack-prerequisites.md` — development environment

Read only the sources that apply to the task.

Do not invent public-sector business rules.

## Development workflow

Use `docs/development-workflow.md` for routing gates, GitHub ticket gates,
implementation, pull requests, GitHub Actions, and continuity.

Use `$ask-matt` for Matt Pocock skill routing.

## Codex routing

`$ask-matt` is routing-only.

When `$ask-matt` runs, return:

- route
- recommended T3Code model
- recommended reasoning effort
- one reason
- next command

Then stop.

Read `docs/agents/codex-routing.md`.

A production bug fix requires a GitHub issue before `$implement`.

## Hermes continuity

For this GitHub project, use:

`/github-development-continuity`

The skill is read-only by default.

## Agent skills

### Issue tracker

Issues live in GitHub Issues; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
