# Issue tracker: GitHub

Issues and specs for this repo live in GitHub Issues at `s0ftnote/Waygoal`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- **Close an issue**: `gh issue close <number> --comment "..."`

Infer the repository from `git remote -v`; `gh` does this automatically inside this clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

The map is a single issue with child issues as tickets.

- **Map**: an issue labelled `wayfinder:map`, holding the Notes, Decisions-so-far, and Fog sections.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue. If sub-issues are unavailable, add it to a task list in the map body and put `Part of #<map>` at the top of the child body.
- **Ticket labels**: use `wayfinder:<type>`, where type is `research`, `prototype`, `grilling`, or `task`.
- **Blocking**: use GitHub’s native issue dependencies. If unavailable, put `Blocked by: #<n>, #<n>` at the top of the child body.
- **Frontier**: choose the first open, unblocked, unassigned child in map order.
- **Claim**: run `gh issue edit <n> --add-assignee @me`.
- **Resolve**: comment with the answer, close the issue, then append a concise conclusion and link to the map’s Decisions-so-far section.
