-- CreateEnum
CREATE TYPE "plan" AS ENUM ('STARTER', 'TEAM', 'BUSINESS');

-- CreateEnum
CREATE TYPE "billing_interval" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "billing_status" AS ENUM ('PENDING', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "billing_customer_id" TEXT,
ADD COLUMN     "billing_ends_at" TIMESTAMPTZ(3),
ADD COLUMN     "billing_interval" "billing_interval",
ADD COLUMN     "billing_status" "billing_status",
ADD COLUMN     "billing_subscription_id" TEXT,
ADD COLUMN     "billing_synced_at" TIMESTAMPTZ(3),
ADD COLUMN     "grace_ends_at" TIMESTAMPTZ(3),
ADD COLUMN     "plan" "plan",
ADD COLUMN     "renews_at" TIMESTAMPTZ(3),
ADD COLUMN     "trial_ends_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "digest" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "organization_id" UUID,
    "subscription_id" TEXT,
    "outcome" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_digest_key" ON "billing_events"("digest");

-- CreateIndex
CREATE INDEX "billing_events_organization_id_created_at_idx" ON "billing_events"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_billing_subscription_id_key" ON "organizations"("billing_subscription_id");

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

