-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SUB_ADMIN', 'TASKER');

-- CreateEnum
CREATE TYPE "TaskCategory" AS ENUM ('STANDARD', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TaskState" AS ENUM ('DRAFT', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'IN_REVIEW', 'PENDING_VERIFICATION', 'REWORK', 'PAUSED', 'CLOSED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AccountState" AS ENUM ('HEALTHY', 'COOLDOWN', 'CHALLENGED', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WEB', 'TELEGRAM', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ReviewStage" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "TutorialKind" AS ENUM ('ONBOARDING', 'TASK');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'CLAIMED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('ACCOUNT_BLOCKED', 'CREDENTIALS_WRONG', 'TASK_UNCLEAR', 'PLATFORM_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "AccountIssueCause" AS ENUM ('ROUTINE_CHALLENGE', 'ACCESS_CHANGED', 'PRE_FLAGGED', 'TASKER_FAULT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "name" TEXT NOT NULL,
    "preferredName" TEXT,
    "phone" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "telegramUserId" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "TaskCategory" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currentSpecVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecVersion" (
    "id" TEXT NOT NULL,
    "taskTypeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "checklist" JSONB NOT NULL,
    "tutorialId" TEXT,
    "quizId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tutorial" (
    "id" TEXT NOT NULL,
    "kind" "TutorialKind" NOT NULL DEFAULT 'TASK',
    "provider" TEXT NOT NULL DEFAULT 'local',
    "storageRef" TEXT,
    "order" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "videoUrl" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tutorial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorialProgress" (
    "id" TEXT NOT NULL,
    "taskerId" TEXT NOT NULL,
    "tutorialId" TEXT NOT NULL,
    "furthestSeconds" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TutorialProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL,
    "questionsJson" JSONB NOT NULL,
    "passPercent" INTEGER NOT NULL DEFAULT 70,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "taskerId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "answersJson" JSONB NOT NULL,
    "scorePercent" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL,
    "taskerId" TEXT NOT NULL,
    "taskTypeId" TEXT NOT NULL,
    "specVersionId" TEXT NOT NULL,
    "certifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "label" TEXT,
    "platform" TEXT,
    "loginUrl" TEXT,
    "notes" TEXT,
    "state" "AccountState" NOT NULL DEFAULT 'HEALTHY',
    "cooldownUntil" TIMESTAMP(3),
    "addedById" TEXT,
    "addedVia" "Channel" NOT NULL DEFAULT 'WEB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountSecret" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountHold" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskerId" TEXT NOT NULL,
    "heldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "AccountHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialReveal" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "taskId" TEXT,
    "actorId" TEXT NOT NULL,
    "revealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "CredentialReveal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "taskTypeId" TEXT NOT NULL,
    "specVersionId" TEXT NOT NULL,
    "category" "TaskCategory" NOT NULL,
    "state" "TaskState" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "accountId" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdVia" "Channel" NOT NULL,
    "dueAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "hoursReported" DECIMAL(65,30),
    "hoursFlagged" BOOLEAN NOT NULL DEFAULT false,
    "hoursFlagReason" TEXT,
    "pausedForTaskId" TEXT,
    "reworkOfTaskId" TEXT,
    "reworkCount" INTEGER NOT NULL DEFAULT 0,
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskOffer" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskerId" TEXT NOT NULL,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "TaskOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proof" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "checklistKey" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "phash" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "telegramFileId" TEXT,
    "duplicateOfId" TEXT,

    CONSTRAINT "Proof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stage" "ReviewStage" NOT NULL,
    "outcome" "ReviewOutcome" NOT NULL,
    "actorId" TEXT NOT NULL,
    "onBehalfOfId" TEXT,
    "channel" "Channel" NOT NULL,
    "note" TEXT,
    "citedProofId" TEXT,
    "reason" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromState" "TaskState",
    "toState" "TaskState" NOT NULL,
    "actorId" TEXT,
    "onBehalfOfId" TEXT,
    "channel" "Channel" NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkRequest" (
    "id" TEXT NOT NULL,
    "taskerId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "WorkRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskerStats" (
    "taskerId" TEXT NOT NULL,
    "approvalRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closedCount" INTEGER NOT NULL DEFAULT 0,
    "medianSubmitMinutes" INTEGER NOT NULL DEFAULT 0,
    "reworkRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "windowDays" INTEGER NOT NULL DEFAULT 60,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskerStats_pkey" PRIMARY KEY ("taskerId")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "taskerId" TEXT NOT NULL,
    "taskId" TEXT,
    "accountId" TEXT,
    "cause" "AccountIssueCause" NOT NULL,
    "note" TEXT,
    "actorId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramLinkNonce" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLinkNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "taskerId" TEXT NOT NULL,
    "taskId" TEXT,
    "accountId" TEXT,
    "category" "TicketCategory" NOT NULL,
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "lastAlertedAt" TIMESTAMP(3),
    "alertCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskType_name_key" ON "TaskType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SpecVersion_tutorialId_key" ON "SpecVersion"("tutorialId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecVersion_quizId_key" ON "SpecVersion"("quizId");

-- CreateIndex
CREATE UNIQUE INDEX "SpecVersion_taskTypeId_version_key" ON "SpecVersion"("taskTypeId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TutorialProgress_taskerId_tutorialId_key" ON "TutorialProgress"("taskerId", "tutorialId");

-- CreateIndex
CREATE INDEX "QuizAttempt_taskerId_createdAt_idx" ON "QuizAttempt"("taskerId", "createdAt");

-- CreateIndex
CREATE INDEX "Certification_taskerId_taskTypeId_supersededAt_idx" ON "Certification"("taskerId", "taskTypeId", "supersededAt");

-- CreateIndex
CREATE UNIQUE INDEX "Certification_taskerId_specVersionId_key" ON "Certification"("taskerId", "specVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_ref_key" ON "Account"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSecret_accountId_key" ON "AccountSecret"("accountId");

-- CreateIndex
CREATE INDEX "AccountHold_accountId_releasedAt_idx" ON "AccountHold"("accountId", "releasedAt");

-- CreateIndex
CREATE INDEX "CredentialReveal_accountId_revealedAt_idx" ON "CredentialReveal"("accountId", "revealedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_code_key" ON "Task"("code");

-- CreateIndex
CREATE INDEX "Task_state_dueAt_idx" ON "Task"("state", "dueAt");

-- CreateIndex
CREATE INDEX "Task_assigneeId_state_idx" ON "Task"("assigneeId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "TaskOffer_taskId_taskerId_key" ON "TaskOffer"("taskId", "taskerId");

-- CreateIndex
CREATE INDEX "Proof_phash_idx" ON "Proof"("phash");

-- CreateIndex
CREATE UNIQUE INDEX "Proof_taskId_checklistKey_key" ON "Proof"("taskId", "checklistKey");

-- CreateIndex
CREATE INDEX "Review_taskId_decidedAt_idx" ON "Review"("taskId", "decidedAt");

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_at_idx" ON "TaskEvent"("taskId", "at");

-- CreateIndex
CREATE INDEX "WorkRequest_taskerId_resolvedAt_idx" ON "WorkRequest"("taskerId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLinkNonce_nonce_key" ON "TelegramLinkNonce"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_code_key" ON "Ticket"("code");

-- CreateIndex
CREATE INDEX "Ticket_status_createdAt_idx" ON "Ticket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_taskerId_createdAt_idx" ON "Ticket"("taskerId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "SpecVersion" ADD CONSTRAINT "SpecVersion_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "TaskType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecVersion" ADD CONSTRAINT "SpecVersion_tutorialId_fkey" FOREIGN KEY ("tutorialId") REFERENCES "Tutorial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecVersion" ADD CONSTRAINT "SpecVersion_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorialProgress" ADD CONSTRAINT "TutorialProgress_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorialProgress" ADD CONSTRAINT "TutorialProgress_tutorialId_fkey" FOREIGN KEY ("tutorialId") REFERENCES "Tutorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_specVersionId_fkey" FOREIGN KEY ("specVersionId") REFERENCES "SpecVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountSecret" ADD CONSTRAINT "AccountSecret_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountHold" ADD CONSTRAINT "AccountHold_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountHold" ADD CONSTRAINT "AccountHold_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountHold" ADD CONSTRAINT "AccountHold_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialReveal" ADD CONSTRAINT "CredentialReveal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "TaskType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_specVersionId_fkey" FOREIGN KEY ("specVersionId") REFERENCES "SpecVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_pausedForTaskId_fkey" FOREIGN KEY ("pausedForTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_reworkOfTaskId_fkey" FOREIGN KEY ("reworkOfTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOffer" ADD CONSTRAINT "TaskOffer_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOffer" ADD CONSTRAINT "TaskOffer_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proof" ADD CONSTRAINT "Proof_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proof" ADD CONSTRAINT "Proof_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Proof"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkRequest" ADD CONSTRAINT "WorkRequest_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskerStats" ADD CONSTRAINT "TaskerStats_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLinkNonce" ADD CONSTRAINT "TelegramLinkNonce_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_taskerId_fkey" FOREIGN KEY ("taskerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Rules Prisma cannot express, kept in the database where they cannot be skipped.
-- Prisma does not model partial indexes: if `prisma migrate dev` ever proposes
-- DROP INDEX "account_hold_one_open", delete that line from the new migration.
-- ---------------------------------------------------------------------------

-- Invariant 3 (account exclusivity) lives in the database, not in application logic.
-- An account has at most one open hold; a second INSERT fails rather than racing.
CREATE UNIQUE INDEX IF NOT EXISTS account_hold_one_open
  ON "AccountHold" ("accountId")
  WHERE "releasedAt" IS NULL;

-- A task that has reached a submitted state cannot exist without the moment it
-- was submitted. The value is written from the server clock and never accepted
-- from a client, and this makes the absence of one unrepresentable rather than
-- merely unlikely.
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS task_submitted_has_timestamp;
ALTER TABLE "Task" ADD CONSTRAINT task_submitted_has_timestamp CHECK (
  "state" NOT IN ('SUBMITTED', 'IN_REVIEW', 'PENDING_VERIFICATION', 'REWORK', 'CLOSED')
  OR "submittedAt" IS NOT NULL
);
