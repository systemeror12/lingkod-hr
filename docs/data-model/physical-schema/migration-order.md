# Physical Schema Migration Order

**Document status:** Draft for review  
**Model level:** Physical PostgreSQL design  
**Primary profile:** Civilian Philippine National Government Agency  
**Database:** PostgreSQL  
**ORM target:** Prisma with reviewed SQL migrations where required  
**Version:** 1.0  
**Date:** August 6, 2026

---

## 1. Purpose

This document defines the dependency-safe migration sequence for the Philippine Public-Sector HRIS physical schema.

The sequence separates:

- foundational extensions;
- core identity and tenancy;
- domain tables;
- deferred foreign keys;
- advanced constraints;
- RLS;
- immutable triggers;
- seed data;
- verification.

---

## 2. Migration Strategy

Use small, reviewable migrations.

Recommended naming:

```text
0001_enable_extensions
0002_identity_core
0003_agency_membership_and_rbac
0004_organization_structure
...
```

Do not create one migration containing the entire HRIS.

Every migration should include a verification script.

---

## 3. Phase 0 — Extensions and Shared Functions

Create:

```text
pgcrypto
btree_gist
citext
```

Then create shared functions:

- `prevent_row_mutation()`;
- `set_updated_at_and_row_version()`;
- optional audit helper functions;
- current agency/membership setting helpers.

Verification:

```sql
SELECT extname FROM pg_extension
WHERE extname IN ('pgcrypto','btree_gist','citext');
```

---

## 4. Phase 1 — Agency and Identity Core

Create:

1. `agencies`
2. `agency_profile_versions`
3. `users`
4. `agency_memberships`
5. `invitations`
6. `roles`
7. `permissions`
8. `role_permissions`
9. `membership_roles`
10. `user_sessions`
11. `security_events`

Defer foreign keys from memberships to employees and organization units.

Seed:

- baseline permission catalog;
- system role templates;
- initial platform administrator process.

---

## 5. Phase 2 — Shared Documents, Audit, and Outbox

Create:

1. `retention_classes`
2. `documents`
3. `document_versions`
4. `document_links`
5. `audit_events`
6. `audit_changes`
7. `notifications`
8. `notification_deliveries`
9. `outbox_events`

Documents are needed by later organization, recruitment, appointment, and personnel tables.

---

## 6. Phase 3 — Organization and Plantilla

Create:

1. `organization_units`
2. `organization_unit_versions`
3. `staffing_authorities`
4. `qualification_standards`
5. `qualification_standard_versions`
6. `plantilla_positions`
7. `position_versions`
8. `position_documents`

Defer:

- organization-unit head-position FK;
- position incumbency tables until employees and service segments exist.

Add:

- effective-period exclusion constraints;
- agency-safe foreign keys;
- RLS.

---

## 7. Phase 4 — Recruitment and Selection

Create:

1. `requests_to_fill`
2. `vacancy_publications`
3. `applicants`
4. applicant document links
5. `applications`
6. `application_screenings`
7. `assessments`
8. `interviews`
9. `interview_feedback`
10. `selection_board_sessions`
11. `board_member_participations`
12. `conflict_declarations`
13. `board_recommendations`
14. `selection_decisions`

Attach immutable triggers to completed board records.

---

## 8. Phase 5 — Appointment and Personnel Core

Create:

1. `appointments`
2. `appointment_versions`
3. `appointment_submissions`
4. `oaths_of_office`
5. `assumptions_to_duty`
6. `employees`
7. `pds_versions`
8. normalized PDS child tables
9. `service_segments`
10. `personnel_actions`
11. `government_identifiers`
12. `bank_accounts`
13. `saln_compliance_records`

Then create:

14. `position_incumbencies`

Add deferred foreign keys:

- agency membership to employee;
- employee to current service segment;
- appointment current version;
- position current version;
- organization unit head position.

Add exclusion constraints for service segments and incumbencies.

---

## 9. Phase 6 — Approval Engine

Create:

1. `approval_route_versions`
2. `approval_requests`
3. `approval_steps`
4. `approval_decisions`
5. `delegated_authorities`

Delegated authority may be created earlier without optional document/unit FKs, then completed here.

