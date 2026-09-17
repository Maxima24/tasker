import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountAccess, Channel, TaskCategory } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.guard';
import { LoginDetails, VaultService } from './vault.service';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

type Cell = string | Date | null;

interface Table {
  sheet: string;
  rows: { row: number; get: (...names: string[]) => Cell }[];
}

type PersonAction = 'assign' | 'already' | 'collect' | 'history' | 'unmatched';

export interface PersonPlan {
  name: string;
  role: string;
  active: boolean;
  assignedAt: string | null;
  match: { id: string; name: string } | null;
  action: PersonAction;
  note?: string;
}

export interface AccountPlan {
  row: number;
  ref: string;
  label: string | null;
  owner: string | null;
  accessType: AccountAccess;
  notes: string | null;
  action: 'create' | 'update';
  /** Which login details the row carries - never the values. */
  login: { host: boolean; username: boolean; email: boolean; password: boolean };
  people: PersonPlan[];
  outcome?: 'done' | 'failed';
  error?: string;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const IP = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$/;
const IP_THEN_USER = /^((?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?)\s*[,;|/\s]\s*(.+)$/;

/** "Login IP/Username" -> the header everybody means by it, as a lookup key. */
function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(auto\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    // A formula copied down an empty table has no result yet: that is a blank
    // cell, not text.
    if ('formula' in v || 'sharedFormula' in v || 'result' in v) {
      return cellValue(((v as ExcelJS.CellFormulaValue).result ?? null) as ExcelJS.CellValue);
    }
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('').trim() || null;
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text).trim() || null;
    if ('error' in v) return null;
  }
  return String(v).trim() || null;
}

function text(c: Cell): string | null {
  if (c === null) return null;
  return c instanceof Date ? c.toISOString().slice(0, 10) : c;
}

/**
 * Finds a sheet by its tab name, or failing that by the headers it carries, and
 * reads it as rows keyed by header. The header row is looked for in the first
 * ten rows, because the manager's tabs open with a title and a description.
 */
function readTable(wb: ExcelJS.Workbook, tabNames: string[], mustHave: string[][]): Table | null {
  const ordered = [
    ...wb.worksheets.filter((ws) => tabNames.includes(norm(ws.name))),
    ...wb.worksheets.filter((ws) => !tabNames.includes(norm(ws.name))),
  ];
  for (const ws of ordered) {
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const headers = new Map<string, number>();
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
        const t = text(cellValue(cell.value));
        if (t) headers.set(norm(t), col);
      });
      const hit = mustHave.every((alternatives) => alternatives.some((h) => headers.has(h)));
      if (!hit) continue;

      const rows: Table['rows'] = [];
      for (let n = r + 1; n <= ws.rowCount; n++) {
        const row = ws.getRow(n);
        const get = (...names: string[]) => {
          for (const name of names) {
            const col = headers.get(name);
            if (col) return cellValue(row.getCell(col).value);
          }
          return null;
        };
        let any = false;
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (cellValue(cell.value) !== null) any = true;
        });
        if (any) rows.push({ row: n, get });
      }
      return { sheet: ws.name, rows };
    }
  }
  return null;
}

function accessFrom(explicit: string | null, label: string | null): AccountAccess {
  const s = `${explicit ?? ''} ${label ?? ''}`;
  if (/morelogin/i.test(s)) return 'MORELOGIN';
  if (/\brdp\b|remote desktop/i.test(s)) return 'RDP';
  return 'OTHER';
}

/** "185.1.2.3:3389, Administrator" -> host + username. An email is an email. */
function splitLogin(raw: string | null): LoginDetails {
  const s = raw?.trim();
  if (!s) return {};
  if (EMAIL.test(s)) return { email: s };
  const m = s.match(IP_THEN_USER);
  if (m) return { host: m[1], username: m[2].trim() };
  if (IP.test(s)) return { host: s };
  return { username: s };
}

function yes(value: string | null): boolean {
  if (!value) return true;
  return !/^(no|n|false|0|inactive)$/i.test(value.trim());
}

