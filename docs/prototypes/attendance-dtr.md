# Attendance and DTR workspace prototype

Review artifact for [Prototype the Attendance and DTR workspace](https://github.com/systemeror12/lingkod-hr/issues/154), under [Map: resolve Phase 7 attendance and leave contracts](https://github.com/systemeror12/lingkod-hr/issues/156).

The developer rejected the three custom layout recommendations and requested the established Tree/Form/Kanban pattern used for record work. This revision follows Recruitment's record navigation, view selector, table density and Kanban presentation. The developer approved this revision on 15 September 2026. The canonical decision is recorded in the [resolution comment](https://github.com/systemeror12/lingkod-hr/issues/154#issuecomment-5673624476).

## Run

Run `pnpm dev` from this prepared workspace, then open [Attendance](http://localhost:3000/attendance-prototype?view=tree). If the initial OIDC login lands on Dashboard, open the link again.

On another checkout, complete README's setup procedure first and seed the protected shell with `pnpm --filter @lingkod-hr/database e2e:seed:shell`.

The existing protected application shell remains in place. The route returns not-found in production. All attendance records and actions are synthetic and reset on reload.

## Standard views

- Tree is the default. One row represents one Employee's Attendance Day. Columns show work date, Employee, schedule/context, status, exception and DTR inclusion. Search and status filters select records.
- Form opens from a Tree row or Kanban card. It has record navigation and Attendance day, Correction and History tabs. Raw events, contextual inputs, calculated result and DTR inclusion are shown separately within the record.
- Kanban groups the same filtered Attendance Days by their existing status. Opening a card opens its Form. It does not add drag-to-approve behavior.

The URL holds the view and selected record using the existing `useRecordNavigation` helper. The floating variant selector and A/B/C layouts have been removed. Preview role and state controls are collapsed below the workspace.

## Review walkthrough

1. Open Tree, filter by EXCEPTION, and open 8 September.
2. Inspect Attendance day, then Correction. Enter a review comment and request information.
3. Expand the prototype controls below the workspace and switch to Employee. Inspect and resubmit the correction. Switch back to Attendance Administrator to review it.
4. Use the Tree/Form/Kanban selector and Form's Previous/Next controls. Confirm record navigation matches the expected workflow.
5. Open DTR. Only approved sample days are included. Select the Ready to lock fixture to preview complete approval/certification, then lock the sample period. Completed shows a prepared locked fixture.
6. Inspect Schedule and context and Manual entry as Attendance Administrator. These are layout sketches, not persisted changes.
7. Preview Employee and Supervisor scope, optional web clock, Empty, Loading, Permission denied and Returned states through the collapsed prototype controls.

## Contract boundaries

- The choice of Tree/Form/Kanban does not establish government rules or finalize attendance contracts.
- No hours, tardiness, undertime, absence precedence or payroll values are calculated. Schedule and holiday authorities remain with [Define attendance calculation inputs](https://github.com/systemeror12/lingkod-hr/issues/157).
- Correction application, certification, locking, locked-period adjustments and official printable form requirements remain with [Define attendance finalization and correction contracts](https://github.com/systemeror12/lingkod-hr/issues/158).
- Approving a sample correction does not apply it or approve the Attendance Day. Completed results are separate fixtures.
- The physical schema permits REOPENED periods and event voiding, while requirements emphasize immutable originals and linked adjustments. No policy is chosen here.
- Schedule/holiday context, evidence and history are synthetic sketches. The DTR preview is not an official printable form.
- One synthetic Employee is provided. This does not assess large-roster performance or implement real permissions, evidence upload, audit logging or approval routes.
- JO/COS self-service, biometric sources, location capture and payroll computation remain outside the prototype.

## Validation

Web TypeScript, focused ESLint and formatting checks pass. Authenticated HTTP requests return 200 with the expected Tree, Form and Kanban content and no old variant switcher. Browser interactions and visual appearance have not been verified with browser automation; the developer approved the revised design on 15 September 2026.
