-- A source correction cancels a pending Payroll Input idempotently by the
-- source's stable correction key (#357, payroll-schema.md §4). The key is
-- written as the input moves from PENDING to CANCELLED, so a retry finds the
-- cancellation it made and the same key cannot cancel a second input. The
-- CHECK holds the key to a cancelled input, and a cancelled input is final, so
-- the key never changes once written. Inputs cancelled before this migration
-- keep a null key.

ALTER TABLE "payroll_inputs" ADD COLUMN "source_correction_key" CITEXT;

ALTER TABLE "payroll_inputs"
  ADD CONSTRAINT "payroll_inputs_correction_key_check"
    CHECK ("source_correction_key" IS NULL OR "status" = 'CANCELLED');

CREATE UNIQUE INDEX "payroll_inputs_source_correction_key"
  ON "payroll_inputs" ("agency_id", "source_module", "source_correction_key");

-- As in 0152, with the correction key: after acceptance only `status`,
-- `consumed_by_payroll_period_id`, and `source_correction_key` change.
CREATE OR REPLACE FUNCTION guard_payroll_input_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll Inputs are retained and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'A Payroll Input is accepted as PENDING'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'consumed_by_payroll_period_id' - 'source_correction_key')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'consumed_by_payroll_period_id' - 'source_correction_key') THEN
    RAISE EXCEPTION 'An accepted Payroll Input changes only its status and consuming period'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('CONSUMED', 'CANCELLED'))
    OR (OLD."status" = 'CONSUMED' AND NEW."status" = 'PENDING')
  ) THEN
    RAISE EXCEPTION 'A Payroll Input cannot move from % to %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'payroll_inputs_source_correction_key'
  ) THEN
    RAISE EXCEPTION 'Payroll Input correction key verification failed';
  END IF;
END;
$$;

-- Rollback/correction: restore the 0152 guard, then drop the index, the check,
-- and the column. Cancelled inputs stay cancelled.
