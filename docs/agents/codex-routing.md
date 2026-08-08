# Codex Routing Policy

## Scope

This policy applies to the Philippine Public-Sector HRIS personal project.

The project uses:

- T3Code;
- Codex;
- Matt Pocock Skills;
- GitHub Issues;
- GitHub Pull Requests;
- GitHub Actions.

## Routing Gate

`$ask-matt` selects a route.

It does not execute the route.

When `$ask-matt` runs:

1. Read the request.
2. Read only the needed project context.
3. Select one Matt Pocock route.
4. Recommend the T3Code model.
5. Recommend the reasoning effort.
6. Give one short reason.
7. Give the next command.
8. Stop.

Use this format:

```text
Route: `$skill-name`
Model: <model or Keep current model>
Reasoning: <effort or Keep current effort>
Reason: <one short sentence>
Next: <one command or action>
```

The routing turn must not:

- invoke the selected skill;
- edit files;
- create or update a GitHub issue;
- change a branch;
- implement code;
- commit;
- push;
- create a pull request.

## Model Policy

| Skill | Model | Reasoning |
|---|---|---|
| `$grill-with-docs` | GPT-5.6 Sol | Keep current |
| `$grilling` | GPT-5.6 Sol | Keep current |
| `$wayfinder` | GPT-5.6 Sol | Keep current |
| `$implement` | GPT-5.6 Luna | Max |
| Other skills | Keep current model | Keep current effort |

Codex recommends the model.

The developer changes the model in T3Code.

Codex must not claim that it changed the model.

## Bug Diagnosis Gate

`$diagnosing-bugs` ends at a confirmed diagnosis and GitHub ticket creation.

It does not apply the production fix.

### Allowed diagnosis work

Codex can:

- inspect code;
- inspect safe development data;
- run existing tests;
- add temporary instrumentation;
- create a failing regression test;
- reduce the reproduction;
- test hypotheses;
- identify the root cause.

### Completion Gate

Stop when these items exist:

- reliable reproduction;
- tight failing command;
- confirmed root cause;
- affected code path;
- expected correction;
- regression acceptance criteria.

Do not change production code to make the failing test pass.

Do not commit the fix.

### Single-Slice Bug

Create one GitHub issue.

The issue must contain:

```markdown
## Problem

[User-visible problem.]

## Reproduction

[Smallest reliable reproduction.]

## Root Cause

[Confirmed cause.]

## Expected Behavior

[Required behavior.]

## Acceptance Criteria

- [ ] [Observable criterion]
- [ ] [Regression criterion]

## Validation

- Failing command: `[command]`
- Current result: [result]

## Source References

- BRD:
- Workflow:
- Controls:
- Architecture:
- ADR:

## Out of Scope

- [Explicit exclusion]
```

Use the GitHub issue tracker configuration created by `$setup-matt-pocock-skills`.

After issue creation, stop.

### Multi-Slice Bug

If the diagnosis requires more than one independent implementation slice:

1. Return the diagnosis.
2. Recommend `$to-tickets`.
3. Stop.

`$to-tickets` creates the GitHub issues.

## Implementation Gate

Production behavior changes require a GitHub issue when they affect:

- public-sector business behavior;
- permissions;
- workflow states;
- Agency isolation;
- persistence;
- payroll;
- leave or COC ledgers;
- audit;
- AI authoritative boundaries;
- more than one implementation session.

A small documentation or local-tooling change can proceed without an issue when it does not change authoritative behavior.

Implementation starts in a fresh T3Code thread.

Select:

```text
Model: GPT-5.6 Luna
Reasoning: Max
```

Run:

```text
$implement <github-issue-url>
```

## Planning Example

```text
Route: `$grill-with-docs`
Model: GPT-5.6 Sol
Reasoning: Keep current effort
Reason: The business rules need an interview.
Next: Change the T3Code model, then run `$grill-with-docs`.
```

## Bug Example

```text
Route: `$diagnosing-bugs`
Model: Keep current model
Reasoning: Keep current effort
Reason: The root cause is not confirmed.
Next: Run `$diagnosing-bugs`.
```

## Implementation Example

```text
Route: `$implement`
Model: GPT-5.6 Luna
Reasoning: Max
Reason: The GitHub issue is ready for implementation.
Next: Change the T3Code model, then run `$implement <github-issue-url>`.
```
