-- Phase 9 (#346): a rule snapshot also references the approved Authorized
-- Payroll Component Inputs in effect during its period, as payroll-schema.md §6
-- has it. Items stay references, never copies. `agency_payroll_applicability_id`
-- arrives with its table (#618) and joins the one-source count then.
--
-- §3: now that `payroll_periods` exists, the consuming period of a `ONCE`
-- input gets its foreign key. Consumption itself is #626.

ALTER TABLE "payroll_rule_snapshot_items"
  ADD COLUMN "authorized_payroll_component_input_id" UUID;

ALTER TABLE "payroll_rule_snapshot_items"
  DROP CONSTRAINT "payroll_rule_snapshot_items_one_source_check";

ALTER TABLE "payroll_rule_snapshot_items"
  ADD CONSTRAINT "payroll_rule_snapshot_items_one_source_check"
    CHECK (num_nonnulls("national_payroll_rule_version_id", "authorized_payroll_component_input_id") = 1),
  ADD CONSTRAINT "payroll_rule_snapshot_items_authorized_input_fkey"
    FOREIGN KEY ("agency_id", "authorized_payroll_component_input_id")
    REFERENCES "authorized_payroll_component_inputs"("agency_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "payroll_rule_snapshot_items_authorized_input_key"
    UNIQUE ("payroll_rule_snapshot_id", "authorized_payroll_component_input_id");

ALTER TABLE "authorized_payroll_component_inputs"
  ADD CONSTRAINT "authorized_payroll_component_inputs_consumed_by_fkey"
    FOREIGN KEY ("agency_id", "consumed_by_payroll_period_id")
    REFERENCES "payroll_periods"("agency_id", "id") ON DELETE RESTRICT;

-- Rollback/correction: only through a reviewed forward migration; snapshots
-- are retained payroll history.
-- Verification: pnpm db:policies payroll_rule_snapshot_items
