# Tasker Operations Platform

Management layer for an outsourced task operation. The work happens on an
external platform; this system decides **who does what, on which account, with
what training, and whether the result was acceptable**.

Built against the v0.1 PRD. Section references below point back at it.

---

## Run it

Four terminals. Postgres and Redis come up in Docker; the apps run on the host.

```bash
# 1. dependencies (Postgres 16 on 5433, Redis 7 on 6380)
docker compose -f infrastructure/docker-compose.dev.yml up -d

# 2. schema + demo data (the seed EMPTIES the database first)
pnpm db:migrate
pnpm db:seed

# 3. orchestrator          -> http://localhost:3001
pnpm --filter @tasker/api start:dev

# 4. web (tasker + console) -> http://localhost:3000
pnpm --filter @tasker/web dev
```

Ports 5433/6380 are deliberate, so this never collides with a Postgres or
Redis you already have running.

Schema changes go through migrations: edit `prisma/schema.prisma`, then
`pnpm --filter @tasker/api prisma:migrate`. Prisma cannot model the partial
unique index on account holds, so if a new migration tries to
`DROP INDEX "account_hold_one_open"`, delete that line before applying it.

### Sign in

| Role | Email | Password |
|---|---|---|
| Admin | `admin@tasker.dev` | `password` |
| Sub-admin | `sub@tasker.dev` | `password` |
| Tasker | `chidi@tasker.dev` | `password` |

Other taskers: `funke`, `emeka`, `zainab`, `ibrahim` — all `@tasker.dev` / `password`.

These exist only in the local demo seed. The login page shows shortcut buttons
for them when `NEXT_PUBLIC_DEMO_LOGINS=true` is in `apps/web/.env.local`; a
deployed site never does.

### The bot (optional)

Needs a token from @BotFather:

```bash
cd apps/bot
# put TELEGRAM_BOT_TOKEN=... in .env
./venv/Scripts/python.exe main.py     # Windows
```

Then sign into the console as the admin, request a Telegram link, and open the
`t.me/<bot>?start=<nonce>` deep link. Until a Telegram id is bound, **the bot
ignores you silently** — a bot that replies "you are not authorised" has told a
stranger it is worth probing.

| Command | What it does |
|---|---|
| `/today` | One-screen status summary |
| `/pending` | Reviews and verifications waiting, with approve and send back |
| `/tickets` | Who is blocked, with one tap to take a ticket |
| `/new` | Create a task: put it in the queue, or give it to one qualified tasker |
| `/task TSK-4014` | Jump to a task |
| `/taskers` | The pool, and what each person submitted |
| `/accounts` | The account pool, with rest, challenged, suspend and retire |
| `/account ACC-002` | Jump to an account |
| `/addaccount` | Load an account's details step by step. Messages holding a username or password are deleted from the chat as soon as they are read |
| `/help`, `/cancel` | What each command does; stop a half-finished flow |

---

## Deploy on Render (free)

Everything runs on free plans, so Render asks for no payment details.

| Where | What | Plan |
|---|---|---|
| Render web service `tasker` | The tasker app and console, the API behind them, the Telegram bot, and an in-memory Redis for alerts and bot menus, in one container | free |
| Neon | Postgres | free |
| Cloudflare R2 | Videos and proof screenshots | free tier |

Why this shape: Render gives a workspace **750 free hours a month**, enough for
exactly one service kept awake all month, and allows one free Key Value
instance, so the web app, API, bot and Redis share one container.
The database is on Neon because Render deletes free databases after 30 days;
Neon's free plan does not expire.

1. **Create the database.** Sign up at neon.com, create a project in
   *AWS Europe Central 1 (Frankfurt)*, and copy its connection string (it starts
   `postgresql://` and ends `?sslmode=require`).
2. **Open** `https://render.com/deploy?repo=https://github.com/Maxima24/tasker`.
   Render reads `render.yaml` and creates the service.
