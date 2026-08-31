-- Corrective plan: this migration is additive. If reverted, remove the six
-- role_permissions rows for these global roles, then remove the permissions
-- by code after confirming no other role depends on them.

INSERT INTO "permissions" ("code", "domain", "risk_level", "description")
VALUES
  ('positions.items.authorize', 'positions', 'HIGH', 'Authorize proposed Plantilla Positions'),
  ('positions.items.declare_vacant', 'positions', 'HIGH', 'Declare authorized Plantilla Positions vacant'),
  ('positions.items.freeze', 'positions', 'HIGH', 'Freeze authorized or vacant Plantilla Positions'),
  ('positions.items.unfreeze', 'positions', 'HIGH', 'Restore frozen Plantilla Positions to vacant'),
  ('positions.items.cancel', 'positions', 'HIGH', 'Cancel proposed Plantilla Positions'),
  ('positions.items.abolish', 'positions', 'HIGH', 'Abolish authorized or vacant Plantilla Positions')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" DISABLE ROW LEVEL SECURITY;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'positions.items.authorize',
  'positions.items.freeze',
  'positions.items.unfreeze',
  'positions.items.abolish'
)
WHERE r."code" IN ('hrmo_administrator', 'budget_officer')
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope_policy")
SELECT r."id", p."id", 'AGENCY'
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'positions.items.declare_vacant',
  'positions.items.cancel'
)
WHERE r."code" = 'plantilla_officer'
  AND r."agency_id" IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
