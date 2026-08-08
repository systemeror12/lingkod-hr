# Development Workflow

## Scope

This workflow applies to the Philippine Public-Sector HRIS personal project.

Matt Pocock Skills define their own internal methods.

This file defines project-specific gates and handoffs.

The project uses:

- T3Code with Codex;
- GitHub Issues;
- GitHub Pull Requests;
- GitHub Actions;
- optional Hermes continuity.

## Project Sources

Use these files as primary project sources:

- `docs/mvp-brd.md` — business requirements and MVP scope;
- `docs/mvp-workflows.md` — business workflows;
- `docs/hris-controls.md` — roles, permissions, states, and controls;
- `docs/technical-architecture.md` — architecture and module rules;
- `docs/conceptual-erd.md` — conceptual data model;
- `docs/erp-ai-coding-practices.md` — coding and integrity rules;
- `docs/tech-stack-prerequisites.md` — development environment.

Read only the sources that apply to the task.

Do not invent public-sector business rules.

Use the project domain terms.

## Responsibilities

- Hermes creates optional request packets and status reports.
- `$ask-matt` selects a route and stops.
- Codex runs the selected skill.
- GitHub stores issues, pull requests, and CI state.
- The developer changes models, approves business decisions, merges, and deploys.

---

# 1. Receive a Request

A task can start from:

- a personal idea;
- a bug;
- a design document;
- a GitHub issue;
- a test failure;
- an architecture task.

For a small task, go directly to T3Code.

For a large request or cross-device context, use:

```text
/github-development-continuity
```

Hermes returns a short Codex request packet.

Hermes does not select the final Matt Pocock route.

---

# 2. Route the Request

Open T3Code at the repository root.

Use a new Codex thread.

Run:

```text
$ask-matt
```

Include the task or Hermes request packet.

`$ask-matt` must return:

```text
Route:
Model:
Reasoning:
Reason:
Next:
```

Then it must stop.

The route turn does not authorize:

- the selected skill;
- file changes;
- GitHub issue writes;
- branch changes;
- implementation;
- commits;
- pushes;
- pull-request creation.

Read:

```text
docs/agents/codex-routing.md
```

for the route gates and model policy.

---

# 3. Select the Model

Use these rules:

| Skill | T3Code model | Reasoning |
|---|---|---|
| `$grill-with-docs` | GPT-5.6 Sol | Keep current |
| `$grilling` | GPT-5.6 Sol | Keep current |
| `$wayfinder` | GPT-5.6 Sol | Keep current |
| `$implement` | GPT-5.6 Luna | Max |
| Other skills | Keep current model | Keep current effort |

Codex recommends the model.

The developer changes it in T3Code.

---

# 4. Plan the Work

For normal multi-session product work:

```text
$grill-with-docs
→ $to-spec
→ $to-tickets
```

Keep these planning steps in one T3Code thread when possible.

Use `$to-spec` and `$to-tickets` when the work requires more than one implementation session.

For small work, follow the route from `$ask-matt`.

For large and unclear work, `$ask-matt` can select:

```text
$wayfinder
```

When the wayfinder map becomes clear, continue to:

```text
$to-spec
→ $to-tickets
```

---

# 5. Handle Missing Business Decisions

Use:

```text
$to-questionnaire
```

when another person must answer a business question.

Examples:

- public-sector policy interpretation;
- approval responsibility;
- report definition;
- agency-specific behavior.

Use the completed answers in the planning flow.

---

# 6. Diagnose a Bug

When `$ask-matt` selects:

```text
$diagnosing-bugs
```

run it in the current diagnosis thread.

The diagnosis can:

- reproduce the failure;
- inspect the affected code;
- create a failing regression test;
- use temporary instrumentation;
- test hypotheses;
- confirm the root cause.

The diagnosis must stop before the production fix.

## Single-Slice Bug

Create one GitHub issue.

Then stop.

## Multi-Slice Bug

Return the diagnosis.

Run:

```text
$to-tickets
```

Create the required GitHub issues.

Then stop.

---

# 7. Start Implementation

Production implementation starts from a GitHub issue.

Open a fresh T3Code thread.

Select:

```text
Model: GPT-5.6 Luna
Reasoning: Max
```

Run:

```text
$implement <github-issue-url>
```

The implementation must:

