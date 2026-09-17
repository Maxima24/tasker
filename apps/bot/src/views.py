"""Renderers: each returns (text, keyboard) for one view.

Views are pure functions of data the orchestrator returned. The bot decides
what to draw; it never decides what is permitted.
"""
from __future__ import annotations

from datetime import datetime, timezone
from html import escape

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from .nav import ACCOUNT_FORM, INTAKE, action, encode, step

STATE_LABEL = {
    "DRAFT": "draft",
    "OPEN": "open to pool",
    "ASSIGNED": "awaiting acceptance",
    "IN_PROGRESS": "in progress",
    "SUBMITTED": "submitted",
    "IN_REVIEW": "awaiting review",
    "PENDING_VERIFICATION": "awaiting verdict",
    "REWORK": "sent back",
    "PAUSED": "paused",
    "CLOSED": "closed",
    "CANCELLED": "cancelled",
    "EXPIRED": "expired",
}


def _console(url: str, path: str = "") -> InlineKeyboardButton:
    """Every leaf view offers the console. The bot stays deliberately shallow:
    anything requiring comparison belongs on a screen."""
    return InlineKeyboardButton(text="Open in console", url=f"{url}{path}")


def back_button(to: str = "home") -> InlineKeyboardButton:
    return InlineKeyboardButton(text="< Back", callback_data=encode(to))


def home(name: str, summary: dict, open_tickets: int = 0) -> tuple[str, InlineKeyboardMarkup]:
    waiting = summary["inReview"] + summary["pendingVerification"]
    lines = [f"<b>Tasker</b> — {escape(name)}", ""]

    # Somebody blocked outranks a queue that is merely long, so it leads.
    if open_tickets:
        who = "person is" if open_tickets == 1 else "people are"
        lines.append(f"<b>{open_tickets} {who} blocked and waiting</b>")

    lines.append(f"{waiting} waiting on you · {summary['inProgress']} in progress")
    lines.append(f"{summary['freeAccounts']} accounts free")

    rows = []
    if open_tickets:
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"Tickets ({open_tickets})", callback_data=encode("tickets")
                )
            ]
        )
    rows.append(
        [
            InlineKeyboardButton(text=f"Pending ({waiting})", callback_data=encode("pending")),
            InlineKeyboardButton(text="Today", callback_data=encode("today")),
        ]
    )
    rows.append(
        [
            InlineKeyboardButton(text="Taskers", callback_data=encode("taskers")),
            InlineKeyboardButton(text="Accounts", callback_data=encode("accounts", "", 1)),
        ]
    )
    rows.append(
        [
            InlineKeyboardButton(text="New task", callback_data=step(INTAKE, "start")),
            InlineKeyboardButton(text="Add account", callback_data=step(ACCOUNT_FORM, "add")),
        ]
    )
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=rows)


def today(summary: dict, console_url: str) -> tuple[str, InlineKeyboardMarkup]:
    lines = [
        "<b>Today</b>",
        "",
        f"Awaiting review          <b>{summary['inReview']}</b>",
        f"Awaiting external verdict <b>{summary['pendingVerification']}</b>",
        f"In progress              <b>{summary['inProgress']}</b>",
        f"Unclaimed                <b>{summary['open']}</b>",
        f"Overdue                  <b>{summary['overdue']}</b>",
        f"Asking for work          <b>{summary['workRequests']}</b>",
        f"Hours flagged            <b>{summary['hoursFlagged']}</b>",
        f"Free accounts            <b>{summary['freeAccounts']}</b>",
    ]
    kb = InlineKeyboardMarkup(
        inline_keyboard=[[back_button()], [_console(console_url, "/board")]]
    )
    return "\n".join(lines), kb


def pending(review: list, verification: list, console_url: str) -> tuple[str, InlineKeyboardMarkup]:
    if not review and not verification:
        text = "<b>Pending</b>\n\nNothing waiting. "
        return text, InlineKeyboardMarkup(inline_keyboard=[[back_button()]])

    rows = []
    lines = ["<b>Pending</b>", ""]

    if review:
        lines.append(f"<b>Internal review</b> ({len(review)})")
        for t in review[:5]:
            lines.append(f"  {t['code']} · {escape(t['taskType']['name'])} · {escape(t['assignee']['name'])}")
            rows.append(
                [
                    InlineKeyboardButton(
                        text=f"Review {t['code']}",
                        callback_data=encode("review", t["code"]),
                    )
                ]
            )
        lines.append("")

    if verification:
        lines.append(f"<b>External verdict</b> ({len(verification)})")
        for t in verification[:5]:
            lines.append(f"  {t['code']} · {escape(t['taskType']['name'])}")
        lines.append("")
        lines.append("<i>Verdicts are recorded on the console, alongside the proof.</i>")

    rows.append([back_button()])
    rows.append([_console(console_url, "/review")])
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=rows)


