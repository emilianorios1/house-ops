ALTER TABLE "shared_users" ADD COLUMN "pushTestAt" TIMESTAMP(3);
CREATE TABLE "shared_push_subscriptions" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "shared_users"("id"),
  "endpoint" TEXT NOT NULL UNIQUE, "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "reminders" BOOLEAN NOT NULL DEFAULT true,
  "movements" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "shared_push_subscriptions_userId_enabled_idx" ON "shared_push_subscriptions"("userId", "enabled");
CREATE TABLE "shared_notification_events" (
  "id" TEXT PRIMARY KEY, "key" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL REFERENCES "shared_users"("id"),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('movement','reminder','test')),
  "month" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "shared_notification_deliveries" (
  "id" TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL REFERENCES "shared_notification_events"("id"),
  "subscriptionId" TEXT NOT NULL REFERENCES "shared_push_subscriptions"("id"),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','sent','skipped','failed')),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "deliveredAt" TIMESTAMP(3),
  UNIQUE ("eventId", "subscriptionId")
);
CREATE INDEX "shared_notification_deliveries_status_nextAttemptAt_idx" ON "shared_notification_deliveries"("status", "nextAttemptAt");