- read the full issue;
- read the relevant project sources;
- read relevant ADRs;
- use project domain terms;
- stay inside issue scope;
- use TDD where suitable;
- run focused validation;
- run the required wider validation;
- run `$code-review`;
- commit the work.

Do not use the diagnosis thread as the implementation thread.

---

# 8. HRIS Integrity Gate

Before completion, check the controls that apply.

## Agency Isolation

Confirm that one Agency cannot access another Agency's protected data.

## Authorization

Check the required combination of:

- Agency membership;
- role;
- permission;
- record scope;
- workflow state;
- delegated authority when applicable.

## Workflow State

Use approved application services for state transitions.

Do not allow arbitrary status assignment.

## Audit

Material transitions must create the required audit record.

## Effective Dating

Preserve history when a rule or record must remain historically reproducible.

## Immutable Records

Do not directly edit finalized or ledger data.

Use the approved correction, reversal, adjustment, or replacement flow.

## AI

AI can propose, extract, summarize, or explain.

Deterministic application services validate and write authoritative results.

---

# 9. Create the Pull Request

Use GitHub Pull Requests.

Use one of these:

- T3Code GitHub controls;
- `gh pr create`;
- a project `$create-pull-request` skill.

Check for an existing pull request from the current branch.

Update it when one exists.

Do not create a duplicate pull request.

Use `Closes #N` only when the pull request fully completes the issue.

Use a non-closing reference for partial work.

Do not merge from the PR creation skill.

---

# 10. Run GitHub Actions

GitHub Actions validates the pull request.

Use repository scripts as the source for exact commands.

Typical validation areas are:

- lint;
- typecheck;
- unit tests;
- integration tests;
- E2E tests;
- build;
- OpenAPI validation;
- migration checks.

When CI fails:

1. Read the first useful error.
2. Classify the failure.
3. Fix the same branch.
4. Push the new commit.
5. Reuse the same pull request.

Do not create a duplicate issue or pull request for the same fix.

---

# 11. Merge

Before merge, confirm:

```text
[ ] Required GitHub Actions passed
[ ] Review is complete
[ ] The GitHub issue is fully covered
[ ] The closing reference is correct
[ ] High-risk HRIS checks are complete
```

The developer performs the merge.

GitHub closes the issue when the merged pull request contains a valid closing reference such as:

```text
Closes #123
```

Do not add post-merge acceptance-checkbox automation unless it solves a real project problem.

---

# 12. Use Hermes for Continuity

Use the GitHub-specific Hermes skill:

```text
/github-development-continuity
```

It can prepare:

- request packets;
- EOD reports;
- morning resumes;
- GitHub issue status;
- pull-request status;
- GitHub Actions status.

It stays read-only by default.

It does not replace Codex.

---

# 13. Work-State File

Use:

```text
.scratch/current-work.md
```

Suggested structure:

```markdown
# Active Work

## Ticket

- Issue:
- Title:
- Branch:
- State:

## Progress

### Completed

-

### Validation

-

### Blocker

-

### Next Action

-

## Pull Request

- URL:
- CI:
- Merge state:

## Updated

-
```

Git and GitHub are authoritative for work state.

---

# 14. Phase Boundaries

At a phase boundary, check in this order:

1. Continue.
2. Clear.
3. Handoff.
4. Subagent.
5. Compact.

Use `$handoff` when work moves to:

- another harness;
- another directory;
- another person;
- a separate side task.

Use a fresh T3Code thread for each implementation ticket.

---

# Standard Feature Flow

```text
Task
→ optional /github-development-continuity
→ T3Code
→ $ask-matt
→ route + model recommendation
→ stop
→ planning
→ GitHub Issue
→ fresh T3Code thread
→ GPT-5.6 Luna / Max
→ $implement <github-issue-url>
→ $code-review
→ GitHub Pull Request
→ GitHub Actions
→ developer merge
```

# Standard Bug Flow

```text
Bug
→ optional /github-development-continuity
→ T3Code
→ $ask-matt
→ $diagnosing-bugs
→ diagnosis
→ GitHub Issue
→ stop
→ fresh T3Code thread
→ GPT-5.6 Luna / Max
→ $implement <github-issue-url>
→ $code-review
→ GitHub Pull Request
→ GitHub Actions
→ developer merge
```