def review(task: dict, console_url: str) -> tuple[str, InlineKeyboardMarkup]:
    proofs = task.get("proofs", [])
    checklist = task["specVersion"]["checklist"]
    filled = {p["checklistKey"] for p in proofs}

    lines = [
        f"<b>{task['code']}</b> · {escape(task['taskType']['name'])}",
        f"{escape(task['assignee']['name'])} · spec v{task['specVersion']['version']}",
        "",
    ]
    for item in checklist:
        if not item["requiresProof"]:
            lines.append(f"  - {escape(item['label'])}")
        else:
            mark = "OK" if item["key"] in filled else "--"
            lines.append(f"  [{mark}] {escape(item['label'])}")

    lines.append("")
    lines.append(f"{len(proofs)} frames submitted.")

    version = task["version"]
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="View proof", callback_data=encode("proof", task["code"])
                )
            ],
            [
                InlineKeyboardButton(
                    text="Approve", callback_data=action("pass", task["code"], version)
                ),
                InlineKeyboardButton(
                    text="Send back", callback_data=action("fail", task["code"], version)
                ),
            ],
            [InlineKeyboardButton(text="< Back", callback_data=encode("pending"))],
            [_console(console_url, "/review")],
        ]
    )
    return "\n".join(lines), kb


def taskers(pool: dict, console_url: str) -> tuple[str, InlineKeyboardMarkup]:
    lines = ["<b>Taskers</b>", "", "<i>Tap anyone to see what they have submitted.</i>", ""]
    for t in pool.get("ranked", [])[:8]:
        busy = " · busy" if t["busy"] else ""
        lines.append(
            f"  {escape(t['name'])} — {t['score']:.2f} · "
            f"{round(t['approvalRate'] * 100)}% approved{busy}"
        )
    unranked = pool.get("unranked", [])
    if unranked:
        lines.append("")
        lines.append(f"<i>Not yet ranked: {', '.join(escape(t['name']) for t in unranked)}</i>")

    rows = []
    # Two per row keeps names readable on a phone. Callback data is capped at
    # 64 bytes, so the button carries a suffix of the id, resolved on tap.
    batch = []
    for t in (pool.get("ranked", []) + pool.get("unranked", []))[:8]:
        batch.append(
            InlineKeyboardButton(
                text=t["name"].split()[0],
                callback_data=encode("tasker", t["id"][-10:]),
            )
        )
        if len(batch) == 2:
            rows.append(batch)
            batch = []
    if batch:
        rows.append(batch)

    rows.append([back_button()])
    rows.append([_console(console_url, "/taskers")])
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=rows)


def tasker_audit(data: dict, console_url: str) -> tuple[str, InlineKeyboardMarkup]:
    """What this person actually did - the question an admin opens a phone to ask."""
    t = data["tasker"]
    totals = data["totals"]
    cap = data["capacity"]

    lines = [
        f"<b>{escape(t['name'])}</b>",
        f"{totals['submitted']} submitted · {totals['closed']} closed · "
        f"{totals['reworked']} reworked",
        f"Holding {cap['holding']} of {cap['limit']}"
        + (" · limited" if cap["limited"] else ""),
        "",
    ]

    for s in data["submissions"][:6]:
        gates = "".join("+" if g["outcome"] == "PASS" else "x" for g in s["gates"]) or "-"
        flag = " · hours flagged" if s["hoursFlagged"] else ""
        lines.append(f"  {s['code']} · {escape(s['taskType'])}")
        lines.append(f"     {len(s['evidence'])} screenshots · gates {gates}{flag}")

    if not data["submissions"]:
        lines.append("<i>Nothing submitted yet.</i>")
    else:
        lines.append("")
        lines.append("<i>Screenshots open on the console.</i>")

    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="< Taskers", callback_data=encode("taskers"))],
            [_console(console_url, f"/taskers/{t['id']}")],
        ]
    )
    return "\n".join(lines), kb


def task_detail(task: dict, console_url: str) -> tuple[str, InlineKeyboardMarkup]:
    state = STATE_LABEL.get(task["state"], task["state"].lower())
    lines = [
        f"<b>{task['code']}</b> · {escape(task['taskType']['name'])}",
        f"{state} · spec v{task['specVersion']['version']}",
    ]
    if task.get("assignee"):
        lines.append(f"Tasker: {escape(task['assignee']['name'])}")
    if task.get("account"):
        lines.append(f"Account: {task['account']['ref']}")
    if task.get("hoursReported"):
        flag = " (flagged)" if task.get("hoursFlagged") else ""
        lines.append(f"Hours: {task['hoursReported']}{flag}")

    rows = []
    if task["state"] == "IN_REVIEW":
        rows.append(
            [InlineKeyboardButton(text="Review it", callback_data=encode("review", task["code"]))]
        )
    rows.append([back_button()])
    rows.append([_console(console_url, "/board")])
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=rows)


def stale(reason: str) -> tuple[str, InlineKeyboardMarkup]:
    """A stale tap is refused with what changed, and the buttons come off."""
    return (
        f"<b>That has already moved on.</b>\n\n{escape(reason)}",
        InlineKeyboardMarkup(inline_keyboard=[[back_button()]]),
    )


