# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT.md` at the repo root.
- `docs/adr/` for ADRs that affect the area being changed.

If these files do not exist, proceed silently. The `domain-modeling` skill creates them lazily when domain terms or decisions are resolved.

## File structure

This repository uses a single-context layout:

```text
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-example-decision.md
│   └── 0002-another-decision.md
└── src/
```

## Use the glossary's vocabulary

When output names a domain concept, use the term defined in `CONTEXT.md`. Avoid synonyms that its glossary explicitly rejects.

If a needed concept is absent, reconsider whether the term belongs to the project or note the gap for `domain-modeling`.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding the decision.