3. **Fill in what it asks for:**
   - `DATABASE_URL`: the Neon connection string.
   - `REDIS_URL` (optional): a hosted Redis such as Upstash, region
     `eu-central-1`, as its `rediss://` address. Left empty, the service runs its
     own in-memory Redis. The health check reuses its Redis result for a minute,
     so Render's frequent checks stay well inside Upstash's free 500,000
     commands a month.
   - `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PASSWORD`
     (10+ characters): the first admin, created while no admin exists. They must
     choose their own password on first sign-in.
   - `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` (without `@`).
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
     `R2_PUBLIC_URL`. Optionally `R2_PROOF_BUCKET`, a separate private bucket for
     proof screenshots. Without R2, uploads are refused, because Render wipes a
     service's disk on every deploy.
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: run `npx web-push generate-vapid-keys`.
4. **Copy `VAULT_KEY_SECRET` somewhere safe** (tasker > Environment). It encrypts
   every stored account password; lose or change it and they are unreadable.
5. **Sign in** at the service's address as the bootstrap admin, choose a
   password, link Telegram from the header, and turn on Alerts.
6. **Keep it awake:** in the GitHub repository, under Settings > Secrets and
   variables > Actions > Variables, add `TASKER_WEB_URL` with the service's
   address, then run **Keep Render awake** once from the Actions tab.

Every start applies pending migrations first; a failing migration stops the
deploy and the previous version keeps serving. The API refuses to start in
production with a missing or development secret, and the demo seed refuses to
run against production.

What free costs you:

- **Speed.** A free instance has a fraction of a CPU. Pages and uploads are
  slower than on a paid plan, and the first deploy takes several minutes.
- **Neon's limits.** 0.5 GB of storage and 100 compute hours a month. The
  database sleeps after 5 idle minutes and wakes on the next request; health
  checks and the reminder loop deliberately leave it asleep.
- **Bandwidth.** Videos stream through the service, and that counts against
  Render's free monthly bandwidth. With no payment details on file, running out
  suspends the service until the next month.
- **Occasional sleep.** GitHub can start scheduled runs late, so the service may
  sometimes sleep and take about a minute to wake.

## How the tasker flow works

Self-serve claiming, behind two gates that both come down to watching.

```
  sign in
     |
     v
  ONBOARDING  3 videos, watched in order            <- the platform gate
     |          nothing is claimable until this clears
     v
  TASK QUEUE  every open task, visible to everyone
     |
     v
  PICK ONE -> its own tutorial, watched to the end  <- the task gate
     |          watching IS the certification
     v
  CLAIM  -> an account is checked out automatically
     |
     v
  WORK -> upload a screenshot per checklist step
     |
     v
  SUBMIT -> standard closes on the spot
            critical goes to review, then external verification
```

Neither gate can be skipped by scrubbing: the progress watermark advances by at
most one heartbeat per heartbeat, so the bar only fills at the speed the video
actually plays.

### Capacity is earned, not configured

Everyone starts holding **one** task. Submitting frees the slot immediately, so
they can take the next one straight away. The *ceiling* — how many at once —
rises with closed work, at 1, 5, 15 and 30 tasks, up to five.

Let the approval rate fall under **75%** (measured once there are at least four
reviewed tasks) and the ceiling drops back to one until the record recovers. A
task that needed a second attempt does not count as approved.

Nobody sets this per person. It is derived from their own history in
[`capacity.service.ts`](apps/api/src/taskers/capacity.service.ts), and every
screen that shows the number also shows the sentence explaining it.

## What each page is for

**Tasker**

| Page | The question it answers |
|---|---|
| **Tasks** | What can I work on? Every open task, each showing whether it is claimable and what is standing in the way. |
| **My work** | What am I holding? One or several, with checklist, screenshots and submit. |
| **Getting started** | The onboarding series and how far through it I am. |
| **Get help** | Something is blocking me. Raise it, and the admin is alerted on Telegram immediately. |
| **History** | What have I done and what was I paid hours for? |

**Console**

