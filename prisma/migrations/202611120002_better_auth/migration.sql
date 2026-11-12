CREATE TABLE "shared_auth_users" (
  "id" TEXT PRIMARY KEY REFERENCES "shared_users"("id"), "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE, "emailVerified" BOOLEAN NOT NULL DEFAULT false, "image" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "shared_auth_sessions" (
  "id" TEXT PRIMARY KEY, "expiresAt" TIMESTAMP(3) NOT NULL, "token" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "ipAddress" TEXT, "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "shared_auth_users"("id") ON DELETE CASCADE
);
CREATE INDEX "shared_auth_sessions_userId_idx" ON "shared_auth_sessions"("userId");
CREATE TABLE "shared_auth_accounts" (
  "id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "shared_auth_users"("id") ON DELETE CASCADE,
  "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT, "accessTokenExpiresAt" TIMESTAMP(3),
  "refreshTokenExpiresAt" TIMESTAMP(3), "scope" TEXT, "password" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX "shared_auth_accounts_userId_idx" ON "shared_auth_accounts"("userId");
CREATE TABLE "shared_auth_verifications" (
  "id" TEXT PRIMARY KEY, "identifier" TEXT NOT NULL, "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "shared_auth_verifications_identifier_idx" ON "shared_auth_verifications"("identifier");
INSERT INTO "shared_auth_users" ("id","name","email","updatedAt")
SELECT "id","name","username" || '@casa.invalid',CURRENT_TIMESTAMP FROM "shared_users"
WHERE "username" IN ('emiliano','vitoria');
INSERT INTO "shared_auth_accounts" ("id","accountId","providerId","userId","password","updatedAt")
SELECT 'credential-' || "id","id",'credential',"id","passwordHash",CURRENT_TIMESTAMP FROM "shared_users"
WHERE "username" IN ('emiliano','vitoria');
