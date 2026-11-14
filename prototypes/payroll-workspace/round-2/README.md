# Payroll workspace prototype, round 2 (#327)

Throwaway review round for [Decide: the Payroll workspace direction](https://github.com/systemeror12/lingkod-hr/issues/327). No direction is accepted yet: the developer picks one or a mix.

Round 1 (`../round-1/`) was rejected as too heavy. Round 2 takes the shape of the developer's reference screens: Employee Payslips, Salary Structures, and Salary Rules, each a list and a form, in the existing theme. The payslip form has two tabs, **Worked Days & Inputs** and **Salary Computation**.

The three variants share every screen. They differ only in where the payroll-wide steps (compute, certify, review, approve, finalize) sit.

| Variant | Idea | File |
| --- | --- | --- |
| A · Payslips only | Payslips group by month; the group row and every payslip form carry the next step. No screen for the run. | `a.html` |
| B · Payslips and runs | A Payroll Runs list and form holds the steps, totals, and approvals. | `b.html` |
| C · Month bar | Employee Payslips shows one month; a bar above the list picks the month and carries the steps. | `c.html` |

`compare.html` shows them side by side with the fonts and colors. A switcher in the bottom-right corner moves between variants.

Data is synthetic and lives in `sessionStorage` until **Reset sample data** under Prototype controls. The app's source is unchanged.

## Build

```sh
cd prototypes/payroll-workspace/round-2 && node build.mjs
```

The sample data and actions come from `../round-1/src/data.js` and `core.js`. `src/ui.js` holds the shared screens, `src/r2.css` the added styles, and `src/a.js`, `b.js`, `c.js` each variant's layout.

## Walkthrough

Today is 23 Nov 2026. November starts in Draft, returned after calculation 1. Switch the actor under **Prototype controls → Preview role**.

1. Payroll Preparer: open Miguel Santos and **Place Payroll Hold**, acknowledge the warning, then **Compute sheets**. The stage bar reads Computing until the prototype button finishes it.
2. Open Paolo Reyes. Worked Days & Inputs shows 0.5 day of leave without pay and its source; Salary Computation opens each line to its rule version and sources.
3. HR Certifying Officer: **Certify**.
4. Budget Officer, then Accounting Reviewer: confirm, in either order. The stage bar reads Reviewed 1/2 in between, and Approve is off.
5. Payroll Approver: **Approve**, then **Finalize**. Withhold one payslip, then **Release** the rest.
6. Cashier: **Generate Payment Export** under Reports, then **Record payment outcome** on a payslip.
7. Employee: only released payslips are listed, on the same form.

## Departures from the references

The references allow things the decided rules refuse. This round stays inside the rules.

- Salary rules are read-only, with a plain `result = …` line. There is no free-form formula, and rule versions are loaded by the platform operator (#328).
- Worked days, inputs, and computation lines are read-only. A calculated line is never overridden, and inputs come only from Leave, Overtime, and Attendance (#27, #43).
- The stage belongs to the month's payroll, not to each payslip, and it passes certification, two reviews, and approval before finalization (#12). The Payroll Period is the payslip batch, so the batch is already in the spec.
- There is no Paid state. A Payment Export marks no one paid; outcomes are recorded separately (#330).
- Salary Structure is not in the spec. The three shown are an assumption.
- Screen names follow the references (Salary Rules, Salary Structure, Salary Computation). The glossary's names are National Payroll Rule Version and Payroll Line.

## Checked

Headless Chromium at 1440px and 390px over 57 screens across the three variants: no console errors, no sideways scrolling, no animations, text contrast of at least 4.5:1, and visible keyboard focus. A scripted run took the November payroll from Draft to a superseded Payment Instruction in each variant.
