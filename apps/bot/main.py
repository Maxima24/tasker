"""Tasker bot.

Two privilege levels, neither enforced here. Every action is a call to the
orchestrator, authorized there; this process only decides what to draw.

Section 15 in three rules:
  1. answerCallbackQuery fires BEFORE any data fetch. Telegram spins the button
     until it returns, so acknowledging first is the single largest
     perceived-speed improvement available.
  2. One text message, edited in place. Drill-downs never leave dead menus.
  3. Unlinked senders are ignored silently.
"""
from __future__ import annotations

import asyncio
import sys
from contextlib import suppress
from urllib.parse import quote

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.exceptions import TelegramBadRequest
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    BotCommand,
    BufferedInputFile,
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InputMediaPhoto,
    Message,
)
from redis.asyncio import Redis

from src import logger, views
from src.services import alerts
from src.clients.api import ApiClient, ApiError
from src.config import load
from src.flows import account_form, intake
from src.flows.common import LeaveFlowOnCommand, abandon, redraw
from src.nav import NavStack, decode, decode_action, encode

log = logger.get("bot")

BOT_COMMANDS = [
    BotCommand(command="today", description="One-screen status summary"),
    BotCommand(command="pending", description="Reviews and verifications awaiting action"),
    BotCommand(command="tickets", description="Tickets waiting on somebody"),
    BotCommand(command="new", description="Create a task and give it out"),
    BotCommand(command="task", description="Jump to a task: /task TSK-4471"),
    BotCommand(command="taskers", description="The tasker pool"),
    BotCommand(command="accounts", description="The account pool"),
    BotCommand(command="account", description="Jump to an account: /account ACC-002"),
    BotCommand(command="addaccount", description="Load a new account's login details"),
    BotCommand(command="help", description="What each command does"),
    BotCommand(command="cancel", description="Stop what you are in the middle of"),
]

# Resting is the routine fix for a platform that is getting suspicious, so it is
# one tap. Suspend and retire take an account out of rotation and ask first.
ACCOUNT_CHANGES = {
    "healthy": ("HEALTHY", None, "Marked healthy. It can be handed out again."),
    "rest": ("COOLDOWN", 360, "Resting for 6 hours. Mark it healthy when it is ready again."),
    "challenged": ("CHALLENGED", None, "Marked as challenged. It is not handed out for now."),
    "suspend.yes": ("SUSPENDED", None, "Suspended."),
    "retire.yes": ("RETIRED", None, "Retired."),
}


