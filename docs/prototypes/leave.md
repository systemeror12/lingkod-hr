# Leave workspace prototype

Review artifact for [Prototype the Leave workspace](https://github.com/systemeror12/lingkod-hr/issues/155), under [Map: resolve Phase 7 attendance and leave contracts](https://github.com/systemeror12/lingkod-hr/issues/156).

This revision follows the developer-approved Tree/Form/Kanban pattern from [Prototype the Attendance and DTR workspace](https://github.com/systemeror12/lingkod-hr/issues/154): Tree is the default register, rows and Kanban cards open the same Form, and the Form separates the application lifecycle from effective ledger changes. The developer accepted this revision on 15 September 2026; the canonical decision is recorded in the [resolution comment](https://github.com/systemeror12/lingkod-hr/issues/155).

## Run

Run `pnpm dev` from this workspace, then open [Leave](http://localhost:3000/leave-prototype?view=tree). If the initial OIDC login lands on Dashboard, open the link again.

On another checkout, complete README's setup procedure first and seed the protected shell with `pnpm --filter @lingkod-hr/database e2e:seed:shell`.

The existing protected application shell remains in place. The route returns not-found in production. All leave records and actions are synthetic and reset on reload.

## Standard views

- Tree is the default. One row represents one leave application: reference, Employee, leave type, dates, days, status, the role holding the pending action, and its ledger effect.
- Form opens from a Tree row or Kanban card. It has record navigation and Application, Credits, Decisions and History tabs. Preparing leave, evidence and deficiencies, credit certification, the decision route and cancellation are separated within the record.
- Kanban groups the same filtered applications by status. Cards open the same Form; there is no drag-to-approve behavior.

Sections cover Leave applications, Leave credits, Monetization, Mandatory leave and Leave policy, filtered by preview role. The URL holds the view and selected record using the existing `useRecordNavigation` helper.

## Application is not a ledger change

- The Tree ledger column shows `Posted · USED` only for posted applications and `None — not posted` otherwise.
- An approved but unposted application (`LV-2026-029`) shows no deduction; posting is a separate Leave Administrator action.
- Credits lists posted balances and pending applications in separate columns.
- Cancelling a posted application shows the original USED entry retained with reversal pending.
- Reservation and available-balance arithmetic are deliberately absent because they await the credit contract.

## Review walkthrough

1. As Employee, open Tree and select the draft `LV-2026-022`. Add the sample medical certificate, save the draft, check eligibility and submit.
2. Open `LV-2026-026` and inspect the returned deficiency, then resubmit after attaching evidence.
3. Switch to Leave Administrator. Certify credits on `LV-2026-023`, request information where required, and post the approved `LV-2026-029`.
4. Switch to Supervisor and recommend on `LV-2026-024`; switch to Approving Official and decide `LV-2026-025`. Inspect Credits and Decisions tabs on each record.
5. Request cancellation on the posted `LV-2026-021`, then decide it as Approving Official.
6. Inspect Leave credits, Monetization, Mandatory leave and Leave policy as Leave Administrator.
7. Preview Empty, Loading, Permission denied, Returned, Cancellation requested and Completed through the collapsed prototype controls.

## Contract boundaries

- The choice of Tree/Form/Kanban and tab split does not establish government rules or finalize leave contracts.
- Leave types, eligibility, accrual, retention, mandatory-leave conditions and available-balance arithmetic remain with [Define leave policy and credit contracts](https://github.com/systemeror12/lingkod-hr/issues/159).
- Routing, evidence requirements, certification meaning, cancellation and posting prerequisites remain with [Define leave application and approval contracts](https://github.com/systemeror12/lingkod-hr/issues/160).
- Posting effects on payroll, monetization payout and terminal-leave inputs remain with [Define leave financial handoffs](https://github.com/systemeror12/lingkod-hr/issues/161).
- Terminal-leave input preservation is shown as a sketch only; full retirement-benefit computation stays outside MVP.
- Certification or approval does not deduct credits; only a posted application creates a USED ledger entry. Approving a sample decision does not persist anything.
- Government form mapping follows the prior official-form decision and is not restated here.
- JO/COS self-service, real evidence upload, permissions, audit logging and approval routes are outside the prototype.

## Validation

Web TypeScript, focused ESLint and formatting checks pass. Authenticated HTTP requests return Tree, Form and Kanban content with the expected register, record and board markup. Browser interactions and visual acceptance remain for live review.