| Page | The question it answers |
|---|---|
| **Assignment** | What work has nobody on it? Grouped by what it needs from you. Most work is self-claimed; this is for pushing something at a named person. |
| **Review** | Did the tasker do what the spec asked? Each requirement beside the screenshot captured for it. |
| **Verification** | Did the external platform accept it? A recording step, not a judgement. |
| **Accounts** | The manager's Account Tracker, live: who each account is assigned to and since when, its owner and how taskers get in (Morelogin or RDP), with Assign and Collect. **Import from spreadsheet** brings the tracker workbook in. |
| **Taskers** | Who can work, how well they have done — and click anyone to audit every submission with its evidence. |
| **Tickets** | Who is blocked right now. Each one arrives with the task, the account and how to phone them. |
| **Task types** | What each kind of work requires: checklist, tutorial, and who is certified on which version. |
| **Videos** | The onboarding series every tasker watches. Upload, reorder, remove. |

## What to show, in order

**1. A brand new tasker.** Sign in as `ibrahim@tasker.dev`. The queue is locked
behind onboarding, and the videos unlock in order. Watch them and the queue opens.

**2. The queue.** Five open tasks. Some say *Claim*, others *Watch to unlock* —
those are the types he has not been trained on yet.

**3. Picking one.** Open a locked task: what the work involves, then the video
that unlocks it. The claim button stays disabled until the bar fills. Try
dragging the scrubber to the end — the bar does not move.

**4. Claiming.** The button goes live, and an account is checked out
automatically. Upload a screenshot per step and submit.

**5. Capacity.** The meter reads *1 of 1 slot* with "Everyone starts with one
task." Sign in as `zainab` for *2 slots*, and `emeka` for the **Limited** state —
he has seven closed tasks but a 60% approval rate, so he is back to one.

**6. Review and verification.** As `sub@tasker.dev`, work the two queues.

**7. The audit.** Taskers → click anyone. Every submission, the screenshots
attached, and what each gate decided, with who pressed the button and from where.

**8. Telegram.** *Link Telegram* in the console header, open the deep link, then
`/today`, `/pending`, and tap a name under `/taskers` for the same audit on a phone.

## Shape

```
apps/
  api/     NestJS orchestrator - auth, state machine, vault, proof, tutorials
  web/     Next.js 15 - tasker app + operations console
  bot/     Python / aiogram - admin and sub-admin surface
infrastructure/
  docker-compose.dev.yml
```

Every surface is a client of the orchestrator. **No surface holds state or
decides permissions.** Role logic inside a surface controls which controls
render, nothing more.

### Where the rules actually live

| Rule | Enforced in |
|---|---|
| Legal transitions | [`state-machine.ts`](apps/api/src/tasks/state-machine.ts) |
| Certification gate | `assertCertified` in [`tasks.service.ts`](apps/api/src/tasks/tasks.service.ts) |
| Spec completeness gate | `create` in the same file |
| Account exclusivity | a **partial unique index**, in the first migration under `prisma/migrations` — never application logic |
| One task per tasker | `assertNotHolding`, checked *before* the claim |
| Spec immutability | the task carries `specVersionId` for life |
| Audit completeness | `transition()` — the single write path for state |
| Authorization matrix | [`capabilities.ts`](apps/api/src/auth/capabilities.ts) |

### The race

Broadcast acceptance is a genuine race, decided by one conditional update:

```sql
UPDATE tasks SET state='IN_PROGRESS', assignee_id=$1 WHERE id=$2 AND state='OPEN'
```

Zero rows affected means somebody else won. The loser is told "already taken"
and the card disappears — never an error. Verified with three concurrent
clients released from a barrier: exactly one winner, one account hold.

---

## Inherited from the three existing codebases

- **SwiftHum** — the bot's session-caching API client, the supervised-loop
  pattern, the compose topology, and `credential-crypto.ts`, which became the
  vault's AES-256-GCM envelope (now with a per-row `keyVersion`, so the key can
  rotate without a flag day).
