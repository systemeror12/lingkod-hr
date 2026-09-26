# PROTOTYPE: LingkodHR design direction (throwaway)

Question: what should the rebuilt LingkodHR web client look like?

Verdict (2026-09-26): **variant B, "Enterprise workbench"**, with the shared
collapsible lifecycle nav (`lifecycle-nav.tsx`). A ("detail pane") and C
("folders & grid") were the final alternatives and were not chosen. Earlier
rounds rejected a command-palette desk, a 201-file dossier, and a calm
route-and-activity style.

This branch is the primary source for that decision. Do not merge it. Rebuild the
chosen design properly in production code; do not promote this code.

Run: `fnm use && pnpm prototype:design`, then open
`http://localhost:3000/prototype/design?variant=B` (←/→ switch variants,
`?screen=queue|employees|record`, `?nav=collapsed`). Screenshots: `screenshots/`.
