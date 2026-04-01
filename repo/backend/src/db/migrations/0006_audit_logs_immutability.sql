-- Tasks 146 & 147: Enforce audit_logs immutability at the database level.
-- The audit trail must never be modified after insertion; both privilege
-- revocation and a trigger are used as defence-in-depth.

-- ── Task 146: Revoke UPDATE and DELETE from all non-superuser roles ───────────
-- PUBLIC is the implicit grant holder for all non-superuser roles.
-- Revoking from PUBLIC removes the ability for the application role ('postgres'
-- in dev; a least-privilege role in production) to mutate rows.
REVOKE UPDATE, DELETE ON TABLE "audit_logs" FROM PUBLIC;

--> statement-breakpoint

-- ── Task 147: Hard trigger — raises an exception for any UPDATE or DELETE ─────
-- This is the authoritative enforcement mechanism: even if the DB role is
-- granted UPDATE/DELETE rights in future (e.g. by mistake), the trigger will
-- still fire and abort the statement.

CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is immutable — % is forbidden on this table. '
    'All audit records must be preserved for reconciliation and accountability.',
    TG_OP;
END;
$$;

--> statement-breakpoint

-- Fires BEFORE UPDATE OR DELETE on every row attempt, aborting the statement
-- before any change is written to disk.
DROP TRIGGER IF EXISTS audit_logs_immutability ON "audit_logs";
CREATE TRIGGER audit_logs_immutability
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_modification();
