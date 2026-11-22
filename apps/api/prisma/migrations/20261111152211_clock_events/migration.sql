-- CreateTable
CREATE TABLE "clock_events" (
    "client_uuid" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clock_events_pkey" PRIMARY KEY ("client_uuid")
);

-- CreateIndex
CREATE INDEX "clock_events_user_id_idx" ON "clock_events"("user_id");