def tickets(items: list, console_url: str) -> tuple[str, InlineKeyboardMarkup]:
    """Who is stuck, and what on. Acting happens on the console where the
    account and the evidence are both to hand."""
    if not items:
        return (
            "<b>Tickets</b>\n\nNobody is blocked right now.",
            InlineKeyboardMarkup(inline_keyboard=[[back_button()]]),
        )

    lines = ["<b>Tickets</b>", ""]
    rows = []
    for t in items[:6]:
        mark = "!" if t["priority"] == "URGENT" else "-"
        who = escape(t["raisedBy"]["name"])
        held = f" · {escape(t['claimedBy']['name'])} has it" if t.get("claimedBy") else ""
        lines.append(f"  [{mark}] {t['code']} · {escape(t['subject'])}")
        lines.append(f"      {who}{held}")
        if t["status"] == "OPEN":
            rows.append(
                [
                    InlineKeyboardButton(
                        text=f"Take {t['code']}",
                        callback_data=action("tclaim", t["id"][-10:], 0),
                    )
                ]
            )

    rows.append([back_button()])
    rows.append([_console(console_url, "/tickets")])
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=rows)


def refused(reason: str, back: str = "") -> tuple[str, InlineKeyboardMarkup]:
    """A refusal, worded exactly as the API worded it. Those messages already
    say who CAN do the thing, which is the only useful follow-up."""
    return (
        escape(reason),
        InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="< Back", callback_data=back or encode("home"))]
            ]
        ),
    )


# --- help ---------------------------------------------------------------------

HELP = [
    ("/today", "how things stand right now"),
    ("/pending", "finished work waiting for your approval"),
    ("/tickets", "taskers who are stuck and waiting for help"),
    ("/new", "create a task and give it out"),
    ("/task TSK-4007", "look up one task"),
    ("/taskers", "your taskers and how they are doing"),
    ("/accounts", "the platform accounts taskers sign in to"),
    ("/account ACC-002", "look up one account"),
    ("/addaccount", "load a new account's login details"),
    ("/cancel", "stop whatever you are in the middle of"),
]


def help_screen() -> tuple[str, InlineKeyboardMarkup]:
    """One screen in plain words. The Telegram menu lists the same commands, but
    only for someone who already knows to open it."""
    lines = ["<b>What I can do</b>", ""]
    lines += [f"{command} — {what}" for command, what in HELP]
    lines.append("")
    lines.append("<i>Login details are never shown in Telegram. Use the console to see one.</i>")
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=[[back_button()]])


# --- time ---------------------------------------------------------------------


