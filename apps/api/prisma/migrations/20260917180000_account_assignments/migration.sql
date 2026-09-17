-- CreateEnum
CREATE TYPE "AccountAccess" AS ENUM ('MORELOGIN', 'RDP', 'OTHER');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "accessType" "AccountAccess" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "owner" TEXT;

-- CreateTable
CREATE TABLE "AccountAssignment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "taskerId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Tasker',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,
    "collectedAt" TIMESTAMP(3),
    "collectedById" TEXT,

    CONSTRAINT "AccountAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountAssignment_accountId_collectedAt_idx" ON "AccountAssignment"("accountId", "collectedAt");

-- CreateIndex
CREATE INDEX "AccountAssignment_taskerId_collectedAt_idx" ON "AccountAssignment"("taskerId", "collectedAt");

-- AddForeignKey
ALTER TABLE "AccountAssignment" ADD CONSTRAINT "AccountAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAssignment" ADD CONSTRAINT "AccountAssignment_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAssignment" ADD CONSTRAINT "AccountAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAssignment" ADD CONSTRAINT "AccountAssignment_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One live assignment per person per account, enforced by the database.
-- Prisma cannot model partial indexes: if `prisma migrate dev` ever proposes
-- DROP INDEX "account_assignment_one_live", delete that line from the new migration.
CREATE UNIQUE INDEX IF NOT EXISTS account_assignment_one_live
  ON "AccountAssignment" ("accountId", "taskerId")
  WHERE "collectedAt" IS NULL;
