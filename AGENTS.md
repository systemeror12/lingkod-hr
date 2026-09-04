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

## Working defaults

- Run the smallest focused check that covers the change. Do not run the
  repository-wide test suite unless the user explicitly asks for it.
- Use shell commands and repo-native tools by default. Use computer-use or
  browser automation only when the user explicitly asks for it.
- Before finishing a task, terminate stale test processes running for this
  repository, including processes left by earlier test runs.
- Apply `$unslop-response` to every user-facing response.

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

## Agent skills

### Issue tracker

Issues live in GitHub Issues; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
