# Issue tracker: GitHub

Issues, specs, and tickets for this repo live in GitHub Issues for
`systemeror12/lingkod-hr`. Use the `gh` CLI, which infers the repo inside the clone.

## Operations

- **Read**: `gh issue view <n> --json number,title,body,labels,assignees,comments`.
- **List**: `gh issue list --state open --label <label> --json number,title,labels,assignees`.
- **Create**: `gh issue create --title "..." --body-file -`, with the body on
  stdin, so no draft file lands in the checkout.
- **Sub-issue**: `gh issue create --parent <parent> ...`, or
  `gh issue edit <child> --parent <parent>`.
- **Blocked by**: `gh issue edit <n> --add-blocked-by <blocker>`. A ticket is
  unblocked when every blocker is closed.
- **Claim**: `gh issue edit <n> --add-assignee @me`. An issue with an assignee
  is claimed.
- **Comment**: `gh issue comment <n> --body-file -`, with the body on stdin.
- **Label**: `gh issue edit <n> --add-label "..."` or `--remove-label "..."`,
  using the strings in `triage-labels.md`.
- **Close**: `gh issue close <n> --comment "..."`.

## Skill actions

- **Publish a spec** (`specs`): comment the spec on its source issue.
- **Publish tickets** (`to-tickets`): create one issue per ticket as a
  sub-issue of the source issue, then add each Blocked by as a dependency.
- **Claim a ticket** (`swarm-tickets`): assign it, as in Claim.
