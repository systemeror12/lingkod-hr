### A note from Xenrya

I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

## What makes LingkodHR special?

LingkodHR is a Philippine public-sector HRIS, not a private-sector HRIS with
different payroll deductions. Its lifecycle begins with an authorized agency
structure and vacant plantilla position, then continues through merit
selection, appointment, assumption to duty, personnel administration,
attendance, leave, payroll, SPMS, and separation.

Authority and history are part of the product model. Preserve effective-dated
records, immutable ledgers and finalized records, agency isolation, explicit
permissions, controlled approvals, traceable government forms and rules, and
complete audit history. AI assists users but never replaces human validation
or bypasses deterministic domain rules.

## Project glossary

Use this language in code, documentation, and conversation:

- **you** means the agent reading this file and changing LingkodHR.
- **I** means Xenrya or another LingkodHR developer speaking to you.
- **user** means a person using LingkodHR.
- **agent** means a coding agent run through Codex, OpenCode, or Claude Code.
  Depending on context, this can include you.
- **client** means the LingkodHR web application.
- **environment** means the runtime hosting LingkodHR and the machine,
  filesystem, provider credentials, and state it owns.
- **project** means an environment-local workspace record rooted at a
  directory.

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

## Three ways to hurt yourself

- **Killing by pattern.** Never use `pkill -f`, `pgrep | kill`, or kill a PID
  found by matching a process name, path, command, or worktree string. Capture
  PIDs for processes you start. For stale listeners on ports `3000`, `3001`,
  `3002`, or `4100`, use `ss -H -ltnp`, then confirm `/proc/<pid>/cwd` is this
  worktree before killing it. Before finishing, stop only test or development
  processes started by the task or confirmed through this port check.
- **Writing to developer state.** Treat `.env`, provider credentials, and the
  `postgres_data`, `redis_data`, and `seaweedfs_data` Docker volumes as live
  developer state. Do not delete, reset, clean, or overwrite them to fix a
  setup or test failure. Use migrations and the repository's documented seed
  and test commands.
- **Baking in origins.** Client components call relative `/api/v1/...` routes,
  and Next.js rewrites them to the server-side `API_URL`. Do not add absolute
  localhost API URLs or a public API-origin variable to client code. Server
  code may use the validated `API_URL` from `@lingkod-hr/config`.

## Working defaults

- Validate incrementally. While changing code, run focused tests and
  affected-package checks. For production implementation, run repository-wide
  validation once after the final code change; rerun it only after a relevant
  fix. For documentation-only changes, use focused checks unless the user asks
  for wider validation.
- Use shell commands and repo-native tools by default. Use computer-use or
  browser automation only when the user explicitly asks for it.
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

## Taste

- Keep transport and provider complexity in adapters. Keep orchestration free
  of I/O details and UI free of business rules.
- Prefer inferred types over redundant annotations. Use explicit types at
  public boundaries or when they improve clarity. Treat `any` as an escape
  hatch: use `unknown`, then narrow it.
- Put comments on APIs and functions when callers need usage context. Keep
  comments beside the code they describe; do not narrate line-by-line behavior.
- Users drive agents all day and notice dropped frames, lying spinners, and
  stale labels. Keep UI motion bounded, loading states truthful, and labels
  synchronized with their source data. Avoid continuously repainting
  animations that waste GPU time on high-refresh displays.
- If a rule here conflicts with the requested task, name the conflict and get
  explicit developer approval before breaking the rule.
- After the implementation tickets are done, **always** put the playwright
  test script on the chat to help the developers to test UI themselves.
  Example: pnpm --filter @lingkod-hr/web exec playwright test e2e/<test_name> --headed

## Agent skills

### Issue tracker

Issues live in GitHub Issues; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
