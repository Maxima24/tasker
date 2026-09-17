"""Subscribe to the orchestrator's alert channel and deliver to Telegram.

Ported from SwiftHum's notification loop, and it keeps that loop's hard-won
shape:

  - `get_message(timeout=...)` rather than blocking `listen()`. An idle
    subscription with a socket read-timeout makes `listen()` raise on every
    quiet window, which produced a timeout storm in SwiftHum.
  - The loop is supervised. A dropped Redis connection must never leave the
    listener silently dead, because the failure mode is "no alerts for anyone"
    and nobody notices until a ticket has been sitting for an hour.
  - One bad message never kills the loop.
"""
from __future__ import annotations

import asyncio
import json
from contextlib import suppress

from aiogram import Bot
from aiogram.enums import ParseMode
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from redis.asyncio import Redis

from ..logger import get
from ..nav import action

log = get(__name__)

CHANNEL = "tasker.alerts"  # mirrors ALERT_CHANNEL in apps/api/src/common/notifier.service.ts


async def run(bot: Bot, redis: Redis, console_url: str) -> None:
    """Long-running coroutine. Cancel it from the caller on shutdown."""
    while True:
        pubsub = redis.pubsub()
        try:
            await pubsub.subscribe(CHANNEL)
            log.info("alert listener subscribed", channel=CHANNEL)
            while True:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message is None:
                    continue
                await _dispatch(bot, message.get("data"), console_url)
        except asyncio.CancelledError:
            log.info("alert listener stopping")
            with suppress(Exception):
                await pubsub.unsubscribe(CHANNEL)
                await pubsub.aclose()
            raise
        except Exception as e:  # noqa: BLE001 - dropped connection, failed subscribe
            log.warning("alert listener error; reconnecting in 3s", error=str(e))
            with suppress(Exception):
                await pubsub.aclose()
            await asyncio.sleep(3)


async def _dispatch(bot: Bot, raw, console_url: str) -> None:
    if raw is None:
        return
    try:
        alert = json.loads(raw if isinstance(raw, str) else raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        log.warning("alert not valid json", error=str(e))
        return

    try:
        text = _format(alert)
        keyboard = _keyboard(alert, console_url)
    except Exception as e:  # noqa: BLE001 - a bad payload must not kill the loop
        log.warning("could not format alert", error=str(e))
        return

    for telegram_id in alert.get("telegramIds", []):
        try:
            await bot.send_message(
                chat_id=int(telegram_id),
                text=text,
                parse_mode=ParseMode.HTML,
                reply_markup=keyboard,
                # Urgent tickets buzz the phone; everything else arrives quietly.
                disable_notification=not alert.get("urgent", False),
            )
        except Exception as e:  # noqa: BLE001 - most often 403, bot never started
            log.warning("alert send failed", telegram_id=telegram_id, error=str(e))


def _format(alert: dict) -> str:
    from html import escape

    head = escape(alert.get("title", "Alert"))
    if alert.get("urgent"):
        head = f"URGENT - {head}"

    lines = [f"<b>{head}</b>", ""]
    for line in alert.get("lines", []):
        lines.append(escape(str(line)))
    return "\n".join(lines).strip()


def _keyboard(alert: dict, console_url: str) -> InlineKeyboardMarkup | None:
    ticket_id = alert.get("ticketId")
    if not ticket_id:
        return None

    rows = []
    if alert.get("claimable"):
        # Claiming from the phone stops the reminders for everybody else, which
        # is the whole point of being nudged in the first place.
        rows.append(
            [
                InlineKeyboardButton(
                    text="I will handle this",
                    callback_data=action("tclaim", ticket_id[-10:], 0),
                )
            ]
        )
    rows.append(
        [
            InlineKeyboardButton(
                text="Open in console",
                url=f"{console_url}/tickets/{ticket_id}",
            )
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)
