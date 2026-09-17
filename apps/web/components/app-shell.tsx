"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCheck,
  LayoutGrid,
  ShieldCheck,
  KeyRound,
  Users,
  ScrollText,
  GraduationCap,
  History,
  Briefcase,
  LifeBuoy,
  Video,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { get, post } from "@/lib/api";
import { keys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { TelegramLink } from "@/components/telegram-link";
import { PushToggle } from "@/components/push-toggle";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "SUB_ADMIN" | "TASKER";
  telegramLinked: boolean;
  mustChangePassword?: boolean;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Nav is role-shaped, and the two shapes barely overlap on purpose. A tasker
 * sees their own work and nothing else; an assigner sees queues. Rendering is
 * all this decides - the orchestrator authorizes every request regardless.
 */
function navFor(me?: Me): { label?: string; items: NavItem[] }[] {
  if (!me) return [];

  if (me.role === "TASKER") {
    return [
      {
        items: [
          { href: "/queue", label: "Tasks", icon: LayoutGrid },
          { href: "/work", label: "My work", icon: Briefcase },
          { href: "/onboarding", label: "Getting started", icon: GraduationCap },
          { href: "/tickets", label: "Get help", icon: LifeBuoy },
          { href: "/history", label: "History", icon: History },
        ],
      },
    ];
  }

  const groups: { label?: string; items: NavItem[] }[] = [
    {
      label: "Queues",
      items: [
        { href: "/board", label: "Assignment", icon: LayoutGrid },
        { href: "/review", label: "Review", icon: ClipboardCheck },
        { href: "/verification", label: "Verification", icon: ShieldCheck },
        { href: "/tickets", label: "Tickets", icon: LifeBuoy },
      ],
    },
    {
      label: "Operation",
      items: [
        { href: "/accounts", label: "Accounts", icon: KeyRound },
        { href: "/taskers", label: "Taskers", icon: Users },
        { href: "/task-types", label: "Task types", icon: ScrollText },
        { href: "/videos", label: "Videos", icon: Video },
      ],
    },
    { items: [{ href: "/audit", label: "Audit", icon: ScrollText }] },
  ];

  return groups;
}

function Brand({ me }: { me?: Me }) {
  const home = me?.role === "TASKER" ? "/queue" : "/board";
  return (
    <Link href={home} className="block px-2">
      <p className="text-lg font-semibold tracking-tight text-ink-900">Tasker</p>
      <p className="text-[0.65rem] uppercase tracking-[0.18em] text-ink-300">
        {me?.role === "TASKER" ? "Tasker app" : "Operations console"}
      </p>
    </Link>
  );
}

function SidebarNav({
  groups,
  pathname,
  onNavigate,
}: {
  groups: { label?: string; items: NavItem[] }[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-4">
      {groups.map((group, gi) => (
        <div
          key={group.label ?? `g${gi}`}
          // An unlabelled group is the footer group (Help, Audit) and sinks to
          // the bottom - unless it is the only group, as it is for taskers.
          className={cn("flex flex-col gap-0.5", !group.label && gi > 0 && "mt-auto")}
        >
          {group.label && (
            <p className="px-3 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-ink-300">
              {group.label}
            </p>
          )}
          {group.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-ink-100 font-medium text-ink-900"
                    : "text-ink-700 hover:bg-ink-100/60",
                )}
              >
                <Icon className="size-4 text-ink-500" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const { data: me, isLoading, isError } = useQuery<Me>({
    queryKey: keys.me,
    queryFn: () => get<Me>("auth/me"),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  React.useEffect(() => {
    if (isError) router.replace("/login");
  }, [isError, router]);

  // A temporary password is replaced before anything else. The API refuses
  // every other request until it is, so this only saves a page of errors.
  React.useEffect(() => {
    if (me?.mustChangePassword) router.replace("/password");
  }, [me?.mustChangePassword, router]);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const groups = React.useMemo(() => navFor(me), [me]);

  const logout = useMutation({
    mutationFn: () => post("auth/logout"),
    onSettled: () => {
      queryClient.clear();
      router.push("/login");
    },
  });

  return (
    <div className="flex min-h-screen bg-white">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-ink-200 bg-white px-4 py-6 md:flex">
        <Brand me={me} />
        <div className="mt-8 flex min-h-0 flex-1 flex-col overflow-y-auto">
          <SidebarNav groups={groups} pathname={pathname} />
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-60 flex-col border-r border-ink-200 bg-white px-4 py-6 shadow-xl">
            <div className="flex items-start justify-between">
              <Brand me={me} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-1 text-ink-500 hover:bg-ink-100"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-8 flex min-h-0 flex-1 flex-col overflow-y-auto">
              <SidebarNav
                groups={groups}
                pathname={pathname}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-ink-200 bg-white px-4 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="-ml-2 rounded-md p-2 text-ink-700 hover:bg-ink-100"
            >
              <Menu className="size-5" />
            </button>
            <span className="font-semibold text-ink-900">Tasker</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {/* Admins and sub-admins work from Telegram; taskers never appear there. */}
            {me && me.role !== "TASKER" && <PushToggle />}
            {me && me.role !== "TASKER" && <TelegramLink linked={me.telegramLinked} />}
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : me ? (
              <Link
                href="/password"
                title="Change your password"
                className="flex items-center gap-2.5 rounded-md px-1 py-0.5 hover:bg-ink-100"
              >
                <div className="text-right leading-tight">
                  <p className="text-sm font-medium text-ink-900">{me.name}</p>
                  <p className="text-[0.7rem] text-ink-500">{roleLabel(me.role)}</p>
                </div>
                <div className="flex size-8 items-center justify-center rounded-full border border-ink-200 bg-ink-100 text-xs font-medium text-ink-700">
                  {initials(me.name)}
                </div>
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 px-2.5 py-1.5 text-sm text-ink-700 transition-colors hover:bg-ink-100"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}

function roleLabel(role: Me["role"]): string {
  return role === "ADMIN" ? "Admin" : role === "SUB_ADMIN" ? "Sub-admin" : "Tasker";
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
