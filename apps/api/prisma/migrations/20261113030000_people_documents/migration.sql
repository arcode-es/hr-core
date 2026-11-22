-- AlterEnum
ALTER TYPE "document_category" ADD VALUE 'TIMESHEET';

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'DOCUMENT_REMINDER';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "due_date" DATE,
ADD COLUMN     "last_reminder_at" TIMESTAMPTZ(3),
ADD COLUMN     "period" TEXT,
ADD COLUMN     "reminders_sent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "department_id" UUID,
ADD COLUMN     "dni_nie" TEXT,
ADD COLUMN     "full_name" TEXT,
ADD COLUMN     "job_title" TEXT,
ADD COLUMN     "last_sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "send_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "weekly_hours" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "department_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_prefs" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_managers" (
    "department_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,

    CONSTRAINT "department_managers_pkey" PRIMARY KEY ("department_id","membership_id")
);

-- CreateTable
CREATE TABLE "payroll_imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "page_count" INTEGER NOT NULL,
    "pages" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_organization_id_name_key" ON "departments"("organization_id", "name");

-- CreateIndex
CREATE INDEX "payroll_imports_expires_at_idx" ON "payroll_imports"("expires_at");

-- CreateIndex
CREATE INDEX "documents_due_date_idx" ON "documents"("due_date");

-- CreateIndex
CREATE INDEX "documents_organization_id_category_period_idx" ON "documents"("organization_id", "category", "period");

-- CreateIndex
CREATE INDEX "memberships_department_id_idx" ON "memberships"("department_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_managers" ADD CONSTRAINT "department_managers_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_managers" ADD CONSTRAINT "department_managers_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_imports" ADD CONSTRAINT "payroll_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_imports" ADD CONSTRAINT "payroll_imports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Un único registro de jornada mensual por persona y mes (solo esos documentos llevan periodo).
CREATE UNIQUE INDEX "documents_period_recipient_key" ON "documents"("organization_id", "recipient_id", "period") WHERE "period" IS NOT NULL;
