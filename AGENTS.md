### A note from Xenrya

I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

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

## Cross-machine setup gate

After any `git pull`, branch checkout, worktree handoff, or continuation from
another machine, complete the `After pulling changes` procedure in `README.md`
before investigating or changing application code. Treat a setup failure as
the first task.

The gate is complete only when all of these are true:

- the repository runtime is Node 24 from `.node-version` and dependencies match
  `pnpm-lock.yaml`;
- `.env` exists and contains every current key from `.env.example` without
  replacing existing local secrets;
- Docker Compose infrastructure is healthy;
- `pnpm db:migrate` succeeds and reports no pending migrations;
- no old LingkodHR process owns ports `3000`, `3001`, `3002`, or `4100` before
  starting a new dev stack;
- API, worker, and local OIDC health checks respond successfully;
- for protected browser or admin work, the protected-shell fixture has been
  seeded and `/dashboard` completes local OIDC login.

Do not work around a failed migration by deleting the database or migration
history. Diagnose ownership, environment, schema drift, or stale processes
first, then leave the setup reproducible for the next machine.

Use `$ask-matt` for Matt Pocock skill routing.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images. Motion or timing needs a short video.

## Global modal contract

Every blocking modal, detail dialog, confirmation, loading state, and form
dialog in the web UI uses the agreed global modal design. The source of truth
is `apps/web/src/components/ui/dialog.tsx`, grounded in GitHub issues #69 and
#70.

When implementing or changing a modal:

- Compose it from the shared `Dialog` primitives: `DialogTrigger`,
  `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`,
  `DialogBody`, `DialogFooter`, and `DialogClose` as applicable.
- Use the shared centered, responsive, safe-inset shell so the foundation
  owns the portal, backdrop, focus containment/restoration, Escape handling,
  and body scrolling.
- Keep workflow state, validation, loading, errors, and read-only content in
  the feature component; keep shell and accessibility behavior in the shared
  foundation.
- Treat a side panel, drawer, or sheet as an explicit product exception that
  must be named and justified by the issue or specification before coding.
- Add or update focused browser coverage for the accessible name/description,
  initial focus, focus containment/restoration, dismissal behavior, responsive
  centered geometry, and submission/loading guards that apply to the surface.

Completion means the surface consumes the shared foundation, has no custom
overlay or focus-trap shell, and its focused browser test plus before/after
visual evidence pass.

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
