# Overtime workspace prototype (#316)

Throwaway review artifact for [Decide: Overtime workspace direction](https://github.com/systemeror12/lingkod-hr/issues/316), under the Phase 8 spec [#11](https://github.com/systemeror12/lingkod-hr/issues/11). The developer chose the **Authority file** direction over a separate service register and a compensation desk.

It reuses the accepted Tree/Form/Kanban pattern from Attendance (#154) and Leave (#155). It varies only what Overtime adds: three linked lifecycles (authority, rendered service, compensation) that feed a COC ledger, which CTO later draws on.

Open `index.html` directly or through any static server. Data is synthetic and lives in `sessionStorage` until you choose **Reset sample data** under Prototype controls. The app's source is unchanged.

## Direction

The Overtime stage has three destinations: **Overtime Authorities**, **COC Accounts**, and **CTO Requests**.

- **Overtime Authorities** is the one record from request to compensation. Tree is the default register. Kanban groups authorities by status. Rows and cards open the same Form, with Previous and Next.
- The authority Form has four tabs:
  - **Authority**: purpose, dates, method, funding, reviews, and the covered Employees with requested and authorized hours and the eligibility snapshot.
  - **Service**: one row per Employee and date, grouped by Employee, with authorized, certified, and remaining hours per Employee. Claimed, actual (locked Attendance), and certified hours sit in separate columns. Record, submit, certify, and decline happen on the row.
  - **Compensation**: certified service with its decision, decided hours × ratio, credited hours, and COC effect. Decide and post are separate actions. Overtime pay is disabled with Payroll's reason.
  - **History**.
- **COC Accounts** has Tree and Form only. The Form has Ledger, Commitments, and History tabs, and the ledger can be read as of a past date.
- **CTO Requests** has Tree, Form, and Kanban by status. The Form has Request, Decisions, Attendance, and History tabs.

Query parameters: `role` (`employee`, `supervisor`, `hr`, `budget`, `approver`, `leave`, `auditor`), `dest` (`authorities`, `coc`, `cto`), `view` (`tree`, `form`, `kanban`), `record`, `tab`, `sample` (`empty`, `loading`, `denied`, `stale`).

## Walkthrough

1. Supervisor, `OA-2026-031` → Service: certify Andrea's 8 Oct record above 3.0 h (refused: actual is 3.0 h), then at 3.0 h. Decline Paolo's 14 Oct record.
2. HR Administrator, `OA-2026-031` → Compensation: decide Paolo's 10 Oct record (overtime pay is disabled), then post it and Andrea's 6 Oct decision. Change a decision before posting to see the superseded one kept.
3. Employee, `OA-2026-032` → Service: record 24 Oct. The row explains why it can't be submitted: 16–31 Oct Attendance isn't locked.
4. COC Accounts → Andrea: read the ledger as of 30 Jun, follow `E-0177` to its reversal, adjust with evidence, reverse an entry. Ledger sources open the authority's Compensation tab.
5. Approving Official → CTO: approve `CTO-2026-044`. Recommend `CTO-2026-046` as Supervisor; approving it is then refused because available COC is rechecked. Cancel posted `CTO-2026-039` (open period: reversal and void together) and `CTO-2026-036` (locked: "Awaiting Attendance authorization"). `CTO-2026-027` shows "Blocked" with Attendance's reason.
6. Leave Administrator: posting `CTO-2026-041` is refused until 6 Nov.

## Kept apart on purpose

- Requested, authorized, claimed, actual, certified, credited, and used hours each have their own label and source. "What each hour value means" defines them once.
- Approved CTO shows "Committed, not deducted until posted". Only posting writes the USED entry. A decided but unposted COC award is listed under Commitments, outside the balance.
- The COC ledger is its own destination. CTO requests never appear in it until posted, and corrections add entries rather than editing them.
- A cancellation of posted CTO on a locked date takes its status from Attendance and is never shown as finished first.

## Open points for the build tickets

- HR and Budget find work by opening each authority. A cross-authority work queue is not part of this direction.
- §6.9 gives Leave Administrators `overtime.coc.award` but no `overtime.authorities.read`, so they can't reach the Compensation tab. Either grant authority read for posting or leave posting to HR (#317, D7).

## Assumptions to settle elsewhere

The prototype shows these as stated; it doesn't decide them.

- Requested and authorized hours are shown as two values. The schema stores only `authorized_hours` per line (#317, D7).
- `FOR_REVIEW` keeps its canonical label even though it means "reviewed, awaiting approval". FOR_RECOMMENDATION has no Kanban column because §5.19 never reaches it (#317; #318, D12).
- Non-compensable decisions are "posted" to close the record without a ledger entry (#317, D5).
- Available COC is balance minus approved, unposted CTO. "Expiring 31 Dec 2026" assumes uses draw from the earliest-expiring credit first (#318, D8).
- Posting CTO is refused on locked dates and before the CTO date. Cancelling posted CTO on a locked date goes through a Locked Attendance Adjustment and restores COC only after Attendance authorizes it (#318, D10).
- The 40-hour monthly and 120-hour balance caps are shown for information only. Hours beyond a cap have no rule yet (#317, #318).
- Day ratios use rest day ×1.5 and workday ×1.0 only (CSC-DBM JC 2, s. 2004, items 5.4.1–5.4.2). The sample has no holidays.
