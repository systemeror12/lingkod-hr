-- Roll-forward correction for environments that applied the initial local permission names.
-- Historical SALN document links remain stored but are hidden; reverse by restoring the guard
-- function only after an approved replacement content policy exists.
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('personnel.saln_compliance.read', 'personnel', 'HIGH', 'Read authorized SALN filing compliance metadata'),
  ('personnel.saln_compliance.update', 'personnel', 'HIGH', 'Record and correct SALN filing compliance metadata')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy", "granted_by_membership_id", "granted_at")
SELECT
  rp."role_id",
  replacement."id",
  rp."scope_policy",
  rp."granted_by_membership_id",
  rp."granted_at"
FROM "role_permissions" rp
JOIN "permissions" legacy ON legacy."id" = rp."permission_id"
JOIN "permissions" replacement ON replacement."code" = CASE
  WHEN legacy."code" IN ('personnel.saln.read', 'personnel.saln.history.read')
    THEN 'personnel.saln_compliance.read'
  ELSE 'personnel.saln_compliance.update'
END
WHERE legacy."code" IN (
  'personnel.saln.read',
  'personnel.saln.manage',
  'personnel.saln.correct',
  'personnel.saln.history.read'
)
ON CONFLICT DO NOTHING;

DELETE FROM "role_permissions"
WHERE "permission_id" IN (
  SELECT "id" FROM "permissions" WHERE "code" IN (
    'personnel.saln.read',
    'personnel.saln.manage',
    'personnel.saln.correct',
    'personnel.saln.history.read'
  )
);

DELETE FROM "permissions"
WHERE "code" IN (
  'personnel.saln.read',
  'personnel.saln.manage',
  'personnel.saln.correct',
  'personnel.saln.history.read'
);

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;

-- Keep historical SALN links intact while closing the legacy content-ingress path.
CREATE OR REPLACE FUNCTION guard_employee_document_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.employee_document_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Employee Document links require the controlled service transition'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."personnel_classification" = 'SALN' THEN
    RAISE EXCEPTION 'SALN filing contents cannot be stored as Personnel Documents'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