Attach immutable trigger to approval decisions.

---

## 10. Phase 7 — Attendance

Create:

1. `work_schedules`
2. `work_schedule_versions`
3. `work_schedule_day_rules`
4. `work_schedule_break_intervals`
5. `holiday_calendars`
6. `holiday_calendar_versions`
7. `holiday_calendar_entries`
8. `work_arrangements`
9. `work_arrangement_versions`
10. `schedule_assignments`
11. `attendance_periods`
12. `employee_attendance_submissions`
13. `attendance_period_versions`
14. `attendance_events`
15. `attendance_contexts`
16. `attendance_days`
17. `attendance_day_segments`
18. `attendance_exceptions`
19. `employee_attendance_submission_days`
20. `attendance_period_version_days`
21. `attendance_corrections`
22. `attendance_correction_evidence`
23. `attendance_correction_effects`
24. `locked_attendance_adjustments`
25. `locked_attendance_adjustment_periods`
26. `dtr_documents`
27. `attendance_payroll_publications`
28. `attendance_payroll_facts`

Add:

- schedule overlap exclusion constraints;
- configuration-version immutability and activation checks;
- attendance current-version unique index;
- immutable event, context, segment, submitted snapshot, locked period version, correction effect, adjustment, DTR, and publication triggers;
- attendance lock and correction-application transaction checks;
- RLS and high-volume indexes.

---

## 11. Phase 8 — Leave

Create:

1. `leave_types`
2. `leave_policy_versions`
3. `leave_policy_authorities`
4. `leave_accounts`
5. `leave_ledger_entries`
6. `leave_credit_commitments`
7. the Leave Application draft, version, period, document, calculation,
   eligibility, certification, recommendation, allocation, posting, cancellation,
   and effect tables in `attendance-and-leave-schema.md`
8. `mandatory_leave_assessments`
9. the Leave Monetization request, version, allocation, assessment,
   certification, funding, posting, adjustment, and line tables
10. the Terminal Leave Input assessment, snapshot, line, and handoff-outcome
    tables

Payroll Input identifiers remain application-validated until the Payroll tables
exist. Separation source identities remain polymorphic and are validated through
the Separation application service.

Attach immutable triggers to ledger entries, terminal commitments, submitted
versions, material assessments and determinations, certifications, postings,
applied adjustments, terminal input snapshots, and append-only handoff outcomes.

---

## 12. Phase 9 — Overtime, COC, and CTO

Create:

1. `overtime_authorities`
2. `overtime_authority_employees`
3. `overtime_service_records`
4. `coc_accounts`
5. `coc_ledger_entries`
6. `coc_earned_certificates`
7. `coc_earned_certificate_lines`
8. `cto_requests`
9. `cto_cancellations`
10. `cto_request_dates`, after `attendance_cto_inputs`

Attach immutable trigger to COC ledger.

Grant `overtime.cto.approve` and `overtime.cto.reject` after the CTO Request tables, which add their catalog rows. `cto_cancellations` adds `cto_request_dates.cancelled_by_cto_cancellation_id` with its foreign key, the `overtime.cto.cancel` catalog row, and its grant. `cto_request_dates.attendance_correction_id` follows `cto_cancellations` and `attendance_corrections`, with its foreign key and the trigger that sets it once, as the date is cancelled.

---

## 13. Phase 10 — Payroll

Create:

1. `salary_schedules`
2. `salary_grade_rates`
3. `pay_components`
4. `pay_component_rule_versions`
5. `employee_compensations`
6. `payroll_inputs`
7. `payroll_periods`
8. `payroll_rule_snapshots`
9. `payroll_employees`
10. `payroll_lines`
11. `contribution_lines`
12. `tax_lines`
13. `loan_deduction_lines`
14. `payroll_exceptions`
15. `payroll_adjustments`
16. `payslips`
17. `remittance_schedules`
18. `payment_exports`

Add deferred FKs:

- accepted Leave Monetization and adjustment inputs to Payroll Input where the
  chosen migration can preserve module ownership;
- overtime compensation to payroll input;
- payroll input to domain source remains polymorphic and application-validated.

Attach:

