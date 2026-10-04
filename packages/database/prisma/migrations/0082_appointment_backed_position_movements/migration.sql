-- Phase 6 appointment-backed position movements. Promotion, transfer, demotion,
-- reclassification, and comparable reinstatement effectuate only after an
-- Appointment is issued and Assumed to Duty. The appointment contract supplies
-- the target item and compensation; effectuation closes the source Service
-- Segment and Position Incumbency, frees the source Plantilla item, and records
-- the successor service facts and target occupancy in one transaction.

ALTER TABLE "personnel_actions"
  DROP CONSTRAINT "personnel_actions_type_check",
  ADD CONSTRAINT "personnel_actions_type_check" CHECK ("action_type" IN (
    'REASSIGNMENT', 'DETAIL', 'DESIGNATION', 'SECONDMENT',
    'SAME_ITEM_REINSTATEMENT', 'SEPARATION_RESIGNATION',
    'SEPARATION_DISMISSAL', 'SEPARATION_DROPPING_FROM_ROLLS',
    'SEPARATION_EXPIRATION', 'SEPARATION_TERMINATION',
    'SEPARATION_RETIREMENT', 'SEPARATION_DEATH',
    'SALARY_ADJUSTMENT', 'STEP_INCREMENT',
    'PROMOTION', 'TRANSFER', 'DEMOTION', 'RECLASSIFICATION',
    'COMPARABLE_REINSTATEMENT'
  ));

DO $$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conname = 'personnel_actions_type_check'
    AND conrelid = 'personnel_actions'::regclass;
  IF definition IS NULL
    OR definition NOT LIKE '%PROMOTION%'
    OR definition NOT LIKE '%TRANSFER%'
    OR definition NOT LIKE '%DEMOTION%'
    OR definition NOT LIKE '%RECLASSIFICATION%'
    OR definition NOT LIKE '%COMPARABLE_REINSTATEMENT%' THEN
    RAISE EXCEPTION 'Personnel Action movement type constraint verification failed';
  END IF;
END;
$$;
