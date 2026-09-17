"""/addaccount and "Update login details": loading an account from the phone.

One field per message, because that is how people type on a phone. Login
details are the only secrets this bot ever handles, so the flow is built around
leaving them nowhere:

  - Answers live in process memory only (see flows.common), and are wiped when
    the flow saves, is cancelled, or expires.
  - A message holding a login detail is deleted from the chat as soon as it has
    been read, and the next prompt says so.
  - The summary shows login details as "set", never as values.
"""
from __future__ import annotations

from urllib.parse import quote

from aiogram import Bot, F, Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from .. import views
from ..clients.api import ApiClient, ApiError
from ..config import Settings
from ..nav import ACCOUNT_FORM, decode_step, encode
from .common import Linked, begin, delete_quietly, redraw, show, timed_out

FLOW = "account"


class AccountForm(StatesGroup):
    ref = State()
    platform = State()
    login_url = State()
    username = State()
    email = State()
    password = State()
    two_factor = State()
    notes = State()
    confirm = State()
    # Between Save and the API answering. A second tap on Save lands here and
    # is ignored, so one form never creates two accounts.
    saving = State()


STATE_FOR = {
    "ref": AccountForm.ref,
    "platform": AccountForm.platform,
    "loginUrl": AccountForm.login_url,
    "username": AccountForm.username,
    "email": AccountForm.email,
    "password": AccountForm.password,
    "twoFactor": AccountForm.two_factor,
    "notes": AccountForm.notes,
}
KEY_FOR = {s.state: key for key, s in STATE_FOR.items()}

CREDENTIAL_KEYS = ("username", "email", "password", "twoFactor")

# Which step an API refusal points at, matched on the API's own plain-English
# wording. A message that matches nothing falls back to the summary with Save
# still available, so a reworded message degrades to "try again", not a crash.
_ERROR_STEP = (
    ("already an account", "ref"),
    ("reference", "ref"),
    ("sign-in link", "loginUrl"),
    ("platform", "platform"),
    ("notes", "notes"),
    ("login details", "username"),
    ("username or email", "username"),
)


def _step_for(message: str, mode: str) -> str | None:
    lowered = message.lower()
    for needle, key in _ERROR_STEP:
        if needle in lowered and key in _keys(mode):
            return key
    return None


def _keys(mode: str) -> list[str]:
    """Update mode has no reference step: an account's reference never changes."""
    return [k for k in views.FORM_KEYS if mode == "create" or k != "ref"]


