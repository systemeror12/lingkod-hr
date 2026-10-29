# ADR 0010: Keep the Overtime Authority Review Result on Its Audit Event

- Status: Accepted
- Date: 2026-10-28
- Scope: Overtime Authority review and approval (#532)

## Context

Reviewing a submitted Overtime Authority records the reviewer's attestations for each covered Employee: the Employee is at division-chief level or below, or is such an incumbent designated Officer-in-Charge of a higher position, and receives no other allowance for service beyond prescribed hours (hris-controls §5.16; JC 2, s. 2015 items 6.1–7.0). Approval copies them into each Employee's `eligibility_snapshot`, which is written once. The attestations must therefore persist from review to approval. Review and approval also refuse anyone who prepared or submitted the authority, and `overtime_authorities` has no preparer or submitter column. No earlier module reads business data back from an Audit Event.

## Decision

The review result is the authority's `OVERTIME_AUTHORITY_REVIEWED` Audit Event. Its metadata holds the attestations and the id of the Approval Request the review opened. Approval reads that event back, copies the attestations into each snapshot, and decides that exact Approval Request; rejection decides the same request. The preparers and the submitter are the actors of the authority's create, update, and submit Audit Events.

Rejected alternatives:

- A review-attestation column on `overtime_authority_employees`. The 0129 trigger lets a covered Employee change only while the authority is a `DRAFT`, apart from the one snapshot write, so the column would need a second trigger exception and a migration for a value read once.
- Writing a partial `eligibility_snapshot` at review. The snapshot may be written only once, at approval, and holds facts rechecked then.
- Preparer and submitter columns. They would restate who wrote the create, update, and submit events.

## Consequences

- Audit Events for an Overtime Authority are part of its record. They are append-only and agency-isolated, like the authority itself.
- An authority has at most one review, because no transition returns `FOR_REVIEW` to `SUBMITTED`. A future return path must say which review approval reads.
- Approve and reject refuse with `OVERTIME_AUTHORITY_REVIEW_MISSING` when the event cannot be read, and with `OVERTIME_AUTHORITY_APPROVAL_REQUEST_MISSING` when its Approval Request no longer awaits a decision.
