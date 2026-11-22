-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "is_demo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMPTZ(3),
ADD COLUMN     "failed_logins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "error" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_created_at_idx" ON "email_verification_tokens"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "job_runs_started_at_idx" ON "job_runs"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_job_slot_key" ON "job_runs"("job", "slot");

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Las cuentas que ya existían se dan por verificadas.
UPDATE "users" SET "email_verified_at" = "created_at";

-- ── Purga de la empresa de demostración ─────────────────────────────────
-- Los fichajes y su historial siguen sin poder borrarse. La única excepción es
-- la empresa marcada como demo, y solo dentro de una transacción que active
-- expresamente la purga (SET LOCAL hr.demo_purge = 'on'). Las empresas reales
-- y los espacios personales quedan igual de protegidos que antes.
CREATE FUNCTION forbid_delete_unless_demo_purge() RETURNS trigger AS $$
DECLARE
  org uuid;
BEGIN
  IF current_setting('hr.demo_purge', true) = 'on' THEN
    IF TG_TABLE_NAME = 'time_entries' THEN
      org := OLD.organization_id;
    ELSE
      SELECT t.organization_id INTO org FROM time_entries t WHERE t.id = OLD.time_entry_id;
    END IF;
    IF org IS NOT NULL AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = org AND o.is_demo) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION '% no permitido en "%": registro inmutable', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER time_entry_audits_immutable ON time_entry_audits;
CREATE TRIGGER time_entry_audits_no_update
  BEFORE UPDATE ON time_entry_audits
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER time_entry_audits_no_delete
  BEFORE DELETE ON time_entry_audits
  FOR EACH ROW EXECUTE FUNCTION forbid_delete_unless_demo_purge();

DROP TRIGGER time_entries_no_delete ON time_entries;
CREATE TRIGGER time_entries_no_delete
  BEFORE DELETE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_delete_unless_demo_purge();