def router(api: ApiClient, settings: Settings, linked: Linked) -> Router:
    r = Router(name="account_form")

    async def ask(
        message: Message,
        state: FSMContext,
        key: str,
        *,
        edit: bool,
        removed: bool | None = None,
        error: str = "",
    ) -> None:
        data = await state.get_data()
        keys = _keys(data["mode"])
        # Step numbers mean nothing when jumping back to fix one answer.
        number = None if data.get("fixing") else keys.index(key) + 1
        await state.set_state(STATE_FOR[key])
        view = views.account_form_step(
            key, data, number=number, total=len(keys), removed=removed, error=error
        )
        await show(message, state, view, edit=edit)

    async def summary(
        message: Message,
        state: FSMContext,
        *,
        edit: bool,
        removed: bool | None = None,
        error: str = "",
    ) -> None:
        await state.update_data(fixing=False)
        await state.set_state(AccountForm.confirm)
        data = await state.get_data()
        await show(
            message, state, views.account_form_summary(data, removed=removed, error=error), edit=edit
        )

    async def advance(
        message: Message, state: FSMContext, key: str, *, edit: bool, removed: bool | None = None
    ) -> None:
        """The next step - or straight back to the summary when fixing one answer."""
        data = await state.get_data()
        keys = _keys(data["mode"])
        if data.get("fixing") or key == keys[-1]:
            await summary(message, state, edit=edit, removed=removed)
        else:
            await ask(message, state, keys[keys.index(key) + 1], edit=edit, removed=removed)

    async def start(
        message: Message, state: FSMContext, bot: Bot, *, edit: bool, account: dict | None = None
    ) -> None:
        if account is None:
            await begin(bot, message.chat.id, state, FLOW, mode="create", answers={})
        else:
            # Only what is safe to show goes into the flow: the API never sends
            # login values on this route, just the names of the fields on file.
            await begin(
                bot,
                message.chat.id,
                state,
                FLOW,
                mode="update",
                account_id=account["id"],
                account_ref=account["ref"],
                current={
                    "platform": account.get("platform"),
                    "loginUrl": account.get("loginUrl"),
                    "notes": account.get("notes"),
                    "fields": account.get("fields") or [],
                },
                answers={},
            )
        await ask(message, state, _keys("update" if account else "create")[0], edit=edit)

    async def taken_ref(user_id: int, ref: str) -> str | None:
        """Catch a reference already in use at step one, before the admin types
        any login details, rather than at Save. The API still checks at Save."""
        try:
            found = await api.get(user_id, f"/accounts/{quote(ref, safe='')}")
        except ApiError:
            return None
        return found.get("ref") if isinstance(found, dict) else None

    async def save(message: Message, state: FSMContext, user_id: int) -> None:
        data = await state.get_data()
        await state.set_state(AccountForm.saving)
        mode = data["mode"]
        answers = data.get("answers") or {}

        # Only what was typed. In update mode a missing field means "keep it";
        # the API merges rather than replaces.
        body: dict = {k: answers[k] for k in ("platform", "loginUrl", "notes") if answers.get(k)}
        credentials = {k: answers[k] for k in CREDENTIAL_KEYS if answers.get(k)}
        if mode == "create":
            body["ref"] = answers.get("ref", "")
            body["credentials"] = credentials
            path = "/accounts"
        else:
            if credentials:
                body["credentials"] = credentials
            path = f"/accounts/{quote(data['account_id'], safe='')}"

        try:
            account = await api.post(user_id, path, body)
        except ApiError as e:
            if e.status == 401:
                # Unlinked mid-flow: keep nothing, say nothing.
                await state.clear()
                return
            # Keep the answers and send the admin back to the one step the API
            # objected to. Retyping eight fields for one typo loses people.
            key = _step_for(e.message, mode)
            if key:
                await state.update_data(fixing=True)
                await ask(message, state, key, edit=True, error=e.message)
            else:
                await summary(message, state, edit=True, error=e.message)
            return

        await state.clear()
        await redraw(message, views.account_saved(account, mode, settings.console_url))

    # --- entry ---------------------------------------------------------------

    @r.message(Command("addaccount"))
    async def add_cmd(message: Message, state: FSMContext, bot: Bot) -> None:
        if not message.from_user:
            return
        if await linked(message.from_user.id) is None:
            return
        await start(message, state, bot, edit=False)

    # --- taps ------------------------------------------------------------------

    @r.callback_query(F.data.startswith(f"{ACCOUNT_FORM}:"))
    async def on_tap(cq: CallbackQuery, state: FSMContext, bot: Bot) -> None:
        await cq.answer()
        if not cq.from_user or not cq.data or not isinstance(cq.message, Message):
            return
        if await linked(cq.from_user.id) is None:
            return
        user_id = cq.from_user.id
        message = cq.message
        name, arg = decode_step(cq.data)

        if name == "add":
            await start(message, state, bot, edit=True)
            return
        if name == "edit":
            try:
                account = await api.get(user_id, f"/accounts/{quote(arg, safe='')}")
            except ApiError as e:
                await redraw(message, views.refused(e.message, encode("accounts", "", 1)))
                return
            await start(message, state, bot, edit=True, account=account)
            return

        data = await state.get_data()
        if data.get("flow") != FLOW or data.get("prompt_id") != message.message_id:
            await redraw(message, views.flow_closed(FLOW))
            return
        current = await state.get_state()
        if current == AccountForm.saving.state:
            return
        if timed_out(data):
            await state.clear()
            await redraw(message, views.flow_timed_out(FLOW))
            return

        if name == "stop":
            await state.clear()
            await redraw(message, views.flow_stopped(FLOW))
        elif name == "skip" and arg != "ref" and KEY_FOR.get(current or "") == arg:
            # Skip in create mode and Keep in update mode both mean "no answer
            # for this field", including dropping one typed earlier.
            answers = dict(data.get("answers") or {})
            answers.pop(arg, None)
            await state.update_data(answers=answers)
            await advance(message, state, arg, edit=True)
        elif name == "fix" and current == AccountForm.confirm.state and arg in _keys(data["mode"]):
            await state.update_data(fixing=True)
            await ask(message, state, arg, edit=True)
        elif name == "save" and current == AccountForm.confirm.state:
            await save(message, state, user_id)
        # Anything else is a second tap on a step already taken. Ignore it.

    # --- typed answers -------------------------------------------------------

    @r.message(StateFilter(*STATE_FOR.values()))
    async def on_answer(message: Message, state: FSMContext) -> None:
        if not message.from_user:
            return
        key = KEY_FOR.get(await state.get_state() or "")
        if key is None:
            return
        text = (message.text or "").strip()
        removed = None
        if key in views.FORM_SECRET:
            # Off the screen first - before any network call that could stall
            # or fail and leave it sitting there. Anything sent at this step is
            # treated as secret, a photo of a code sheet included.
            removed = await delete_quietly(message)

        if await linked(message.from_user.id) is None:
            await state.clear()
            return
        data = await state.get_data()
        if timed_out(data):
            await state.clear()
            reply, _ = views.flow_timed_out(FLOW, removed)
            await message.answer(reply)
            return

        if not text:
            await ask(
                message, state, key, edit=False, removed=removed,
                error="I can only read typed text here. Please type it as a message.",
            )
            return

        if key == "ref" and data["mode"] == "create":
            existing = await taken_ref(message.from_user.id, text)
            if existing:
                await ask(
                    message, state, "ref", edit=False,
                    error=f"There is already an account called {existing}. Send a different reference.",
                )
                return

        answers = dict(data.get("answers") or {})
        answers[key] = text
        await state.update_data(answers=answers)
        await advance(message, state, key, edit=False, removed=removed)

    @r.message(StateFilter(AccountForm.confirm, AccountForm.saving))
    async def on_stray_text(message: Message, state: FSMContext) -> None:
        """Typing at the summary. Without this the catch-all would answer with a
        list of commands, which reads as if the form had gone away."""
        if not message.from_user:
            return
        if await linked(message.from_user.id) is None:
            await state.clear()
            return
        if timed_out(await state.get_data()):
            await state.clear()
            reply, _ = views.flow_timed_out(FLOW)
            await message.answer(reply)
            return
        reply, _ = views.flow_use_buttons()
        await message.answer(reply)

    return r
