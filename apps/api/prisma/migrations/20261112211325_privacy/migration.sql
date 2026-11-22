-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "geo_notice_accepted_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "pushed_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN     "photos_purged_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "notifications_pushed_at_created_at_idx" ON "notifications"("pushed_at", "created_at");

-- Los avisos que ya existían se dan por enviados: no hay que repetir ningún push.
UPDATE "notifications" SET "pushed_at" = "created_at";