- finalized-payroll mutation trigger;
- rule-snapshot immutability;
- payroll line immutability;
- total reconciliation checks through finalization function.

---

## 14. Phase 11 — SPMS

Create:

1. `performance_cycles`
2. `organizational_goals`
3. `office_commitments`
4. `individual_commitments`
5. `success_indicators`
6. `accomplishments`
7. `performance_evidence`
8. `coaching_notes`
9. `performance_reviews`
10. `rating_components`
11. `performance_ratings`
12. `rating_amendments`

Attach immutable triggers to finalized ratings and rating components.

---

## 15. Phase 12 — Separation

Create:

1. `separation_cases`
2. `separation_documents`
3. `clearance_offices`
4. `clearance_tasks`
5. `accountability_items`
6. `separation_effects`

Add indexes for active separation and pending clearance tasks.

---

## 16. Phase 13 — AI

Create:

1. `ai_requests`
2. `ai_input_references`
3. `ai_outputs`
4. `ai_review_decisions`
5. `ai_tool_calls`

Optional later:

6. vector embeddings for approved document retrieval.

AI tables must not be required for core HRIS startup.

---

## 17. Phase 14 — RLS

Enable and force RLS on every agency-owned operational table.

Create one baseline agency policy per table.

Then test:

- correct agency can read;
- another agency cannot read;
- insert with wrong agency fails;
- background job without context fails;
- privileged migration/maintenance role behavior is documented.

Avoid using the application owner as a superuser.

---

## 18. Phase 15 — Immutable Triggers and Finalization Functions

Attach immutable triggers to:

- leave ledger;
- COC ledger;
- audit events;
- approval decisions;
- issued document versions;
- finalized payroll lines;
- finalized performance ratings;
- completed appointment submissions where required.

Create reviewed transactional functions or service transactions for:

- assumption to duty;
- personnel-action effectuation;
- leave posting;
- COC posting;
- payroll finalization;
- separation effectuation.

---

## 19. Phase 16 — Seed and Reference Data

Seed only stable baseline data:

- permission catalog;
- role templates;
- government leave-type templates;
- standard workflow status references if reference tables are used;
- baseline pay-component templates;
- document classifications;
- audit action codes.

Do not hard-code current statutory rates as timeless seed data.

Salary schedules, contribution tables, and tax rules are versioned agency/configuration data.

---

## 20. Phase 17 — Verification Suite

Required database verification tests:

### Agency isolation

```text
cross-agency reads fail
cross-agency inserts fail
cross-agency foreign keys fail
```

### Effective dating

```text
overlapping position versions fail
overlapping service segments fail
overlapping schedule assignments fail
```

### Immutability

```text
leave ledger UPDATE fails
COC ledger DELETE fails
finalized payroll line UPDATE fails
audit event DELETE fails
```

### Workflow constraints

```text
one active incumbent per position
one active leave account per type
one employee result per payroll period
one current attendance result per employee/date
```

### Financial reconciliation

```text
payroll header gross equals earning lines
deductions equal deduction lines
net equals gross minus employee deductions
```

---

## 21. Rollback Policy

Safe rollback is expected for:

- new nullable columns;
- new indexes;
- new draft-only tables;
- new reference data.

Potentially irreversible migrations require explicit documentation:

- encrypting plaintext data;
- converting identifiers;
- partitioning large tables;
- dropping columns;
- consolidating duplicate records;
- adding strict uniqueness to dirty data.

For irreversible migrations:

1. create a verified backup;
2. run a preflight report;
3. block writes;
4. migrate;
5. verify counts and hashes;
6. document recovery procedure.

---

## 22. Deployment Order

```text
Development
→ Automated migration test
→ Integration environment
→ Data migration rehearsal
→ Staging
→ Backup and restore test
→ Production maintenance window
→ Post-deployment verification
```

---

## 23. Next Artifact

After the physical-schema bundle is approved, create:

```text
packages/database/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── client.ts
│   ├── tenant-context.ts
│   └── repositories/
└── tests/
    ├── rls.integration.spec.ts
    ├── constraints.integration.spec.ts
    └── payroll-finalization.integration.spec.ts
```

The Prisma schema must remain consistent with the reviewed PostgreSQL migrations.