async def amain() -> None:
    settings = load()
    logger.configure(settings.log_level)

    bot = Bot(
        token=settings.telegram_bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    # Flow state (a half-typed /addaccount included) lives in process memory,
    # NOT in Redis: that Redis runs with appendonly persistence, so a password
    # held there would be written to disk.
    dp = Dispatcher(storage=MemoryStorage())
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    nav = NavStack(redis)

    async with ApiClient(settings.api_base_url, settings.internal_api_secret) as api:
        # --- identity -------------------------------------------------

        @dp.message(CommandStart(deep_link=True))
        async def start_link(message: Message, command: CommandObject) -> None:
            """Bind by numeric telegram id, via the nonce minted on the console."""
            if not message.from_user:
                return
            nonce = (command.args or "").strip()
            try:
                result = await api.link(nonce, message.from_user.id)
            except ApiError as e:
                await message.answer(e.message)
                return
            api.invalidate(message.from_user.id)
            await message.answer(
                f"Linked as <b>{result['name']}</b>. Try /today."
            )

        @dp.message(CommandStart())
        async def start(message: Message) -> None:
            await render_root(message)

        # --- helpers --------------------------------------------------

        async def session_or_silence(user_id: int):
            """None means unlinked. The caller returns without replying: a bot
            that says 'you are not authorised' has told a stranger it is worth
            probing."""
            try:
                return await api.session_for(user_id)
            except ApiError:
                return None

        # A command typed mid-flow leaves the flow before it runs.
        dp.message.outer_middleware(
            LeaveFlowOnCommand({c.command for c in BOT_COMMANDS} | {"start"}, session_or_silence)
        )

        async def render_root(message: Message) -> None:
            if not message.from_user:
                return
            session = await session_or_silence(message.from_user.id)
            if session is None:
                return
            summary = await api.get(message.from_user.id, "/today")
            tickets = await api.get(message.from_user.id, "/tickets?status=OPEN&limit=1")
            text, kb = views.home(session.name, summary, tickets.get("total", 0))
            sent = await message.answer(text, reply_markup=kb)
            await nav.reset(sent.chat.id, sent.message_id, encode("home"))

        async def build(user_id: int, view: str, ref: str, page: int):
            """One place that turns a destination into (text, keyboard)."""
            if view == "home":
                session = await api.session_for(user_id)
                summary = await api.get(user_id, "/today")
                tickets = await api.get(user_id, "/tickets?status=OPEN&limit=1")
                return views.home(
                    session.name if session else "", summary, tickets.get("total", 0)
                )
            if view == "today":
                return views.today(await api.get(user_id, "/today"), settings.console_url)
            if view == "pending":
                review = await api.get(user_id, "/queues/review")
                verification = await api.get(user_id, "/queues/verification")
                return views.pending(review, verification, settings.console_url)
            if view == "tickets":
                data = await api.get(user_id, "/tickets?status=OPEN,CLAIMED&limit=10")
                return views.tickets(data.get("items", []), settings.console_url)
            if view == "taskers":
                return views.taskers(await api.get(user_id, "/taskers"), settings.console_url)
            if view == "tasker":
                # Callback data is capped at 64 bytes, so the button carries a
                # suffix of the id and we resolve it against the pool here.
                pool = await api.get(user_id, "/taskers")
                match = next(
                    (t for t in pool["ranked"] + pool["unranked"] if t["id"].endswith(ref)),
                    None,
                )
                if match is None:
                    return views.stale("That tasker is no longer in the pool.")
                data = await api.get(user_id, f"/taskers/{match['id']}/submissions")
                return views.tasker_audit(data, settings.console_url)
            if view == "review":
                task = await api.get(user_id, f"/tasks/{ref}")
                if task["state"] != "IN_REVIEW":
                    return views.stale(
                        f"{task['code']} is now {views.STATE_LABEL.get(task['state'], task['state'])}."
                    )
                return views.review(task, settings.console_url)
            if view == "task":
                return views.task_detail(
                    await api.get(user_id, f"/tasks/{ref}"), settings.console_url
                )
            if view == "accounts":
                # `page` is the list page here, 1-based; commands arrive with 0.
                data = await api.get(user_id, f"/accounts?page={max(page, 1)}&limit=8")
                return views.accounts(data, settings.console_url)
            if view == "account":
                # `ref` is the account id; `page` is the list page to go back to.
                account = await api.get(user_id, f"/accounts/{quote(ref, safe='')}")
                return views.account_detail(account, settings.console_url, max(page, 1))
            if view == "help":
                return views.help_screen()
            return views.stale("That view no longer exists.")

        async def swap(cq: CallbackQuery, view: str, ref: str, page: int) -> None:
            if not isinstance(cq.message, Message) or not cq.from_user:
                return
            try:
                text, kb = await build(cq.from_user.id, view, ref, page)
            except ApiError as e:
                await redraw(cq.message, views.stale(e.message))
                return
            with suppress(TelegramBadRequest):  # "message is not modified"
                await cq.message.edit_text(text, reply_markup=kb)
            await nav.push(cq.message.chat.id, cq.message.message_id, encode(view, ref, page))

        # --- commands -------------------------------------------------

        @dp.message(Command("today"))
        async def today_cmd(message: Message) -> None:
            await jump(message, "today", "")

        @dp.message(Command("pending"))
        async def pending_cmd(message: Message) -> None:
            await jump(message, "pending", "")

        @dp.message(Command("tickets"))
        async def tickets_cmd(message: Message) -> None:
            await jump(message, "tickets", "")

        @dp.message(Command("taskers"))
        async def taskers_cmd(message: Message) -> None:
            await jump(message, "taskers", "")

        @dp.message(Command("task"))
        async def task_cmd(message: Message, command: CommandObject) -> None:
            code = (command.args or "").strip().upper()
            if not code:
                await message.answer("Which one? Try <code>/task TSK-4007</code>.")
                return
            await jump(message, "task", code)

        @dp.message(Command("accounts"))
        async def accounts_cmd(message: Message) -> None:
            await jump(message, "accounts", "")

        @dp.message(Command("account"))
        async def account_cmd(message: Message, command: CommandObject) -> None:
            """Looked up by the reference typed, then remembered by id: whatever
            the admin typed may not fit in a 64-byte button."""
            if not message.from_user:
                return
            if await session_or_silence(message.from_user.id) is None:
                return
            ref = (command.args or "").strip()
            if not ref:
                await message.answer("Which one? Try <code>/account ACC-002</code>.")
                return
            try:
                account = await api.get(message.from_user.id, f"/accounts/{quote(ref, safe='')}")
            except ApiError as e:
                text, kb = views.refused(e.message)
                await message.answer(text, reply_markup=kb)
                return
            text, kb = views.account_detail(account, settings.console_url)
            sent = await message.answer(text, reply_markup=kb)
            await nav.reset(sent.chat.id, sent.message_id, encode("account", account["id"], 1))

        @dp.message(Command("help"))
        async def help_cmd(message: Message) -> None:
            await jump(message, "help", "")

        @dp.message(Command("cancel"))
        async def cancel_cmd(message: Message, state: FSMContext) -> None:
            """Answers a linked sender whether or not a flow was open, so nobody
            is left wondering if the half-typed thing was saved."""
            if not message.from_user:
                return
            if await session_or_silence(message.from_user.id) is None:
                await state.clear()
                return
            flow = await abandon(bot, message.chat.id, state)
            text, _ = views.flow_stopped(flow)
            await message.answer(text)

        async def jump(message: Message, view: str, ref: str) -> None:
            """Commands jump to known places. Buttons do the browsing."""
            if not message.from_user:
                return
            if await session_or_silence(message.from_user.id) is None:
                return
            try:
                text, kb = await build(message.from_user.id, view, ref, 0)
            except ApiError as e:
                text, kb = views.stale(e.message)
            sent = await message.answer(text, reply_markup=kb)
            await nav.reset(sent.chat.id, sent.message_id, encode(view, ref, 0))

        # --- navigation callbacks -------------------------------------

        @dp.callback_query(F.data.startswith("v:"))
        async def on_view(cq: CallbackQuery) -> None:
            # Acknowledge FIRST. Everything after this is off the critical path
            # of the spinner.
            await cq.answer()
            if not cq.from_user or not cq.data:
                return
            if await session_or_silence(cq.from_user.id) is None:
                return
            view, ref, page = decode(cq.data)
            if view == "proof":
                # Proof is a photo message, not a text swap - it cannot share
                # the edit_text path.
                if isinstance(cq.message, Message):
                    await show_proof(cq.message, cq.from_user.id, ref, page, edit=False)
                return
            await swap(cq, view, ref, page)

        # --- proof pager ----------------------------------------------

        @dp.callback_query(F.data.startswith("p:"))
        async def on_page(cq: CallbackQuery) -> None:
            """A Telegram message is either text or media, never both, so proof
            gets its own photo message paged with editMessageMedia."""
            await cq.answer()
            if not cq.from_user or not cq.data or not isinstance(cq.message, Message):
                return
            _, code, index = cq.data.split(":", 2)
            await show_proof(cq.message, cq.from_user.id, code, int(index), edit=True)

        async def show_proof(
            message: Message, user_id: int, code: str, index: int, *, edit: bool
        ) -> None:
            task = await api.get(user_id, f"/tasks/{code}")
            proofs = task.get("proofs", [])
            if not proofs:
                await message.answer("No proof on that task yet.")
                return
            index = max(0, min(index, len(proofs) - 1))
            proof = proofs[index]

            caption = (
                f"<b>{task['code']}</b> · {proof['checklistKey']}\n"
                f"frame {index + 1} of {len(proofs)}"
            )
            rows = []
            pager = []
            if index > 0:
                pager.append(
                    InlineKeyboardButton(text="<", callback_data=f"p:{code}:{index - 1}")
                )
            if index < len(proofs) - 1:
                pager.append(
                    InlineKeyboardButton(text=">", callback_data=f"p:{code}:{index + 1}")
                )
            if pager:
                rows.append(pager)
            rows.append(
                [InlineKeyboardButton(text="< Back to review", callback_data=encode("review", code))]
            )
            kb = InlineKeyboardMarkup(inline_keyboard=rows)

            # file_id is cached on the proof record on first send and reused
            # after, so paging back and forth costs Telegram one upload total.
            file_id = proof.get("telegramFileId")
            if file_id:
                media = InputMediaPhoto(media=file_id, caption=caption)
            else:
                raw = await api.fetch_bytes(user_id, f"/proof/{proof['id']}/file")
                media = InputMediaPhoto(
                    media=BufferedInputFile(raw, filename=f"{proof['checklistKey']}.png"),
                    caption=caption,
                )

            if edit:
                with suppress(TelegramBadRequest):
                    await message.edit_media(media, reply_markup=kb)
                return

            sent = await message.answer_photo(
                media.media, caption=caption, reply_markup=kb
            )
            if sent.photo and not file_id:
                with suppress(ApiError):
                    await api.post(
                        user_id,
                        f"/proof/{proof['id']}/telegram-file-id",
                        {"fileId": sent.photo[-1].file_id},
                    )

        # --- actions ---------------------------------------------------

        @dp.callback_query(F.data.startswith("a:"))
        async def on_action(cq: CallbackQuery) -> None:
            await cq.answer()
            if not cq.from_user or not cq.data or not isinstance(cq.message, Message):
                return
            if await session_or_silence(cq.from_user.id) is None:
                return

            name, code, version = decode_action(cq.data)

            if name.startswith("acc."):
                await account_action(cq.message, cq.from_user.id, name[4:], code, version)
                return

            # Claiming a ticket from the alert message itself. The reminders
            # stop for everyone the moment one person takes it.
            if name == "tclaim":
                tickets = await api.get(cq.from_user.id, "/tickets?status=OPEN,CLAIMED&limit=50")
                match = next(
                    (t for t in tickets.get("items", []) if t["id"].endswith(code)), None
                )
                if match is None:
                    await redraw(cq.message, views.stale("That ticket is no longer open."))
                    return
                result = await api.post(cq.from_user.id, f"/tickets/{match['id']}/claim")
                if result.get("won"):
                    await cq.message.edit_text(
                        f"<b>{match['code']}</b>\n\nYou have it. Reminders have stopped.",
                        reply_markup=InlineKeyboardMarkup(
                            inline_keyboard=[
                                [
                                    InlineKeyboardButton(
                                        text="Open in console",
                                        url=f"{settings.console_url}/tickets/{match['id']}",
                                    )
                                ]
                            ]
                        ),
                    )
                else:
                    await redraw(
                        cq.message,
                        views.stale(f"{result.get('claimedBy')} is already handling it."),
                    )
                return

            try:
                task = await api.get(cq.from_user.id, f"/tasks/{code}")
            except ApiError as e:
                await redraw(cq.message, views.stale(e.message))
                return

            # Buttons stay tappable forever. A tap carrying an old version is
            # refused and the keyboard comes off, so nothing is approved twice.
            if task["version"] != version:
                await redraw(
                    cq.message,
                    views.stale(
                        f"{task['code']} is now "
                        f"{views.STATE_LABEL.get(task['state'], task['state'])}."
                    ),
                )
                return

            try:
                if name == "pass":
                    await api.post(
                        cq.from_user.id,
                        f"/tasks/{task['id']}/review",
                        {"outcome": "PASS", "note": "Approved from Telegram"},
                    )
                    done = "Approved. It is now awaiting an external verdict."
                else:
                    await api.post(
                        cq.from_user.id,
                        f"/tasks/{task['id']}/review",
                        {"outcome": "FAIL", "reason": "Sent back from Telegram"},
                    )
                    done = "Sent back to the tasker, on the same account."
            except ApiError as e:
                await redraw(cq.message, views.stale(e.message))
                return

            await cq.message.edit_text(
                f"<b>{task['code']}</b>\n\n{done}",
                reply_markup=InlineKeyboardMarkup(
                    inline_keyboard=[
                        [InlineKeyboardButton(text="< Pending", callback_data=encode("pending"))]
                    ]
                ),
            )

        async def account_action(
            message: Message, user_id: int, op: str, account_id: str, page: int
        ) -> None:
            """State changes from the account screen. Whether this person may
            make them is the API's call; a refusal is shown as it was worded."""
            path = f"/accounts/{quote(account_id, safe='')}"
            back = encode("account", account_id, page)

            if op in ("suspend", "retire"):
                try:
                    account = await api.get(user_id, path)
                except ApiError as e:
                    await redraw(message, views.refused(e.message, back))
                    return
                await redraw(message, views.account_confirm(account, op, page))
                return

            change = ACCOUNT_CHANGES.get(op)
            if change is None:
                return
            target, minutes, done = change
            body: dict = {"state": target}
            if minutes:
                body["cooldownMinutes"] = minutes
            try:
                await api.post(user_id, f"{path}/state", body)
                account = await api.get(user_id, path)
            except ApiError as e:
                await redraw(message, views.refused(e.message, back))
                return
            await redraw(message, views.account_detail(account, settings.console_url, page, done))

        # --- flows ----------------------------------------------------
        #
        # The dispatcher's own handlers above always run before any included
        # router, so commands and navigation keep working mid-flow. The routers
        # then run in the order included, and the catch-all comes last: a
        # typed answer must reach its flow before anything shrugs at it.

        dp.include_router(intake.router(api, settings, session_or_silence))
        dp.include_router(account_form.router(api, settings, session_or_silence))

        # --- unlinked senders ------------------------------------------

        fallback = Router(name="fallback")

        @fallback.message()
        async def catch_all(message: Message) -> None:
            if not message.from_user:
                return
            if await session_or_silence(message.from_user.id) is None:
                return  # silence
            await message.answer(
                "Try /today, /pending, /new or /accounts. /help lists everything."
            )

        dp.include_router(fallback)

        with suppress(Exception):
            await bot.set_my_commands(BOT_COMMANDS)

        # Push: the API publishes ticket alerts to Redis and this delivers them.
        alert_task = asyncio.create_task(
            alerts.run(bot, redis, settings.console_url), name="alerts"
        )

        def _alerts_done(task: asyncio.Task) -> None:
            # Supervised, so a dead listener shouts instead of going quiet.
            if task.cancelled():
                return
            exc = task.exception()
            if exc is not None:
                log.error("alert listener exited unexpectedly", error=str(exc))

        alert_task.add_done_callback(_alerts_done)

        log.info("bot polling", api=settings.api_base_url)
        try:
            await dp.start_polling(bot)
        finally:
            alert_task.cancel()
            with suppress(asyncio.CancelledError):
                await alert_task
            await redis.aclose()
            await bot.session.close()


def main() -> None:
    try:
        asyncio.run(amain())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
