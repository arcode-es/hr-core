-- CreateTable
CREATE TABLE "handover_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "recipient_id" UUID,
    "location_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_to_id" UUID,
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "handover_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "handover_notes_organization_id_delivered_at_created_at_idx" ON "handover_notes"("organization_id", "delivered_at", "created_at");

-- CreateIndex
CREATE INDEX "handover_notes_delivered_to_id_read_at_idx" ON "handover_notes"("delivered_to_id", "read_at");

-- CreateIndex
CREATE INDEX "handover_notes_author_id_created_at_idx" ON "handover_notes"("author_id", "created_at");

-- AddForeignKey
ALTER TABLE "handover_notes" ADD CONSTRAINT "handover_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_notes" ADD CONSTRAINT "handover_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_notes" ADD CONSTRAINT "handover_notes_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_notes" ADD CONSTRAINT "handover_notes_delivered_to_id_fkey" FOREIGN KEY ("delivered_to_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_notes" ADD CONSTRAINT "handover_notes_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

