# Attendance and DTR workspace prototype

Throwaway review artifact for [Prototype the Attendance and DTR workspace](https://github.com/systemeror12/lingkod-hr/issues/154), under [Map: resolve Phase 7 attendance and leave contracts](https://github.com/systemeror12/lingkod-hr/issues/156).

Status: awaiting developer review. No direction has been accepted.

## Question

Which workspace lets an Employee, supervisor and Attendance Administrator distinguish raw Attendance Events, calculated Attendance Days, correction review and approved DTR data?

## Run

From this prepared workspace, run `pnpm dev`, then open:

- [A: Exception review queue](http://localhost:3000/attendance-prototype?variant=A)
- [B: Attendance calendar](http://localhost:3000/attendance-prototype?variant=B)
- [C: DTR worksheet](http://localhost:3000/attendance-prototype?variant=C)

On another checkout, first complete README's “After pulling changes or switching machines” procedure and seed the protected shell with `pnpm --filter @lingkod-hr/database e2e:seed:shell`. The route uses the existing protected application shell and local OIDC login. The page returns not-found in production. Start with the existing local fixture user; the preview role selector only changes synthetic content, never the authenticated session.

Use the floating arrows or keyboard left/right to switch variants. Keyboard switching leaves form controls alone. The URL preserves the selected variant. All simulated actions live in memory and reset on reload.

## Variants

| Variant | Primary work surface | Tradeoff to review |
| --- | --- | --- |
| A: Exception review queue | Prioritized days beside persistent record detail | Makes corrective work prominent; gives less context across dates |
| B: Attendance calendar | Week with schedule, business and leave context above day detail | Makes the week easier to understand; takes more vertical space |
| C: DTR worksheet | Raw inputs, calculated status and DTR inclusion in columns | Supports reconciliation; requires more horizontal space |

The client shell, Noto Sans typography, cobalt actions and table density follow the existing application. The three layouts change information hierarchy rather than color.

## Review walkthrough

1. Start in A as Attendance Administrator. Open Tuesday's missing time-out. Compare raw events, contextual inputs, calculated day and DTR inclusion.
2. Add a review comment and request information. Switch to Employee and inspect the returned request. Resubmit the sample correction.
3. Switch back to Attendance Administrator and approve the correction. Observe that approval does not silently apply the correction or approve the Attendance Day.
4. Open DTR. Only approved sample days are included. Select “Ready to lock” to preview complete approval/certification, then lock the sample period. Use “Completed” to inspect the separately prepared locked fixture.
5. As Employee, toggle the Agency web-clock setting. Capture a sample event for 15 September. Historical sample rows do not change.
6. As Attendance Administrator, inspect Schedule and context and Manual entry. These are layout sketches; assignment drafts and manual receipts do not recalculate sample days.
7. Compare B and C with the same selected day. Inspect Employee, Supervisor and Attendance Administrator scopes. Only one synthetic Employee is provided; this does not assess large-roster performance.
8. Select Empty, Loading and Permission denied. Loading is a deliberate fixture, not a simulated network request; change the fixture to continue.

## Contract boundaries

- No hours, tardiness, undertime, absence precedence or payroll values are calculated. The exact schedule and holiday authorities remain inputs to [Define attendance calculation inputs](https://github.com/systemeror12/lingkod-hr/issues/157).
- Correction application, certification, locking, locked-period adjustments and official printable form requirements remain with [Define attendance finalization and correction contracts](https://github.com/systemeror12/lingkod-hr/issues/158). Locking here only demonstrates placement and feedback for a synthetic pre-certified period.
- The physical schema permits REOPENED periods and event voiding, while requirements emphasize immutable originals and linked adjustments. This prototype chooses no policy between those contracts.
- Schedule assignment, holiday applicability, official business and approved absence context are sketched without implementing their authoring workflows. Effective dates and prior versions are visible.
- Approved DTR data remains distinct from a review worksheet. This artifact is not an official printable form.
- Role controls preview product scope only. They do not implement permissions, change real Memberships or fetch real attendance data.
- Audit history, evidence and certification references are synthetic text. There is no file upload or real approval.
- No JO/COS self-service, biometric source, location capture, payroll computation or government rule is introduced.

## Validation

- Web package TypeScript check passed.
- Focused ESLint and Prettier checks passed.
- Compose services healthy; database migrations report no pending work.
- API, worker and local OIDC health checks passed.
- Protected login completed through HTTP redirects; dashboard and all three variant URLs returned 200 with prototype content.
- No browser automation or visual verification was performed. Client interactions need live developer review.

## Acceptance needed

Choose a primary layout, or identify parts to combine. Confirm whether the raw-event / calculated-day / approved-DTR distinctions are clear and whether each role's next action is obvious. Keep the decision ticket open until the developer accepts a direction. Any accepted result belongs in a resolution comment before production planning proceeds.