function toDate(c: Cell): Date | null {
  if (c instanceof Date) return c;
  if (!c) return null;
  const d = new Date(c);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Brings the manager's Account Tracker workbook into the platform.
 *
 * Accounts tab -> accounts (passwords encrypted on the way in), People tab ->
 * who each account is assigned to, Projects tab -> task types. The Tasks tab is
 * counted but not imported: the platform records tasks as they happen.
 *
 * Runs twice with the same file: once to preview, once to commit. Nothing is
 * kept between the two, so plain-text passwords never sit on the server.
 */
@Injectable()
export class AccountImportService {
  constructor(
    private readonly db: PrismaService,
    private readonly vault: VaultService,
  ) {}

  async run(
    user: AuthUser,
    channel: Channel,
    file: { buffer?: Buffer; originalname?: string; size?: number } | undefined,
    opts: { commit: boolean; categories?: Record<string, string> },
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose the spreadsheet to import.');
    if (!/\.xlsx$/i.test(file.originalname ?? '')) {
      throw new BadRequestException('Upload the workbook as an .xlsx file (Excel or Google Sheets > Download > .xlsx).');
    }

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException('That file could not be read as a spreadsheet.');
    }

    const accountsTable = readTable(wb, ['accounts'], [['account id']]);
    if (!accountsTable) {
      throw new BadRequestException(
        'No sheet with an "Account ID" column was found. Use the Account Tracker layout: an Accounts tab with Account ID, Account Name, Account Owner, Tasker, Login IP/Username and Login Password.',
      );
    }
    const peopleTable = readTable(wb, ['people'], [['account id'], ['person name', 'name']]);
    const projectsTable = readTable(wb, ['projects'], [['project name']]);
    const tasksTable = readTable(wb, ['tasks'], [['task name']]);

    const [existing, taskers, taskTypes] = await Promise.all([
      this.db.account.findMany({
        select: {
          id: true,
          ref: true,
          assignments: { where: { collectedAt: null }, select: { id: true, taskerId: true } },
        },
      }),
      this.db.user.findMany({
        where: { role: 'TASKER', status: 'active' },
        select: { id: true, name: true, preferredName: true },
      }),
      this.db.taskType.findMany({ select: { name: true } }),
    ]);
    const existingByRef = new Map(existing.map((a) => [a.ref.toUpperCase(), a]));

    const matchPerson = (raw: string): { match: PersonPlan['match']; note?: string } => {
      const want = norm(raw);
      const first = want.split(' ')[0];
      const label = (t: (typeof taskers)[number]) => t.preferredName || t.name;
      const exact = taskers.filter((t) => norm(t.name) === want || norm(t.preferredName ?? '') === want);
      if (exact.length === 1) return { match: { id: exact[0].id, name: label(exact[0]) } };
      const loose = taskers.filter(
        (t) =>
          norm(t.name).split(' ')[0] === first || norm(t.preferredName ?? '').split(' ')[0] === first,
      );
      if (exact.length === 0 && loose.length === 1) {
        return { match: { id: loose[0].id, name: label(loose[0]) } };
      }
      if (exact.length + loose.length > 1) {
        return { match: null, note: `More than one tasker could be "${raw}". Assign this one by hand.` };
      }
      return { match: null, note: `No tasker called "${raw}" on the platform yet. Invite them, then assign.` };
    };

    // --- people, per account ------------------------------------------------
    const peopleByRef = new Map<string, { name: string; role: string; active: boolean; assignedAt: Date | null }[]>();
    if (peopleTable) {
      for (const r of peopleTable.rows) {
        const ref = text(r.get('account id'))?.toUpperCase();
        const name = text(r.get('person name', 'name'));
        if (!ref || !name) continue;
        const list = peopleByRef.get(ref) ?? [];
        list.push({
          name,
          role: text(r.get('role')) || 'Tasker',
          active: yes(text(r.get('currently active', 'active'))),
          assignedAt: toDate(r.get('date assigned', 'assigned')),
        });
        peopleByRef.set(ref, list);
      }
    }

    const warnings: string[] = [];
    const plans: AccountPlan[] = [];
    const seen = new Set<string>();

    for (const r of accountsTable.rows) {
      const ref = text(r.get('account id'))?.toUpperCase() ?? null;
      const label = text(r.get('account name'));
      if (!ref) {
        if (label || r.get('login ip username', 'login username', 'username')) {
          warnings.push(`Row ${r.row} has account details but no Account ID, so it was left out.`);
        }
        continue;
      }
      if (seen.has(ref)) {
        warnings.push(`${ref} appears more than once. Only its first row (before row ${r.row}) is used.`);
        continue;
      }
      seen.add(ref);

      const login = splitLogin(text(r.get('login ip username', 'login ip', 'login username', 'username', 'login')));
      const password = text(r.get('login password', 'password', 'login password vault ref'));

      // People tab when it lists this account; otherwise the Accounts tab's Tasker column.
      const sheetPeople =
        peopleByRef.get(ref) ??
        (text(r.get('tasker', 'assigned to'))
          ?.split(/\s*(?:,|&|\band\b)\s*/i)
          .filter(Boolean)
          .map((name) => ({ name, role: 'Tasker', active: true, assignedAt: null as Date | null })) ?? []);

      const live = existingByRef.get(ref)?.assignments ?? [];
      const people: PersonPlan[] = sheetPeople.map((p) => {
        const { match, note } = matchPerson(p.name);
        const holding = match ? live.some((a) => a.taskerId === match.id) : false;
        const action: PersonAction = !match
          ? 'unmatched'
          : p.active
            ? holding
              ? 'already'
              : 'assign'
            : holding
              ? 'collect'
              : 'history';
        return {
          name: p.name,
          role: p.role,
          active: p.active,
          assignedAt: p.assignedAt ? p.assignedAt.toISOString() : null,
          match,
          action,
          note,
        };
      });

      plans.push({
        row: r.row,
        ref,
        label,
        owner: text(r.get('account owner', 'owner')),
        accessType: accessFrom(text(r.get('access type', 'type')), label),
        notes: text(r.get('notes')),
        action: existingByRef.has(ref) ? 'update' : 'create',
        login: {
          host: !!login.host,
          username: !!login.username,
          email: !!login.email,
          password: !!password,
        },
        people,
      });

      if (opts.commit) {
        const plan = plans[plans.length - 1];
        try {
          await this.commitAccount(user, channel, plan, { ...login, ...(password ? { password } : {}) });
          plan.outcome = 'done';
        } catch (e: any) {
          plan.outcome = 'failed';
          plan.error = e?.response?.message ?? e?.message ?? 'Could not import this row.';
        }
      }
    }

    // --- projects become task types -------------------------------------------
    const known = new Set(taskTypes.map((t) => norm(t.name)));
    const projectCounts = new Map<string, { name: string; accounts: Set<string> }>();
    for (const r of projectsTable?.rows ?? []) {
      const name = text(r.get('project name'));
      if (!name) continue;
      const key = norm(name);
      const entry = projectCounts.get(key) ?? { name, accounts: new Set<string>() };
      const ref = text(r.get('account id'));
      if (ref) entry.accounts.add(ref.toUpperCase());
      projectCounts.set(key, entry);
    }
    const projects = [...projectCounts.entries()].map(([key, p]) => ({
      name: p.name,
      accounts: p.accounts.size,
      exists: known.has(key),
      outcome: undefined as undefined | 'created' | 'failed',
    }));

    if (opts.commit) {
      for (const p of projects.filter((x) => !x.exists)) {
        const chosen = opts.categories?.[p.name];
        const category: TaskCategory = chosen === 'CRITICAL' ? 'CRITICAL' : 'STANDARD';
        try {
          await this.db.taskType.create({ data: { name: p.name, category, createdById: user.id } });
          p.outcome = 'created';
        } catch {
          p.outcome = 'failed';
        }
      }
    }

    const people = plans.flatMap((p) => p.people);
    return {
      committed: opts.commit,
      sheets: {
        accounts: accountsTable.sheet,
        people: peopleTable?.sheet ?? null,
        projects: projectsTable?.sheet ?? null,
        tasks: tasksTable?.sheet ?? null,
      },
      accounts: plans,
      projects,
      tasksInSheet: tasksTable?.rows.length ?? 0,
      warnings,
      totals: {
        create: plans.filter((p) => p.action === 'create').length,
        update: plans.filter((p) => p.action === 'update').length,
        // New accounts arriving with nothing to sign in with. Updates keep their current login.
        withoutLogin: plans.filter(
          (p) => p.action === 'create' && !p.login.password && !p.login.username && !p.login.email && !p.login.host,
        ).length,
        assign: people.filter((p) => p.action === 'assign').length,
        unmatched: [...new Set(people.filter((p) => p.action === 'unmatched').map((p) => p.name))],
        failed: plans.filter((p) => p.outcome === 'failed').length,
      },
    };
  }

  private async commitAccount(user: AuthUser, channel: Channel, plan: AccountPlan, credentials: LoginDetails) {
    const fields = {
      label: plan.label ?? undefined,
      owner: plan.owner ?? undefined,
      notes: plan.notes ?? undefined,
      // "Other" only means the sheet did not say. On an existing account that
      // must not overwrite a Morelogin or RDP it already has.
      accessType: plan.action === 'update' && plan.accessType === 'OTHER' ? undefined : plan.accessType,
      credentials,
    };
    const account =
      plan.action === 'create'
        ? await this.vault.create(user, channel, { ref: plan.ref, ...fields }, { allowNoLogin: true })
        : await this.vault.update(user, plan.ref, fields);

    for (const p of plan.people) {
      if (!p.match) continue;
      if (p.action === 'assign') {
        await this.vault.assign(user, account.id, {
          taskerId: p.match.id,
          role: p.role,
          assignedAt: p.assignedAt ?? undefined,
        });
      } else if (p.action === 'collect') {
        const live = await this.db.accountAssignment.findFirst({
          where: { accountId: account.id, taskerId: p.match.id, collectedAt: null },
        });
        if (live) await this.vault.collect(user, account.id, live.id);
      } else if (p.action === 'history') {
        // Somebody who used to work this account: kept as a closed assignment.
        await this.db.accountAssignment.create({
          data: {
            accountId: account.id,
            taskerId: p.match.id,
            role: p.role,
            assignedAt: p.assignedAt ? new Date(p.assignedAt) : new Date(),
            assignedById: user.id,
            collectedAt: new Date(),
            collectedById: user.id,
          },
        });
      }
    }
  }
}
