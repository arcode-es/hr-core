-- Extensiones necesarias antes de crear las tablas.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('ADMIN', 'MANAGER', 'EMPLOYEE', 'INSPECTOR');

-- CreateEnum
CREATE TYPE "entry_type" AS ENUM ('WORK', 'BREAK', 'TRAVEL');

-- CreateEnum
CREATE TYPE "break_kind" AS ENUM ('MEAL', 'REST', 'OTHER');

-- CreateEnum
CREATE TYPE "entry_origin" AS ENUM ('REALTIME', 'MANUAL');

-- CreateEnum
CREATE TYPE "approval_status" AS ENUM ('APPROVED', 'PENDING', 'REJECTED');

-- CreateEnum
CREATE TYPE "expense_category" AS ENUM ('MEAL', 'FUEL', 'TOLL', 'LODGING', 'MATERIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "expense_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REIMBURSED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('COMPANY_CARD', 'EMPLOYEE_PAID');

-- CreateEnum
CREATE TYPE "document_category" AS ENUM ('PAYROLL', 'CONTRACT', 'SAFETY', 'CERTIFICATE', 'ANNOUNCEMENT', 'MEDICAL_LEAVE', 'OTHER');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('SENT', 'VIEWED', 'SIGNED');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('SHIFT_PUBLISHED', 'SHIFT_UPDATED', 'TIME_ENTRY_PENDING', 'TIME_ENTRY_REVIEWED', 'EXPENSE_PENDING', 'EXPENSE_REVIEWED', 'DOCUMENT_RECEIVED', 'DOCUMENT_SIGNED', 'INVITATION');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "dni_nie" TEXT,
    "phone" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "is_superadmin" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" "membership_role" NOT NULL DEFAULT 'EMPLOYEE',
    "job_title" TEXT,
    "weekly_hours" DECIMAL(5,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role" "membership_role" NOT NULL DEFAULT 'EMPLOYEE',
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "user_agent" TEXT,
    "ip_address" INET,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "geofence_radius_meters" INTEGER NOT NULL DEFAULT 200,
    "color" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "geom" geography(Point, 4326),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "user_id" UUID NOT NULL,
    "location_id" UUID,
    "date" DATE NOT NULL,
    "planned_start" TIMESTAMPTZ(3) NOT NULL,
    "planned_end" TIMESTAMPTZ(3) NOT NULL,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "user_id" UUID NOT NULL,
    "workday_id" UUID NOT NULL,
    "shift_id" UUID,
    "location_id" UUID,
    "entry_type" "entry_type" NOT NULL DEFAULT 'WORK',
    "break_kind" "break_kind",
    "start_time" TIMESTAMPTZ(3) NOT NULL,
    "end_time" TIMESTAMPTZ(3),
    "client_start_time" TIMESTAMPTZ(3),
    "client_end_time" TIMESTAMPTZ(3),
    "start_lat" DOUBLE PRECISION,
    "start_lng" DOUBLE PRECISION,
    "start_accuracy" DOUBLE PRECISION,
    "start_address" TEXT,
    "end_lat" DOUBLE PRECISION,
    "end_lng" DOUBLE PRECISION,
    "end_accuracy" DOUBLE PRECISION,
    "end_address" TEXT,
    "is_within_geofence" BOOLEAN,
    "geofence_distance_meters" INTEGER,
    "start_photo_key" TEXT,
    "end_photo_key" TEXT,
    "origin" "entry_origin" NOT NULL DEFAULT 'REALTIME',
    "synced_offline" BOOLEAN NOT NULL DEFAULT false,
    "client_uuid" UUID,
    "approval_status" "approval_status" NOT NULL DEFAULT 'APPROVED',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "notes" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entry_audits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "time_entry_id" UUID NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "old_values_json" JSONB,
    "new_values_json" JSONB,
    "reason" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" INET,
    "user_agent" TEXT,

    CONSTRAINT "time_entry_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "user_id" UUID NOT NULL,
    "location_id" UUID,
    "category" "expense_category" NOT NULL,
    "custom_category_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "date" DATE NOT NULL,
    "merchant_name" TEXT,
    "merchant_tax_id" TEXT,
    "payment_method" "payment_method" NOT NULL DEFAULT 'EMPLOYEE_PAID',
    "distance_km" DECIMAL(8,2),
    "receipt_photo_key" TEXT,
    "ocr_data_json" JSONB,
    "notes" TEXT,
    "status" "expense_status" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "reimbursed_at" TIMESTAMPTZ(3),
    "client_uuid" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_category" "expense_category" NOT NULL DEFAULT 'OTHER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "batch_id" UUID,
    "title" TEXT NOT NULL,
    "category" "document_category" NOT NULL DEFAULT 'OTHER',
    "original_file_key" TEXT NOT NULL,
    "original_file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "original_sha256" CHAR(64) NOT NULL,
    "requires_signature" BOOLEAN NOT NULL DEFAULT false,
    "status" "document_status" NOT NULL DEFAULT 'SENT',
    "viewed_at" TIMESTAMPTZ(3),
    "signed_at" TIMESTAMPTZ(3),
    "signed_file_key" TEXT,
    "signature_audit_json" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "type" "notification_type" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_organization_id_role_idx" ON "memberships"("organization_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_organization_id_key" ON "memberships"("user_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_organization_id_email_idx" ON "invitations"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "locations_organization_id_is_active_idx" ON "locations"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "locations_user_id_is_active_idx" ON "locations"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "locations_geom_idx" ON "locations" USING GIST ("geom");

-- CreateIndex
CREATE INDEX "shifts_user_id_date_idx" ON "shifts"("user_id", "date");

-- CreateIndex
CREATE INDEX "shifts_organization_id_date_idx" ON "shifts"("organization_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "time_entries_client_uuid_key" ON "time_entries"("client_uuid");

-- CreateIndex
CREATE INDEX "time_entries_user_id_start_time_idx" ON "time_entries"("user_id", "start_time");

-- CreateIndex
CREATE INDEX "time_entries_organization_id_start_time_idx" ON "time_entries"("organization_id", "start_time");

-- CreateIndex
CREATE INDEX "time_entries_organization_id_approval_status_idx" ON "time_entries"("organization_id", "approval_status");

-- CreateIndex
CREATE INDEX "time_entries_workday_id_idx" ON "time_entries"("workday_id");

-- CreateIndex
CREATE INDEX "time_entry_audits_time_entry_id_changed_at_idx" ON "time_entry_audits"("time_entry_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_client_uuid_key" ON "expenses"("client_uuid");

-- CreateIndex
CREATE INDEX "expenses_user_id_date_idx" ON "expenses"("user_id", "date");

-- CreateIndex
CREATE INDEX "expenses_organization_id_status_idx" ON "expenses"("organization_id", "status");

-- CreateIndex
CREATE INDEX "expenses_organization_id_date_idx" ON "expenses"("organization_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_organization_id_name_key" ON "expense_categories"("organization_id", "name");

-- CreateIndex
CREATE INDEX "documents_recipient_id_status_idx" ON "documents"("recipient_id", "status");

-- CreateIndex
CREATE INDEX "documents_organization_id_created_at_idx" ON "documents"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_batch_id_idx" ON "documents"("batch_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry_audits" ADD CONSTRAINT "time_entry_audits_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry_audits" ADD CONSTRAINT "time_entry_audits_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_custom_category_id_fkey" FOREIGN KEY ("custom_category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════
-- SQL manual: lo que Prisma no puede expresar en schema.prisma
-- ════════════════════════════════════════════════════════════════════════

-- ── PostGIS: `locations.geom` se deriva siempre de latitude/longitude ────
CREATE FUNCTION locations_sync_geom() RETURNS trigger AS $$
BEGIN
  NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER locations_sync_geom
  BEFORE INSERT OR UPDATE OF latitude, longitude, geom ON locations
  FOR EACH ROW EXECUTE FUNCTION locations_sync_geom();

-- ── Integridad de dominio ────────────────────────────────────────────────
ALTER TABLE locations
  -- Una ubicación es de una organización o personal de un usuario, nunca ambas.
  ADD CONSTRAINT locations_owner_check CHECK ((organization_id IS NULL) <> (user_id IS NULL)),
  ADD CONSTRAINT locations_latitude_check CHECK (latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT locations_longitude_check CHECK (longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT locations_radius_check CHECK (geofence_radius_meters BETWEEN 10 AND 50000);

ALTER TABLE shifts
  ADD CONSTRAINT shifts_range_check CHECK (planned_end > planned_start),
  ADD CONSTRAINT shifts_break_check CHECK (break_minutes >= 0);

ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_range_check CHECK (end_time IS NULL OR end_time >= start_time),
  ADD CONSTRAINT time_entries_break_kind_check CHECK (break_kind IS NULL OR entry_type = 'BREAK'),
  ADD CONSTRAINT time_entries_rejection_check
    CHECK (approval_status <> 'REJECTED' OR rejection_reason IS NOT NULL);

ALTER TABLE expenses
  ADD CONSTRAINT expenses_amount_check CHECK (amount >= 0),
  ADD CONSTRAINT expenses_tax_check CHECK (tax_amount IS NULL OR (tax_amount >= 0 AND tax_amount <= amount)),
  ADD CONSTRAINT expenses_rejection_check CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL);

ALTER TABLE time_entry_audits
  ADD CONSTRAINT time_entry_audits_reason_check CHECK (length(btrim(reason)) > 0);

-- Un usuario solo puede tener un tramo abierto a la vez en cada espacio
-- (el personal y cada organización cuentan por separado).
CREATE UNIQUE INDEX time_entries_one_open_per_workspace
  ON time_entries (user_id, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE end_time IS NULL AND voided_at IS NULL;

-- ── Inmutabilidad legal ──────────────────────────────────────────────────
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% no permitido en "%": registro inmutable', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

-- El historial de cambios no se edita ni se borra.
CREATE TRIGGER time_entry_audits_immutable
  BEFORE UPDATE OR DELETE ON time_entry_audits
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER time_entry_audits_no_truncate
  BEFORE TRUNCATE ON time_entry_audits
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Los fichajes nunca se borran: se anulan con voided_at dejando rastro en la auditoría.
CREATE TRIGGER time_entries_no_delete
  BEFORE DELETE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
