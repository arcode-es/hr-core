-- CreateEnum
CREATE TYPE "presence_method" AS ENUM ('GPS', 'QR', 'KIOSK', 'NONE');

-- CreateEnum
CREATE TYPE "alert_kind" AS ENUM ('MISSED_CLOCK_IN', 'LONG_WORKDAY', 'SHORT_REST', 'LONG_ORDINARY_DAY', 'OVERTIME_YEAR_70', 'OVERTIME_YEAR_100');

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'ALERT';

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "qr_code" TEXT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "kiosk_card_code" TEXT,
ADD COLUMN     "kiosk_locked_until" TIMESTAMPTZ(3),
ADD COLUMN     "kiosk_pin_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kiosk_pin_hash" TEXT;

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN     "late_minutes" INTEGER,
ADD COLUMN     "photo_missing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "presence_method" "presence_method" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "kiosk_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "location_id" UUID,
    "name" TEXT NOT NULL,
    "token_hash" TEXT,
    "pairing_code_hash" TEXT,
    "pairing_expires_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosk_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "alert_kind" NOT NULL,
    "date" DATE NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" UUID,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_devices_token_hash_key" ON "kiosk_devices"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_devices_pairing_code_hash_key" ON "kiosk_devices"("pairing_code_hash");

-- CreateIndex
CREATE INDEX "kiosk_devices_organization_id_idx" ON "kiosk_devices"("organization_id");

-- CreateIndex
CREATE INDEX "alerts_organization_id_resolved_at_idx" ON "alerts"("organization_id", "resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_organization_id_user_id_kind_date_key" ON "alerts"("organization_id", "user_id", "kind", "date");

-- CreateIndex
CREATE UNIQUE INDEX "locations_qr_code_key" ON "locations"("qr_code");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_kiosk_card_code_key" ON "memberships"("kiosk_card_code");

-- AddForeignKey
ALTER TABLE "kiosk_devices" ADD CONSTRAINT "kiosk_devices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_devices" ADD CONSTRAINT "kiosk_devices_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Los tramos que ya tenían posición se comprobaron por GPS.
UPDATE "time_entries" SET "presence_method" = 'GPS' WHERE "start_lat" IS NOT NULL;
