-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN     "replaces_workday_id" UUID;

-- CreateIndex
CREATE INDEX "time_entries_replaces_workday_id_idx" ON "time_entries"("replaces_workday_id");
