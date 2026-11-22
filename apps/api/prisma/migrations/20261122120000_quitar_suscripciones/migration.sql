-- HR-Core deja de tener servicio de suscripción: se retiran las tablas y columnas del cobro y de la aceptación de condiciones.

-- DropForeignKey
ALTER TABLE "billing_events" DROP CONSTRAINT "billing_events_organization_id_fkey";

-- DropIndex
DROP INDEX "organizations_billing_subscription_id_key";

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "billing_customer_id",
DROP COLUMN "billing_ends_at",
DROP COLUMN "billing_interval",
DROP COLUMN "billing_status",
DROP COLUMN "billing_subscription_id",
DROP COLUMN "billing_synced_at",
DROP COLUMN "grace_ends_at",
DROP COLUMN "plan",
DROP COLUMN "renews_at",
DROP COLUMN "terms_accepted_at",
DROP COLUMN "terms_accepted_ip",
DROP COLUMN "terms_version",
DROP COLUMN "trial_ends_at";

-- DropTable
DROP TABLE "billing_events";

-- DropEnum
DROP TYPE "billing_interval";

-- DropEnum
DROP TYPE "billing_status";

-- DropEnum
DROP TYPE "plan";