def _when(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None


def _span(seconds: float) -> str:
    """Relative rather than clock times: the bot does not know which time zone
    the admin is reading in."""
    minutes = int(seconds // 60)
    if minutes < 1:
        return "under a minute"
    if minutes < 60:
        return f"{minutes} min"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h {minutes}m" if minutes else f"{hours}h"
    days = hours // 24
    return "1 day" if days == 1 else f"{days} days"


def _ago(iso: str | None) -> str:
    at = _when(iso)
    if at is None:
        return "a while ago"
    return f"{_span((datetime.now(timezone.utc) - at).total_seconds())} ago"


def _left(iso: str | None) -> str | None:
    """Time remaining, or None once it has passed."""
    at = _when(iso)
    if at is None:
        return None
    seconds = (at - datetime.now(timezone.utc)).total_seconds()
    return _span(seconds) if seconds > 0 else None


def _words(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} and {items[-1]}"


def _clip(text: str, limit: int) -> tuple[str, bool]:
    """Telegram caps a message at 4096 characters; notes alone may be 2000."""
    return (text, False) if len(text) <= limit else (text[:limit].rstrip() + "…", True)


# --- accounts -----------------------------------------------------------------

ACCOUNT_STATE_LABEL = {
    "HEALTHY": "healthy",
    "COOLDOWN": "resting",
    "CHALLENGED": "challenged by the platform",
    "SUSPENDED": "suspended",
    "RETIRED": "retired",
}

FIELD_WORDS = {
    "host": "IP address",
    "username": "username",
    "email": "email",
    "password": "password",
    "phone": "phone number",
    "twoFactor": "2FA codes",
    "recoveryEmail": "recovery email",
    "extra": "other sign-in details",
}

ROLE_WORDS = {"ADMIN": "admin", "SUB_ADMIN": "sub-admin", "TASKER": "tasker"}

VIA_WORDS = {"TELEGRAM": "via Telegram", "WEB": "on the console", "SYSTEM": "automatically"}


ACCESS_WORDS = {"MORELOGIN": "Morelogin profile", "RDP": "Remote desktop (RDP)"}


def _fields(fields: list) -> str:
    """The NAMES of what is on file. Values never reach the bot: the API does
    not send them on these routes, and nothing here would show them if it did."""
    return _words([FIELD_WORDS.get(f, f) for f in fields])


def _account_state(a: dict) -> str:
    if a["state"] == "COOLDOWN":
        left = _left(a.get("cooldownUntil"))
        return f"resting, {left} left" if left else "rest over"
    return ACCOUNT_STATE_LABEL.get(a["state"], a["state"].lower())


def _assigned(a: dict) -> str:
    """Who the account is given to, in the manager's words."""
    people = [escape(p["name"]) for p in (a.get("assignedTo") or [])]
    return ", ".join(people) if people else "no one currently working"


def _account_use(a: dict) -> str:
    held = a.get("heldBy")
    if held:
        return f"{_assigned(a)}, on {escape(held['taskCode'])} now"
    return _assigned(a)


def accounts(data: dict, console_url: str) -> tuple[str, InlineKeyboardMarkup]:
    items = data.get("items", [])
    page = data.get("page", 1)
    pages = data.get("pageCount", 1)

    head = f"{data.get('free', 0)} free of {data.get('total', 0)}"
    if pages > 1:
        head += f" · page {page} of {pages}"
    lines = ["<b>Accounts</b>", head, ""]

    if not items:
        lines.append("No accounts here yet. Tap Add account to load one.")
    for a in items:
        platform = escape(a.get("platform") or "no platform")
        lines.append(
            f"  {escape(a['ref'])} · {platform} · {_account_use(a)} · {_account_state(a)}"
        )

    # Full account ids fit the 64-byte cap and the API resolves them directly,
    # which a suffix cannot do across a paged pool. The page rides along so
    # Back from an account lands on the page the admin left.
    rows = []
    batch = []
    for a in items:
        batch.append(
            InlineKeyboardButton(text=a["ref"], callback_data=encode("account", a["id"], page))
        )
        if len(batch) == 2:
            rows.append(batch)
            batch = []
    if batch:
        rows.append(batch)

    pager = []
    if page > 1:
        pager.append(
            InlineKeyboardButton(text="< Previous", callback_data=encode("accounts", "", page - 1))
        )
    if page < pages:
        pager.append(
            InlineKeyboardButton(text="Next >", callback_data=encode("accounts", "", page + 1))
        )
    if pager:
        rows.append(pager)

    rows.append(
        [InlineKeyboardButton(text="Add account", callback_data=step(ACCOUNT_FORM, "add"))]
    )
    rows.append([back_button()])
    rows.append([_console(console_url, "/accounts")])
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=rows)


def account_detail(
    a: dict, console_url: str, page: int = 1, note: str = ""
) -> tuple[str, InlineKeyboardMarkup]:
    """What an admin opens a phone to decide: is this account usable, who has
    it, and could a tasker actually sign in with what is on file."""
    lines = []
    if note:
        lines += [f"<i>{escape(note)}</i>", ""]

    title = f"<b>{escape(a['ref'])}</b>"
    if a.get("platform"):
        title += f" · {escape(a['platform'])}"
    lines.append(title)
    if a.get("label"):
        lines.append(escape(a["label"]))
    access = ACCESS_WORDS.get(a.get("accessType") or "")
    if access:
        lines.append(access)
    if a.get("owner"):
        lines.append(f"Owner: {escape(a['owner'])}")
    lines.append("")

    assigned = a.get("assignedTo") or []
    if assigned:
        lines.append(
            "Assigned to: "
            + ", ".join(f"{escape(p['name'])} (since {_ago(p.get('since'))})" for p in assigned)
        )
    else:
        lines.append("Assigned to: no one currently working")
    lines.append(f"State: {_account_state(a)}")
    if a["state"] != "HEALTHY":
        # Nothing flips an account back on its own, a finished rest included.
        lines.append("Not handed out for new tasks until it is marked healthy.")

    held = a.get("heldBy")
    if held:
        task_state = STATE_LABEL.get(held.get("taskState", ""), "")
        line = (
            f"In use by {escape(held['taskerName'])} on {escape(held['taskCode'])}"
            + (f" ({task_state})" if task_state else "")
            + f", taken {_ago(held.get('heldAt'))}."
        )
        if held.get("displacedByRework"):
            line += " The task is paused, so they keep the account for it."
        lines.append(line)
    else:
        lines.append("Not in use.")
    lines.append("")

    if a.get("loginUrl"):
        lines.append(f"Sign in at: {escape(a['loginUrl'])}")
    else:
        lines.append("No sign-in link yet.")
    fields = a.get("fields") or []
    if fields:
        lines.append(f"Login details on file: {_fields(fields)}.")
    else:
        lines.append("No login details on file yet.")

    if a.get("notes"):
        notes, clipped = _clip(a["notes"], 600)
        lines += ["", "Notes for the tasker:", f"<i>{escape(notes)}</i>"]
        if clipped:
            lines.append("<i>(Shortened. The full notes are on the console.)</i>")
    lines.append("")

    via = VIA_WORDS.get(a.get("addedVia", ""), "")
    if a.get("addedBy"):
        lines.append(" ".join(filter(None, ["Added by", escape(a["addedBy"]["name"]), via])) + ".")
    elif via:
        lines.append(f"Added {via}.")
    tasks = a.get("taskCount")
    reveals = a.get("revealCount", 0)
    counts = []
    if tasks is not None:
        counts.append(f"used on {tasks} task{'' if tasks == 1 else 's'}")
    counts.append(f"login details revealed {reveals} time{'' if reveals == 1 else 's'}")
    summary = _words(counts)
    lines.append(summary[0].upper() + summary[1:] + ".")

    recent = a.get("recentReveals") or []
    if recent:
        lines += ["", "<b>Recent reveals</b>"]
        for r in recent[:5]:
            role = ROLE_WORDS.get(r.get("actorRole") or "", "")
            who = escape(r["actorName"]) + (f" ({role})" if role else "")
            on = f" on {escape(r['taskCode'])}" if r.get("taskCode") else ""
            lines.append(f"  {who}{on} · {_ago(r.get('revealedAt'))}")

    account_id = a["id"]

    def change(label: str, name: str) -> InlineKeyboardButton:
        # Accounts carry no version, so the version slot holds the list page.
        return InlineKeyboardButton(text=label, callback_data=action(name, account_id, page))

    state = a["state"]
    routine = [
        change(label, name)
        for label, name, target in (
            ("Healthy", "acc.healthy", "HEALTHY"),
            ("Rest 6h", "acc.rest", None),  # resting again restarts the clock
            ("Challenged", "acc.challenged", "CHALLENGED"),
        )
        if target != state
    ]
    drastic = [
        change(label, name)
        for label, name, target in (
            ("Suspend", "acc.suspend", "SUSPENDED"),
            ("Retire", "acc.retire", "RETIRED"),
        )
        if target != state
    ]

    rows = [
        [
            InlineKeyboardButton(
                text="Update login details", callback_data=step(ACCOUNT_FORM, "edit", account_id)
            )
        ],
        routine,
    ]
    if drastic:
        rows.append(drastic)
    rows.append(
        [InlineKeyboardButton(text="< Accounts", callback_data=encode("accounts", "", page))]
    )
    rows.append([_console(console_url, "/accounts")])
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=rows)


