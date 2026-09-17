"""Plumbing shared by the multi-step flows.

Flow state lives in aiogram's MemoryStorage, deliberately not in Redis. The
Redis this bot uses runs with appendonly persistence, so a password typed
halfway through /addaccount would be written to disk. Memory dies with the
process, which is exactly the lifetime a half-typed password should have.
"""
from __future__ import annotations

import asyncio
import time
from contextlib import suppress
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware, Bot
from aiogram.exceptions import TelegramBadRequest
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from .. import views

# How long a flow may sit between its first prompt and its last answer.
FLOW_TTL_SEC = 15 * 60

# `session_or_silence` from main: None means the sender is not linked.
Linked = Callable[[int], Awaitable[Any]]

# Strong references, or the event loop may collect a pending sweeper.
_sweepers: set[asyncio.Task] = set()


async def begin(bot: Bot, chat_id: int, state: FSMContext, flow: str, **data: Any) -> None:
    """Start a flow, replacing any other one this person had open."""
    await abandon(bot, chat_id, state)
    started = time.time()
    await state.set_data({"flow": flow, "started": started, **data})
    _schedule_sweep(state, started)


def timed_out(data: dict) -> bool:
    started = data.get("started")
    return started is None or time.time() - started > FLOW_TTL_SEC


async def abandon(bot: Bot, chat_id: int, state: FSMContext) -> str | None:
    """Clear the flow and take the buttons off its last prompt, so nothing from
    an ended flow stays tappable. Returns which flow it was, and nothing else -
    the answers collected so far never leave this function."""
    data = await state.get_data()
    await state.clear()
    prompt_id = data.get("prompt_id")
    if prompt_id:
        with suppress(Exception):
            await bot.edit_message_reply_markup(
                chat_id=chat_id, message_id=prompt_id, reply_markup=None
            )
    return data.get("flow")


async def show(
    target: Message, state: FSMContext, view: tuple[str, Any], *, edit: bool
) -> None:
    """Draw a flow prompt and remember where it is.

    A tap edits the prompt in place. A typed answer sits below the old prompt,
    so the next one goes out as a fresh message and the old one loses its
    buttons. Only the remembered prompt accepts taps.
    """
    if edit:
        await redraw(target, view)
        await state.update_data(prompt_id=target.message_id)
        return
    text, kb = view
    previous = (await state.get_data()).get("prompt_id")
    sent = await target.answer(text, reply_markup=kb)
    await state.update_data(prompt_id=sent.message_id)
    if previous and target.bot:
        with suppress(Exception):
            await target.bot.edit_message_reply_markup(
                chat_id=target.chat.id, message_id=previous, reply_markup=None
            )


async def redraw(message: Message, view: tuple[str, Any]) -> None:
    """Edit a message into a (text, keyboard) view. The keyboard goes by keyword:
    edit_text's second positional parameter is inline_message_id."""
    text, kb = view
    with suppress(TelegramBadRequest):
        await message.edit_text(text, reply_markup=kb)


async def delete_quietly(message: Message) -> bool:
    """Remove a message holding a login detail. True if Telegram confirmed.

    Telegram lets a bot delete incoming messages in a private chat for 48
    hours, which covers every answer typed into a live flow."""
    if not message.bot:
        return False
    try:
        return bool(await message.bot.delete_message(message.chat.id, message.message_id))
    except Exception:  # noqa: BLE001 - reported to the admin, never fatal
        return False


def _schedule_sweep(state: FSMContext, started: float) -> None:
    """Wipe an abandoned flow's answers once it expires.

    Without this, a flow walked away from mid-password keeps that password in
    memory until the admin next writes to the bot, which may be days. The flow
    marker stays behind so the next message is still recognised as late,
    answered as a timeout, and deleted if it was a login detail.
    """

    async def sweep() -> None:
        await asyncio.sleep(FLOW_TTL_SEC + 1)
        data = await state.get_data()
        if data.get("started") != started:
            return  # finished, cancelled, or replaced by a newer flow
        await state.set_data({"flow": data.get("flow"), "started": started})

    task = asyncio.create_task(sweep())
    _sweepers.add(task)
    task.add_done_callback(_sweepers.discard)


class LeaveFlowOnCommand(BaseMiddleware):
    """A command typed mid-flow abandons the flow first, then runs as normal.

    Otherwise the admin believes they have moved on while the flow still waits,
    and the next ordinary message they send is filed as a password. /cancel is
    left alone: saying that the flow stopped is its whole job.
    """

    def __init__(self, commands: set[str], linked: Linked) -> None:
        self._commands = commands
        self._linked = linked

    async def __call__(
        self,
        handler: Callable[[Message, dict[str, Any]], Awaitable[Any]],
        event: Message,
        data: dict[str, Any],
    ) -> Any:
        state: FSMContext | None = data.get("state")
        text = event.text or ""
        if state is not None and text.startswith("/"):
            name = text.split(maxsplit=1)[0][1:].split("@", 1)[0].lower()
            if name in self._commands and name != "cancel" and await state.get_state():
                flow = await abandon(data["bot"], event.chat.id, state)
                if event.from_user and await self._linked(event.from_user.id) is not None:
                    await event.answer(views.flow_stopped(flow)[0])
        return await handler(event, data)
