-- Forward correction for environments that applied migration 0060 before the
-- EFFECTIVE-state branch of this constraint was tightened.

ALTER TABLE "personnel_actions"
  DROP CONSTRAINT "personnel_actions_effectuation_check",
  ADD CONSTRAINT "personnel_actions_effectuation_check" CHECK (
    ("status" <> 'EFFECTIVE' AND "effectuated_at" IS NULL
      AND "effectuated_by_membership_id" IS NULL AND "effectuation_key" IS NULL)
    OR ("status" = 'EFFECTIVE' AND "effectuated_at" IS NOT NULL
      AND "effectuated_by_membership_id" IS NOT NULL AND btrim("effectuation_key") <> '')
  );

DO $$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conname = 'personnel_actions_effectuation_check'
    AND conrelid = 'personnel_actions'::regclass;
  IF definition IS NULL OR definition NOT LIKE '%status <> ''EFFECTIVE''::text%' THEN
    RAISE EXCEPTION 'Personnel Action effectuation constraint verification failed';
  END IF;
END;
$$;