def account_confirm(a: dict, op: str, page: int) -> tuple[str, InlineKeyboardMarkup]:
    """Suspending or retiring takes an account out of rotation, so it costs one
    more tap. Resting it and marking it healthy are routine and do not."""
    verb = "Suspend" if op == "suspend" else "Retire"
    lines = [f"<b>{verb} {escape(a['ref'])}?</b>", ""]
    if op == "suspend":
        lines.append("It will not be handed out for new tasks until someone marks it healthy.")
    else:
        lines.append(
            "Use this when the account is finished with. It will not be handed out for "
            "new tasks again unless someone marks it healthy."
        )
    held = a.get("heldBy")
    if held:
        lines += [
            "",
            f"{escape(held['taskerName'])} is using it on {escape(held['taskCode'])} right now. "
            "This does not take it off their task.",
        ]
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=f"Yes, {verb.lower()}",
                    callback_data=action(f"acc.{op}.yes", a["id"], page),
                ),
                InlineKeyboardButton(
                    text="No, go back", callback_data=encode("account", a["id"], page)
                ),
            ]
        ]
    )
    return "\n".join(lines), kb


# --- flows: shared ------------------------------------------------------------

FLOW_AGAIN = {"intake": "/new", "account": "/addaccount"}
FLOW_NOTHING = {"intake": "No task was created.", "account": "Nothing was saved."}


def _stop(flow: str) -> InlineKeyboardButton:
    return InlineKeyboardButton(text="Cancel", callback_data=step(flow, "stop"))


def _removed(removed: bool | None) -> list[str]:
    """Said every time a login detail was typed, so the admin knows it is off
    their screen - or knows to delete it themselves if Telegram refused."""
    if removed is None:
        return []
    if removed:
        return [
            "<i>Got it. I removed your message from the chat so it is not left on screen.</i>",
            "",
        ]
    return [
        "<b>I could not remove your message from the chat. Please delete it yourself.</b>",
        "",
    ]


def flow_stopped(flow: str | None) -> tuple[str, None]:
    if flow in FLOW_NOTHING:
        return f"Stopped. {FLOW_NOTHING[flow]}", None
    return "There is nothing to cancel.", None


def flow_timed_out(flow: str | None, removed: bool | None = None) -> tuple[str, None]:
    lines = _removed(removed)
    lines.append("<b>That took more than 15 minutes, so I stopped.</b>")
    lines.append("")
    lines.append(
        f"{FLOW_NOTHING.get(flow or '', 'Nothing was saved.')} "
        f"Start again with {FLOW_AGAIN.get(flow or '', '/help')}."
    )
    return "\n".join(lines), None


def flow_closed(flow: str) -> tuple[str, None]:
    """A button from a flow that has already ended. It must not act."""
    return (
        f"<b>That is no longer open.</b>\n\n{FLOW_NOTHING[flow]} "
        f"Start again with {FLOW_AGAIN[flow]}.",
        None,
    )


def flow_use_buttons() -> tuple[str, None]:
    return "Tap one of the buttons above, or send /cancel to stop.", None


# --- flows: new task ----------------------------------------------------------

DUE_WINDOWS = ((4, "4 hours"), (8, "8 hours"), (24, "24 hours"), (72, "3 days"))


def due_words(hours: int) -> str:
    return dict(DUE_WINDOWS).get(hours, f"{hours} hours")


