-- Forward migration: permit the explicitly privileged operator to suspend a
-- newly provisioned Agency when post-commit invitation delivery fails.
-- Rollback/correction: REVOKE UPDATE ON "agencies" FROM hris_operator;
-- Verification: SELECT has_table_privilege('hris_operator', 'agencies', 'UPDATE');
-- Performance: this changes table privileges only and does not affect plans.
GRANT UPDATE ON "agencies" TO hris_operator;
