"""Navigation state.

Section 15: one text message, edited in place. A drill-down consumes one
message forever and the chat never fills with dead menus.

Callback data is capped at 64 bytes by Telegram, so it encodes a DESTINATION,
not a path: `v:<view>:<ref>:<page>`. The back stack lives in Redis keyed by
`chat_id:message_id` with a 24-hour TTL. An expired stack falls through to the
root menu rather than erroring - a stack is a convenience, never a
prerequisite for the bot working.
"""
from __future__ import annotations

from redis.asyncio import Redis

STACK_TTL_SEC = 24 * 60 * 60
MAX_DEPTH = 12


def _key(chat_id: int, message_id: int) -> str:
    return f"nav:{chat_id}:{message_id}"


class NavStack:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def push(self, chat_id: int, message_id: int, destination: str) -> None:
        key = _key(chat_id, message_id)
        await self._redis.rpush(key, destination)
        await self._redis.ltrim(key, -MAX_DEPTH, -1)
        await self._redis.expire(key, STACK_TTL_SEC)

    async def pop(self, chat_id: int, message_id: int) -> str | None:
        """Drop the current view and return the one beneath it."""
        key = _key(chat_id, message_id)
        await self._redis.rpop(key)
        previous = await self._redis.lindex(key, -1)
        await self._redis.expire(key, STACK_TTL_SEC)
        return previous

    async def reset(self, chat_id: int, message_id: int, destination: str) -> None:
        key = _key(chat_id, message_id)
        await self._redis.delete(key)
        await self._redis.rpush(key, destination)
        await self._redis.expire(key, STACK_TTL_SEC)


def encode(view: str, ref: str = "", page: int = 0) -> str:
    """`v:<view>:<ref>:<page>`, kept well inside Telegram's 64-byte cap."""
    data = f"v:{view}:{ref}:{page}"
    if len(data.encode()) > 64:
        raise ValueError(f"callback data too long: {data}")
    return data


def decode(data: str) -> tuple[str, str, int]:
    _, view, ref, page = (data.split(":", 3) + ["", "", "0"])[:4]
    return view, ref, int(page or 0)


def action(name: str, ref: str, version: int) -> str:
    """Action callbacks carry the task VERSION.

    Inline buttons stay tappable indefinitely, so a tap from yesterday must be
    refused rather than replayed. Without this an admin approves something
    twice and nobody notices until it matters.
    """
    data = f"a:{name}:{ref}:{version}"
    if len(data.encode()) > 64:
        raise ValueError(f"callback data too long: {data}")
    return data


def decode_action(data: str) -> tuple[str, str, int]:
    _, name, ref, version = (data.split(":", 3) + ["", "", "0"])[:4]
    return name, ref, int(version or 0)


# Multi-step flows. Their progress lives in the FSM, so a button only names the
# choice made at this step - never the answers so far, which may be secret.
INTAKE = "n"
ACCOUNT_FORM = "f"


def step(flow: str, name: str, arg: str = "") -> str:
    """`<flow>:<name>:<arg>`, with the same 64-byte cap as everything else."""
    data = f"{flow}:{name}:{arg}"
    if len(data.encode()) > 64:
        raise ValueError(f"callback data too long: {data}")
    return data


def decode_step(data: str) -> tuple[str, str]:
    _, name, arg = (data.split(":", 2) + ["", ""])[:3]
    return name, arg
