GRANT SELECT ON "users" TO hris_operator;
GRANT SELECT ON "agency_memberships" TO hris_operator;

-- Rollback/correction: REVOKE SELECT ON "users", "agency_memberships" FROM hris_operator.
-- Verification:
-- SELECT has_table_privilege('hris_operator', 'users', 'SELECT');
-- SELECT has_table_privilege('hris_operator', 'agency_memberships', 'SELECT');
-- Performance: table-level grants do not change query plans or indexes.
