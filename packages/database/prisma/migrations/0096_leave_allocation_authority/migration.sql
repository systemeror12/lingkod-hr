-- A Leave Approval Allocation line binds the Leave Policy Version that
-- authorized its allocation kind. The bound calculation segment already
-- supplies that policy version for existing rows, so the backfill only has to
-- copy it before the column becomes enforceable. The allocation line guard
-- rejects updates and forced RLS hides rows outside a request context, so the
-- backfill runs with both suspended.
--
-- Correction / rollback: drop the policy_version_id index, foreign key, and
-- column. No other table or column changes are involved.

ALTER TABLE "leave_approval_allocation_lines" ADD COLUMN "policy_version_id" uuid;

ALTER TABLE "leave_approval_allocation_lines"
  DISABLE TRIGGER "leave_approval_allocation_lines_mutation_trigger";
ALTER TABLE "leave_approval_allocation_lines" DISABLE ROW LEVEL SECURITY;

UPDATE "leave_approval_allocation_lines" line
SET "policy_version_id" = segment."policy_version_id"
FROM "leave_approval_allocations" allocation,
     "leave_calculation_segments" segment
WHERE line."leave_approval_allocation_id" = allocation."id"
  AND line."agency_id" = allocation."agency_id"
  AND segment."agency_id" = allocation."agency_id"
  AND segment."leave_application_version_id" = allocation."leave_application_version_id"
  AND segment."date_from" = line."date_from"
  AND segment."date_to" = line."date_to";

ALTER TABLE "leave_approval_allocation_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_approval_allocation_lines"
  ENABLE TRIGGER "leave_approval_allocation_lines_mutation_trigger";

ALTER TABLE "leave_approval_allocation_lines"
  ALTER COLUMN "policy_version_id" SET NOT NULL;

ALTER TABLE "leave_approval_allocation_lines"
  ADD CONSTRAINT "leave_approval_allocation_lines_policy_version_fkey"
  FOREIGN KEY ("agency_id", "policy_version_id")
  REFERENCES "leave_policy_versions" ("agency_id", "id") ON DELETE RESTRICT;

CREATE INDEX "leave_approval_allocation_lines_policy_version_idx"
  ON "leave_approval_allocation_lines" ("agency_id", "policy_version_id");