def ready_spec(task_type: dict) -> dict | None:
    """The version a new task would carry - the newest published one - if it
    can actually be dispatched. The API picks the same version, and refuses one
    without a tutorial, because watching it is how taskers qualify."""
    published = [v for v in task_type.get("specVersions") or [] if v.get("publishedAt")]
    if not published:
        return None
    newest = max(published, key=lambda v: v["version"])
    return newest if newest.get("tutorial") else None


def intake_types(types: list) -> tuple[str, InlineKeyboardMarkup]:
    live = [t for t in types if t.get("status") != "retired"]
    # Ready types first: they are the ones this flow can take all the way.
    live.sort(key=lambda t: ready_spec(t) is None)
    shown = live[:8]

    lines = ["<b>New task</b>", ""]
    if not live:
        lines.append("There are no task types yet. Tap New task type to make one.")
    else:
        lines.append("What kind of work is it?")
    if any(ready_spec(t) is None for t in shown):
        lines += [
            "",
            "<i>Types marked draft cannot be given out until they are finished on the console.</i>",
        ]
    if len(live) > len(shown):
        lines += ["", f"<i>Showing {len(shown)} of {len(live)}. The rest are on the console.</i>"]

    rows = [
        [
            InlineKeyboardButton(
                text=t["name"] + ("" if ready_spec(t) else " (draft)"),
                callback_data=step(INTAKE, "type", t["id"][-10:]),
            )
        ]
        for t in shown
    ]
    rows.append(
        [InlineKeyboardButton(text="New task type", callback_data=step(INTAKE, "newtype"))]
    )
    rows.append([_stop(INTAKE)])
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=rows)


def intake_type_name(error: str = "") -> tuple[str, InlineKeyboardMarkup]:
    lines = []
    if error:
        lines += [escape(error), ""]
    lines += ["<b>New task type</b>", ""]
    if error:
        lines.append("Send a different name.")
    else:
        lines.append("Send me its name as a message, for example <i>Profile cleanup</i>.")
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=[[_stop(INTAKE)]])


def intake_category(name: str) -> tuple[str, InlineKeyboardMarkup]:
    lines = [
        f"<b>New task type</b> · {escape(name)}",
        "",
        "Which kind is it?",
        "",
        "<b>Standard</b> — closes as soon as the tasker submits, and is tracked by the "
        "hours they report.",
        "<b>Critical</b> — you review it first, then it is checked on the platform itself.",
    ]
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Standard", callback_data=step(INTAKE, "cat", "STANDARD")),
                InlineKeyboardButton(text="Critical", callback_data=step(INTAKE, "cat", "CRITICAL")),
            ],
            [_stop(INTAKE)],
        ]
    )
    return "\n".join(lines), kb


def intake_not_ready(
    name: str, console_url: str, *, created: bool
) -> tuple[str, InlineKeyboardMarkup]:
    """Said plainly at intake, rather than letting an admin build a task that
    nobody would be able to take."""
    if created:
        lines = [
            f"<b>{escape(name)}</b> is saved as a draft.",
            "",
            "It cannot be given out yet. On the console, add its checklist and tutorial video, "
            "then publish it. After that it will show up here when you use /new.",
        ]
    else:
        lines = [
            f"<b>{escape(name)}</b> cannot be given out yet.",
            "",
            "It still needs a checklist and a tutorial video, published on the console. "
            "Taskers qualify for the work by watching that video, so until then nobody could "
            "take it.",
        ]
    kb = InlineKeyboardMarkup(inline_keyboard=[[_console(console_url, "/task-types")]])
    return "\n".join(lines), kb


def intake_due(name: str) -> tuple[str, InlineKeyboardMarkup]:
    buttons = [
        InlineKeyboardButton(text=label, callback_data=step(INTAKE, "due", str(hours)))
        for hours, label in DUE_WINDOWS
    ]
    kb = InlineKeyboardMarkup(inline_keyboard=[buttons[:2], buttons[2:], [_stop(INTAKE)]])
    return f"<b>New task</b> · {escape(name)}\n\nWhen should it be done by?", kb


def intake_dispatch(name: str, hours: int) -> tuple[str, InlineKeyboardMarkup]:
    lines = [
        f"<b>New task</b> · {escape(name)}",
        f"Due in {due_words(hours)}",
        "",
        "Who should do it?",
        "",
        "<b>Open to everyone</b> — any tasker who has watched its tutorial can pick it up.",
        "<b>Give to one person</b> — you choose from the people who have watched it.",
    ]
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Open to everyone", callback_data=step(INTAKE, "open")),
                InlineKeyboardButton(text="Give to one person", callback_data=step(INTAKE, "one")),
            ],
            [_stop(INTAKE)],
        ]
    )
    return "\n".join(lines), kb


