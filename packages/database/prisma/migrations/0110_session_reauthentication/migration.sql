-- Reauthentication refreshes a session's proof of who the User is: its
-- auth_time and the methods used. Nothing else about the session changes.
GRANT UPDATE ("auth_time", "authentication_methods") ON "user_sessions" TO hris_app;

-- Rollback/correction: REVOKE UPDATE ("auth_time", "authentication_methods")
-- ON "user_sessions" FROM hris_app;
