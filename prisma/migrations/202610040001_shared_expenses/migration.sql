-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "shared_users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_documents" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "legacyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_expenses" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "extraordinaryCents" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "documentId" TEXT,
    "sourceKey" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_rents" (
    "month" TEXT NOT NULL,
    "grossCents" BIGINT NOT NULL,
    "creditOverrideCents" BIGINT,
    "creditReason" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_rents_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "shared_payments" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT,
    "rentMonth" TEXT,
    "payer" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "paidAt" DATE NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_settlements" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "paidAt" DATE NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_audit_events" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_login_attempts" (
    "username" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_login_attempts_pkey" PRIMARY KEY ("username")
);

-- CreateIndex
CREATE UNIQUE INDEX "shared_users_username_key" ON "shared_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "shared_documents_sha256_key" ON "shared_documents"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "shared_documents_legacyId_key" ON "shared_documents"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "shared_expenses_sourceKey_key" ON "shared_expenses"("sourceKey");

-- CreateIndex
CREATE INDEX "shared_expenses_dueDate_archived_idx" ON "shared_expenses"("dueDate", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "shared_payments_sourceKey_key" ON "shared_payments"("sourceKey");

-- CreateIndex
CREATE INDEX "shared_settlements_month_idx" ON "shared_settlements"("month");

-- CreateIndex
CREATE INDEX "shared_audit_events_createdAt_idx" ON "shared_audit_events"("createdAt");

-- AddForeignKey
ALTER TABLE "shared_expenses" ADD CONSTRAINT "shared_expenses_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "shared_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_payments" ADD CONSTRAINT "shared_payments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "shared_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_payments" ADD CONSTRAINT "shared_payments_rentMonth_fkey" FOREIGN KEY ("rentMonth") REFERENCES "shared_rents"("month") ON DELETE SET NULL ON UPDATE CASCADE;
