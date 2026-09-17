"""Async client for the orchestrator.

Auth model, ported from SwiftHum: the bot holds an INTERNAL_API_SECRET shared
with the API. For a given telegram id it POSTs /telegram/session (guarded by
that secret) and receives a normal session JWT, cached until expiry. Every
other call is a plain Bearer request against the same routes the web console
uses - the bot gets no private back door, so authorization cannot drift
between surfaces.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

import aiohttp


class ApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


# Sessions are signed with 8h expiry; refresh well inside that.
_JWT_TTL_SEC = 7 * 60 * 60


@dataclass
class _Cached:
    token: str
    expires_at: float
    role: str
    name: str


class ApiClient:
    def __init__(self, base_url: str, internal_secret: str) -> None:
        self._base = base_url.rstrip("/")
        self._secret = internal_secret
        self._sessions: dict[int, _Cached] = {}
        self._locks: dict[int, asyncio.Lock] = {}
        self._http: aiohttp.ClientSession | None = None

    async def __aenter__(self) -> "ApiClient":
        self._http = aiohttp.ClientSession()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        if self._http:
            await self._http.close()
            self._http = None

    # --- session -------------------------------------------------------

    async def session_for(self, telegram_id: int, *, force: bool = False) -> _Cached | None:
        """None means this telegram id is not linked to an active operator.

        The caller stays SILENT on None. A bot that answers "you are not
        authorised" has told a stranger it is worth probing.
        """
        if not force:
            cached = self._sessions.get(telegram_id)
            if cached and cached.expires_at > time.time():
                return cached

        lock = self._locks.setdefault(telegram_id, asyncio.Lock())
        async with lock:
            cached = self._sessions.get(telegram_id)
            if cached and cached.expires_at > time.time() and not force:
                return cached

            data = await self._raw(
                "POST",
                "/telegram/session",
                json_body={"telegramUserId": str(telegram_id)},
                headers={"x-internal-secret": self._secret},
            )
            if not data or not data.get("linked"):
                self._sessions.pop(telegram_id, None)
                return None

            entry = _Cached(
                token=data["sessionToken"],
                expires_at=time.time() + _JWT_TTL_SEC,
                role=data["user"]["role"],
                name=data["user"]["name"],
            )
            self._sessions[telegram_id] = entry
            return entry

    async def link(self, nonce: str, telegram_id: int) -> dict:
        return await self._raw(
            "POST",
            "/telegram/resolve",
            json_body={"nonce": nonce, "telegramUserId": str(telegram_id)},
            headers={"x-internal-secret": self._secret},
        )

    def invalidate(self, telegram_id: int) -> None:
        self._sessions.pop(telegram_id, None)

    # --- calls ---------------------------------------------------------

    async def get(self, telegram_id: int, path: str) -> Any:
        return await self._authed(telegram_id, "GET", path)

    async def post(self, telegram_id: int, path: str, body: dict | None = None) -> Any:
        return await self._authed(telegram_id, "POST", path, json_body=body or {})

    async def _authed(
        self,
        telegram_id: int,
        method: str,
        path: str,
        *,
        json_body: dict | None = None,
    ) -> Any:
        session = await self.session_for(telegram_id)
        if session is None:
            raise ApiError(401, "not linked")
        try:
            return await self._raw(
                method,
                path,
                json_body=json_body,
                headers={
                    "Authorization": f"Bearer {session.token}",
                    # Section 7 invariant 6 - the channel travels with the write.
                    "x-tasker-channel": "TELEGRAM",
                },
            )
        except ApiError as e:
            if e.status != 401:
                raise
            session = await self.session_for(telegram_id, force=True)
            if session is None:
                raise
            return await self._raw(
                method,
                path,
                json_body=json_body,
                headers={
                    "Authorization": f"Bearer {session.token}",
                    "x-tasker-channel": "TELEGRAM",
                },
            )

    async def _raw(
        self,
        method: str,
        path: str,
        *,
        json_body: dict | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        if self._http is None:
            raise RuntimeError("ApiClient used outside its async context")
        async with self._http.request(
            method, f"{self._base}{path}", json=json_body, headers=headers
        ) as resp:
            text = await resp.text()
            if resp.status == 204 or not text:
                return None
            try:
                data = await resp.json(content_type=None)
            except Exception:
                data = None
            if 200 <= resp.status < 300:
                return data
            message = "Something went wrong."
            if isinstance(data, dict):
                raw = data.get("message")
                # Nest wraps structured refusals one level deeper.
                message = raw.get("message") if isinstance(raw, dict) else (raw or message)
            raise ApiError(resp.status, str(message))

    async def fetch_bytes(self, telegram_id: int, path: str) -> bytes:
        """Raw bytes (proof frames) rather than JSON.

        The bot pulls the image itself and uploads it to Telegram, so proof
        works from a private network - Telegram never needs to reach our host.
        Screenshots show real accounts, so this is an authenticated call like
        any other: the API checks who is asking.
        """
        if self._http is None:
            raise RuntimeError("ApiClient used outside its async context")
        session = await self.session_for(telegram_id)
        if session is None:
            raise ApiError(401, "not linked")
        async with self._http.get(
            f"{self._base}{path}",
            headers={"Authorization": f"Bearer {session.token}"},
        ) as resp:
            if resp.status != 200:
                raise ApiError(resp.status, "Could not load that frame.")
            return await resp.read()
