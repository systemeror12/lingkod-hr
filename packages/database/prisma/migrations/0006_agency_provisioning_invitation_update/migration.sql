GRANT UPDATE ON "invitations" TO hris_operator;

-- Rollback/correction: REVOKE UPDATE ON "invitations" FROM hris_operator.
-- Verification: SELECT has_table_privilege('hris_operator', 'invitations', 'UPDATE');
-- Performance: table-level grants do not change query plans or indexes.