def intake_people(name: str, hours: int, pool: dict) -> tuple[str, InlineKeyboardMarkup]:
    """Only people certified on this exact version are offered: the API would
    refuse anyone else, so listing them would only produce an error."""
    people = (pool.get("ranked", []) + pool.get("unranked", []))[:8]
    lines = [f"<b>New task</b> · {escape(name)}", f"Due in {due_words(hours)}", ""]

    if not people:
        lines += [
            "Nobody has watched the tutorial for this task yet, so there is nobody to give it "
            "to directly.",
            "",
            "You can open it to everyone instead. Taskers watch the tutorial from the queue, "
            "then pick it up.",
        ]
        kb = InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="Open to everyone", callback_data=step(INTAKE, "open"))],
                [_stop(INTAKE)],
            ]
        )
        return "\n".join(lines), kb

    lines += ["Who should do it? Only people who have watched its tutorial are listed.", ""]
    ranked_ids = {t["id"] for t in pool.get("ranked", [])}
    for t in people:
        standing = (
            f"{round(t['approvalRate'] * 100)}% approved"
            if t["id"] in ranked_ids
            else "not yet ranked"
        )
        busy = " · busy" if t.get("busy") else ""
        lines.append(f"  {escape(t['name'])} — {standing}{busy}")

    rows = []
    batch = []
    for t in people:
        batch.append(
            InlineKeyboardButton(text=t["name"], callback_data=step(INTAKE, "who", t["id"][-10:]))
        )
        if len(batch) == 2:
            rows.append(batch)
            batch = []
    if batch:
        rows.append(batch)
    rows.append(
        [InlineKeyboardButton(text="Open to everyone instead", callback_data=step(INTAKE, "open"))]
    )
    rows.append([_stop(INTAKE)])
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=rows)


def intake_confirm(name: str, hours: int, who: str | None) -> tuple[str, InlineKeyboardMarkup]:
    lines = [
        "<b>Ready to create</b>",
        "",
        escape(name),
        f"Due in {due_words(hours)}",
        f"Given to <b>{escape(who)}</b>" if who else "Open to everyone",
        "",
        "Nothing is created until you tap Create task.",
    ]
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Create task", callback_data=step(INTAKE, "go")),
                _stop(INTAKE),
            ]
        ]
    )
    return "\n".join(lines), kb


def intake_done(
    task: dict, name: str, hours: int, who: str | None, console_url: str
) -> tuple[str, InlineKeyboardMarkup]:
    code = escape(task["code"])
    if who:
        lines = [
            f"<b>{code}</b> has been given to {escape(who)}.",
            "",
            f"{escape(name)} · due in {due_words(hours)}",
            "",
            "It is waiting for them to accept it. You can follow it on the board.",
        ]
    else:
        lines = [
            f"<b>{code}</b> is open to everyone.",
            "",
            f"{escape(name)} · due in {due_words(hours)}",
            "",
            "Any tasker who has watched its tutorial can pick it up now.",
        ]
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=f"View {task['code']}", callback_data=encode("task", task["code"])
                )
            ],
            [_console(console_url, "/board")],
        ]
    )
    return "\n".join(lines), kb


def intake_failed(
    reason: str, code: str | None, cancelled: bool, console_url: str
) -> tuple[str, InlineKeyboardMarkup]:
    lines = ["<b>The task was not sent out.</b>", "", escape(reason), ""]
    if code and cancelled:
        lines.append(f"{escape(code)} has been cancelled, so nothing is left half-done.")
    elif code:
        lines.append(f"{escape(code)} is still a draft. Finish or cancel it on the console.")
    else:
        lines.append("No task was created.")
    kb = InlineKeyboardMarkup(inline_keyboard=[[_console(console_url, "/board")]])
    return "\n".join(lines), kb


# --- flows: account form ------------------------------------------------------

FORM_KEYS = ("ref", "platform", "loginUrl", "username", "email", "password", "twoFactor", "notes")

# What the summary masks is exactly what the flow deletes from the chat. One
# set, so the two can never disagree about what counts as secret.
FORM_SECRET = frozenset({"username", "email", "password", "twoFactor"})

FORM_LABEL = {
    "ref": "Reference",
    "platform": "Platform",
    "loginUrl": "Sign-in link",
    "username": "Username",
    "email": "Email",
    "password": "Password",
    "twoFactor": "2FA codes",
    "notes": "Notes for the tasker",
}

FORM_ASK = {
    "ref": "What is the account's reference? For example <code>ACC-006</code>. "
    "It is the name everyone uses for the account.",
    "platform": "Which platform is it on? For example <i>Upwork</i>.",
    "loginUrl": "Where do taskers sign in? Send the link, for example <i>upwork.com/login</i>.",
    "username": "What is the username?",
    "email": "What email address does it sign in with?",
    "password": "What is the password?",
    "twoFactor": "Any 2FA or backup codes? Send them all in one message.",
    "notes": "Any instructions for the tasker? For example <i>Sign in from the Lagos proxy "
    "only.</i> Taskers see these before they sign in.",
}

_ON_FILE = {
    "username": ("A username is on file.", "No username on file."),
    "email": ("An email address is on file.", "No email address on file."),
    "password": ("A password is on file.", "No password on file."),
    "twoFactor": ("2FA codes are on file.", "No 2FA codes on file."),
}


