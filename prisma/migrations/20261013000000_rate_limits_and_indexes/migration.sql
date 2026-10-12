-- CreateTable
CREATE TABLE IF NOT EXISTS "rate_limits" (
    "key" VARCHAR(255) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "reset_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "rate_limits_reset_at_idx" ON "rate_limits"("reset_at");

-- Performance indexes for high concurrency & sorting
CREATE INDEX IF NOT EXISTS "registrations_created_at_idx" ON "registrations"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "registrations_event_id_created_at_idx" ON "registrations"("event_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "registrations_event_id_status_idx" ON "registrations"("event_id", "status");
CREATE INDEX IF NOT EXISTS "registrations_student_id_status_idx" ON "registrations"("student_id", "status");
