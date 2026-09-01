-- Keep full PDS access with the HR roles named by the PDS contract.
DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id"
  AND rp."permission_id" = p."id"
  AND r."agency_id" IS NULL
  AND r."code" = 'agency_administrator'
  AND p."code" IN ('personnel.pds.read', 'personnel.pds.update');