def _now_set(key: str, current: dict) -> str:
    """Update mode opens each step with what is there now - by name only, for
    login details."""
    if key in _ON_FILE:
        present, absent = _ON_FILE[key]
        return present if key in (current.get("fields") or []) else absent
    value = current.get(key)
    if not value:
        return f"No {FORM_LABEL[key].lower()} set yet."
    shown, _ = _clip(value, 300)
    if key == "notes":
        return f"Notes now:\n<i>{escape(shown)}</i>"
    return f"{FORM_LABEL[key]} now: <b>{escape(shown)}</b>"


def account_form_step(
    key: str,
    draft: dict,
    *,
    number: int | None,
    total: int,
    removed: bool | None = None,
    error: str = "",
) -> tuple[str, InlineKeyboardMarkup]:
    update = draft["mode"] == "update"
    answers = draft.get("answers") or {}

    lines = _removed(removed)
    if error:
        lines += [escape(error), ""]
    head = f"<b>Update {escape(draft['account_ref'])}</b>" if update else "<b>Add an account</b>"
    if number:
        head += f" · step {number} of {total}"
    lines += [head, ""]

    if update:
        lines += [_now_set(key, draft.get("current") or {}), ""]
        if key == "notes":
            lines.append("Send new notes to replace them, or tap Keep.")
        else:
            lines.append("Send a new one to replace it, or tap Keep.")
    else:
        lines.append(FORM_ASK[key])
        if key == "password" and not answers.get("username") and not answers.get("email"):
            lines += [
                "",
                "<b>Heads up:</b> you skipped both the username and the email. Taskers need "
                "one of them to sign in. You can add one from the summary before saving.",
            ]

    if key in FORM_SECRET:
        lines += ["", "<i>I will remove your message from the chat as soon as I have read it.</i>"]

    buttons = []
    if key != "ref":
        buttons.append(
            InlineKeyboardButton(
                text="Keep" if update else "Skip", callback_data=step(ACCOUNT_FORM, "skip", key)
            )
        )
    buttons.append(_stop(ACCOUNT_FORM))
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=[buttons])


def account_form_summary(
    draft: dict, *, removed: bool | None = None, error: str = ""
) -> tuple[str, InlineKeyboardMarkup]:
    """Login details appear as "set", never as values. Telegram keeps chat
    history on every device the admin is signed in on."""
    update = draft["mode"] == "update"
    answers = draft.get("answers") or {}

    lines = _removed(removed)
    if error:
        lines += [escape(error), ""]

    save_row = [
        InlineKeyboardButton(text="Save", callback_data=step(ACCOUNT_FORM, "save")),
        _stop(ACCOUNT_FORM),
    ]
    rows = []
    if update:
        lines += [f"<b>Check the changes to {escape(draft['account_ref'])}</b>", ""]
        for key in FORM_KEYS[1:]:
            value = answers.get(key)
            if not value:
                shown = "unchanged"
            elif key in FORM_SECRET:
                shown = "new codes set" if key == "twoFactor" else "new one set"
            else:
                shown = escape(_clip(value, 300)[0])
            lines.append(f"{FORM_LABEL[key]}: {shown}")
        if any(answers.get(k) for k in FORM_KEYS):
            rows.append(save_row)
        else:
            lines += ["", "You have not changed anything, so there is nothing to save."]
            rows.append(
                [InlineKeyboardButton(text="Close", callback_data=step(ACCOUNT_FORM, "stop"))]
            )
    else:
        lines += ["<b>Check before saving</b>", ""]
        for key in FORM_KEYS:
            value = answers.get(key)
            if key in FORM_SECRET:
                shown = "set" if value else "not given"
            else:
                shown = escape(_clip(value, 300)[0]) if value else "not given"
            lines.append(f"{FORM_LABEL[key]}: {shown}")
        rows.append(save_row)
        if not answers.get("username") and not answers.get("email"):
            lines += [
                "",
                "<b>No username or email.</b> Taskers usually need one of them to sign in.",
            ]
            rows.append(
                [
                    InlineKeyboardButton(
                        text="Add username", callback_data=step(ACCOUNT_FORM, "fix", "username")
                    ),
                    InlineKeyboardButton(
                        text="Add email", callback_data=step(ACCOUNT_FORM, "fix", "email")
                    ),
                ]
            )

    lines += [
        "",
        "<i>Login details show only as set. Their values are never displayed in Telegram.</i>",
    ]
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=rows)


def account_saved(account: dict, mode: str, console_url: str) -> tuple[str, InlineKeyboardMarkup]:
    ref = escape(account["ref"])
    lines = [f"<b>{ref}</b> is saved." if mode == "create" else f"<b>{ref}</b> is updated.", ""]
    fields = account.get("fields") or []
    if fields:
        lines.append(f"Login details on file: {_fields(fields)}.")
        lines.append("They are stored encrypted and never shown in Telegram.")
    if mode == "create" and account.get("state") == "HEALTHY":
        lines += ["", "It can be handed out for new tasks now."]
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=f"View {account['ref']}",
                    callback_data=encode("account", account["id"], 1),
                ),
                InlineKeyboardButton(text="Accounts", callback_data=encode("accounts", "", 1)),
            ],
            [_console(console_url, "/accounts")],
        ]
    )
    return "\n".join(lines), kb
