# Payroll workspace prototype (#327)

Throwaway review round for [Decide: the Payroll workspace direction](https://github.com/systemeror12/lingkod-hr/issues/327), under the Phase 9 spec [#12](https://github.com/systemeror12/lingkod-hr/issues/12). No direction is accepted yet: the developer picks one or a mix.

It keeps the existing theme and the Tree/Form/Kanban pattern accepted for Attendance (#154), Leave (#155), and Overtime (#316). The three variants share one sample payroll and the same screens. They differ in where those screens live and where each actor starts.

| Variant | Idea | File |
| --- | --- | --- |
| A · Period file | The Payroll Period is the one record from draft to disbursement, with eight tabs. | `a.html` |
| B · Work desk | Each actor lands on the work their function holds, across payrolls. The period is a read-only record. | `b.html` |
| C · Linked registers | Results, exceptions, payslips, Payment Exports, and reports are their own registers across payrolls. | `c.html` |

`compare.html` shows them side by side with the fonts and colors. Open any file directly or through a static server. A switcher in the bottom-right corner moves between variants and keeps the role.

Data is synthetic and lives in `sessionStorage`, shared by the three variants, until you choose **Reset sample data** under Prototype controls. The app's source is unchanged.

## Build

Each variant is one self-contained HTML file, generated from `src/`:

```sh
node prototypes/payroll-workspace/round-1/build.mjs
```

`src/data.js`, `core.js`, `sections.js`, and `shell.js` are shared. `a.js`, `b.js`, and `c.js` hold only each variant's navigation and page layout.

## Prototype controls

- **Preview role**: Payroll Preparer, HR Certifying Officer, Budget Officer, Accounting Reviewer, Payroll Approver, Cashier, Auditor, Employee.
- **Jump the November payroll to**: any stage from Draft to released, reached by running the real actions in order.
- **Sample state**: live, empty, loading, permission denied.

Query parameters: `role`, `dest`, `view` (`tree`, `form`, `kanban`), `record`, `tab`, `sub`, `pf`, `sample`, and `stage` (`DRAFT`, `CALCULATING`, `FOR_REVIEW`, `CERTIFIED`, `REVIEWED`, `APPROVED`, `FINALIZED`, `RELEASED`).

## Walkthrough

Today is 23 Nov 2026. `2026-11-REG` starts in Draft, returned after calculation 1.

1. Payroll Preparer: place a Payroll Hold on Miguel Santos (`EX-0062`), acknowledge the warning `EX-0063`, then recalculate. The payroll is Calculating and has no results until **Let calculation 2 finish**.
2. Open Paolo Reyes in calculation 2, then switch the version to calculation 1: his leave without pay went from 1.000 day to 0.500, and both versions are kept.
3. HR Certifying Officer: certify. Without the hold, Certify is off and says why.
4. Budget Officer, then Accounting Reviewer: confirm, in either order. As the Payroll Approver in between, Approve is off until both are recorded. On `2026-YEB`, return the snapshot as the Accounting Reviewer: certification and the Budget review are revoked.
5. Payroll Approver: approve, then finalize. Payslips are Generating, then Ready, and nothing is released until **Release**. Withhold one first.
6. Cashier: generate the Payment Export (blocked by a missing destination), record Submitted, Accepted, Settled, or Rejected, and supersede a rejected instruction. `2026-10-REG` already has one rejected.
7. Payroll Preparer: generate the register. It reads Generating until the background work finishes.
8. Employee: read a released payslip. A withheld or unreleased payslip isn't listed.
9. `2026-08-REG` is voided and links to its replacement. `2026-10-SUP` is Approved, not finalized.

## Kept apart on purpose

- Calculated, certified, reviewed, approved, and finalized each have a cell in the stage rail with who acted, when, and the calculation it binds. Reviewed lists the Budget and Accounting reviews separately. Only Finalized is green.
- A stage that hasn't happened is dashed and says so in words. Calculating shows the previous calculation as superseded, never as current.
- A payslip is Generating, Ready, then Released. Release says nothing about payment.
- Generating the Payment Export marks no one paid. Only a recorded Settled outcome does, and outcomes are only ever added.
- An output that is Generating never reads as Ready.

## Checked

Headless Chromium at 1440px and 390px over 40 screens across the three variants, plus the loading, empty, and denied states: no console errors, no sideways scrolling, no animations, text contrast of at least 4.5:1, and visible keyboard focus. A scripted run took the November payroll from Draft to a superseded Payment Instruction in each variant, and returned the `2026-YEB` snapshot.

## Assumptions to settle elsewhere

The prototype shows these as stated; it doesn't decide them.

- A blocking exception can stand on a `FOR_REVIEW` payroll and only stops certification. #625 speaks of a blocking exception returning the period to `DRAFT`; here a reviewer returns it by hand.
- The Payroll Preparer acknowledges warnings and places Payroll Holds. §6.10 names no permission for either.
- `Return before finalization` sends the payroll to `FOR_REVIEW` and revokes its certification and reviews. §5.20 says only "Reopen controlled review".
- Payroll Employee Result statuses shown are `CALCULATED`, `EXCEPTION`, `FINALIZED`, and `VOIDED`. `PENDING` and `REVIEWED` from the schema aren't used.
- Disbursement Outcomes are `SUBMITTED`, `ACCEPTED`, `SETTLED`, and `REJECTED`, recorded in that order. The full list belongs to #643.
- Superseding a rejected Payment Instruction adds a new instruction to the same Payment Export. Whether it belongs to a new export is #643's.
- The Employee sees no Disbursement Outcome on a payslip, only "It isn't proof of payment".
- Every amount, salary, rate, and rule version label is made up. The tax and contribution treatment of an adjustment is shown as zero because #348, #350, and #632 haven't decided it.
- Payroll Inputs, rule versions, Payroll Adjustments, and the legacy comparison appear only as grey navigation entries. This round doesn't design them.
