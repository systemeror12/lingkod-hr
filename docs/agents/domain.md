# Domain docs

The glossary and ADRs are source-of-truth docs. Read them before exploring
the code.

## Layout

- `GLOSSARY.md` at the root holds every domain term.
- `docs/adr/` holds every decision record.

## Reading rules

- **Missing files**: carry on without them. The `domain-modeling` skill
  writes the glossary and ADRs as terms and decisions settle.
- **Glossary terms**: name every domain concept with its glossary term, in
  issue titles, specs, tickets, tests, and code. The term replaces each
  synonym its entry lists under `_Avoid_`. A concept with no glossary entry
  is a gap: raise it with the user.
- **ADR conflicts**: when your output contradicts an ADR, name the ADR and say
  why it should be reopened.
