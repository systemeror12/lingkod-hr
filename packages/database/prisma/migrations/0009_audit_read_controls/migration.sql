-- Audit Events are readable and appendable by the runtime role, but ordinary
-- application code must not be able to mutate or remove historical evidence.
REVOKE UPDATE, DELETE ON TABLE "audit_events" FROM hris_app;
GRANT SELECT, INSERT ON TABLE "audit_events" TO hris_app;