- **Tutorial Hub / LearnHub** — the tutorial, quiz and progress model. Its
  watch-tracking was a *cumulative seconds* counter; this rewrites it as a
  furthest-position watermark, because seeking and re-watching inflate a
  running total and it cannot answer "did they actually watch this".
- **JD Engine** — the entire web design system: Tailwind 4 `@theme inline`
  tokens, the `components/ui` primitives, the role-aware app shell, the ky
  client.

---

### Accounts: assigned, not pooled

Accounts work the way the manager's Account Tracker spreadsheet does. An admin
assigns an account to a tasker, and that tasker's claims run on it until the
account is collected back; collecting mid-task lets the running task finish on
it. Assignments are kept as history, like the tracker's People tab. A tasker
with no usable account of their own gets one assigned to nobody, and an account
with no login details yet is never handed out.

**Import from spreadsheet** on the Accounts page reads the tracker workbook:
Accounts tab to accounts (RDP logins split into IP address and username,
passwords encrypted on the way in), People tab to assignments (matched to taskers
by name), Projects tab to draft task types. It previews first and returns no
passwords; importing the same file twice changes nothing new.

### Tickets and alerting

A tasker raises a ticket and the server attaches what it already knows: the task
they are on, the account it runs against, and their name, email and phone. An
admin opening it has never to ask a question before they can act.

The credential is **not** on the ticket. The account reference travels; revealing
runs through the vault like any other reveal, so it still writes a
`CredentialReveal` row naming who looked. Same one tap for the admin, audit trail
intact.

Alerts go to the admin and every sub-admin with Telegram bound, then repeat every
10 minutes until somebody taps **I will handle this** — from the phone or the
console. Claiming stops the reminders for everyone and names who took it. Capped
at six reminders so a forgotten ticket cannot beep all night. Urgent tickets
arrive with sound; the rest arrive silently.

Alerts also go out as push notifications to every device an admin or sub-admin
has switched on from **Alerts** in the console header. Urgent ones buzz and stay
on screen; **I will handle this** on the notification claims the ticket. On an
iPhone, Tasker has to be added to the Home Screen first.

### Video and screenshot storage

Files live in Cloudflare R2. Tutorial videos are never handed to a browser as a
file address: players receive a link signed for that person that expires in
hours, and the API streams the video in 2MB ranges. A request without a range,
or one the browser marks as opening a page rather than playing a video, is
refused. Download, cast and picture-in-picture controls are hidden. Nothing on
the web stops somebody recording their screen.

Proof screenshots are served only to the task's own tasker and to assigners,
with a sandboxing content policy. Locally, without R2 keys, both fall back to
`apps/api/uploads`; in production an upload without R2 is refused.

## Known edges

Honest list of what is demo-grade rather than production-grade.

- **Perceptual hashing** is a byte-histogram stand-in, not a DCT phash. It
  catches re-uploads and recompressions; it will not catch a crop. Swapping in
  `sharp` changes nothing above the function.
- **Large uploads pass through two proxies** (web, then API) on their way to R2.
  Fine for screenshots and short videos; a 500MB upload on a slow connection is
  untested. Direct browser-to-R2 uploads would remove the hops.
- **Capacity and pool listing are not paginated.** Both are bounded by headcount;
  the audit log, submissions, tasks, accounts and tickets all are.
- **The quiz is built but unused.** Certification is watch-only now, so
  `Quiz` and `QuizAttempt` sit in the schema unwired. Reinstating a quiz gate is
  one condition in `reportProgress`.
- **No worker process yet.** Section 17's timers — acceptance window, idle
  warning, auto-release, SLA breach, digests — are unimplemented. This is the
  largest single gap.
- **Uploads are not resumable.** Per-slot upload is in place, which is the
  structural half; client-side retry is not.
- **Productivity stats** are seeded and recomputed on demand via
  `POST /taskers/recompute-stats`, not nightly.
- **No events/outbox.** Section 20's Redis Streams and the JD Engine consumer
  are not built.
- **The bot's verification queue is read-only** — verdicts are recorded on the
  console, where the proof sits alongside.
