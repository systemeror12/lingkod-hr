-- Restore the established transition error contract while retaining the SALN content boundary.
CREATE OR REPLACE FUNCTION guard_employee_document_mutation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  IF current_setting('app.employee_document_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Employee Document links are managed by the application service'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."personnel_classification" = 'SALN' THEN
    RAISE EXCEPTION 'SALN filing contents cannot be stored as Personnel Documents'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
