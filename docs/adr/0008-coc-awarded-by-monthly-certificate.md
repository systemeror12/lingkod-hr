# ADR 0008: Fix the Compensation Method on the Overtime Authority and Award COC by Monthly Certificate

- Status: Accepted
- Date: 2026-10-27
- Scope: Overtime compensation and the COC award (#317)

## Context

The schema and controls §5.17 decided compensation per Overtime Service Record after certification. An HR Administrator or Budget Officer chose overtime pay, COC, or non-compensable, and a separate step posted the choice. The authorities in [overtime-coc-cto-authorities.md](../research/overtime-coc-cto-authorities.md) place both decisions elsewhere. The agency head chooses "the manner of compensating" on each overtime authority, and CTO is the general rule (JC 2, s. 2015 items 3.2, 3.3, 5.3). The Head of Office grants COC each month through a Certificate of COC Earned that the HRMO computes (JC 2, s. 2004 items 5.8, 6.3, 7.1.2, Annex A). No source names authorized, certified overtime that earns neither.

## Decision

The Approving Official fixes the method, `COC` or `OVERTIME_PAY`, when approving the Overtime Authority, and certified service follows it. COC is awarded only when an Approving Official approves a Certificate of COC Earned that an HR Administrator prepared for one Employee and one calendar month of Work Dates. Approval calls the COC module once, which applies the ratio, caps, and validity in the same transaction. There is no per-record compensation decision, no separate posting step, and no `NON_COMPENSABLE` method; service that should not be compensated is declined at certification.

Rejected alternatives:

- A per-record decision and posting (the earlier schema). It gives the method choice to HR rather than the agency head and adds a posting step that waits on nothing.
- Awarding COC directly at certification. It skips the Head of Office's monthly grant and its "Valid Until" date.

## Consequences

- `overtime_compensation_decisions` is dropped. The service record's status stops at `CERTIFIED` or `NOT_CERTIFIED`, and whether it was credited is derived from its certificate line.
- An approved certificate is immutable, so later corrections are COC adjustments or reversals.
- Overtime pay, from #347, needs its own path from certified service to a Payroll Input. It does not reuse the certificate.
