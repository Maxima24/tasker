"""/new: task intake from the phone (PRD section 15).

Every step is a button except naming a new task type. Nothing is created until
the final Create tap, so an intake abandoned halfway leaves no orphan DRAFT on
the board.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from aiogram import Bot, F, Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from .. import views
from ..clients.api import ApiClient, ApiError
from ..config import Settings
from ..nav import INTAKE, decode_step
from .common import Linked, begin, redraw, show, timed_out

FLOW = "intake"


class Intake(StatesGroup):
    type = State()
    type_name = State()
    category = State()
    due = State()
    dispatch = State()
    person = State()
    confirm = State()
    # Between a tap that writes and the API answering. A second tap on the same
    # button lands here and is ignored, so one intake never makes two of anything.
    working = State()


def _match(items: list, suffix: str) -> dict | None:
    """Buttons carry an id suffix to fit the 64-byte cap; resolve it on tap."""
    return next((i for i in items if suffix and i["id"].endswith(suffix)), None)


def router(api: ApiClient, settings: Settings, linked: Linked) -> Router:
    r = Router(name="intake")

    async def start(message: Message, state: FSMContext, bot: Bot, user_id: int, *, edit: bool) -> None:
        try:
            types = await api.get(user_id, "/task-types")
        except ApiError as e:
            if edit:
                await redraw(message, views.refused(e.message))
            else:
                text, kb = views.refused(e.message)
                await message.answer(text, reply_markup=kb)
            return
        await begin(bot, message.chat.id, state, FLOW)
        await state.set_state(Intake.type)
        await show(message, state, views.intake_types(types), edit=edit)

    # --- entry ---------------------------------------------------------------

    @r.message(Command("new"))
    async def new_cmd(message: Message, state: FSMContext, bot: Bot) -> None:
        if not message.from_user:
            return
        if await linked(message.from_user.id) is None:
            return
        await start(message, state, bot, message.from_user.id, edit=False)

    # --- taps ------------------------------------------------------------------

    @r.callback_query(F.data.startswith(f"{INTAKE}:"))
    async def on_tap(cq: CallbackQuery, state: FSMContext, bot: Bot) -> None:
        await cq.answer()
        if not cq.from_user or not cq.data or not isinstance(cq.message, Message):
            return
        if await linked(cq.from_user.id) is None:
            return
        user_id = cq.from_user.id
        message = cq.message
        name, arg = decode_step(cq.data)

        if name == "start":
            await start(message, state, bot, user_id, edit=True)
            return

        data = await state.get_data()
        if data.get("flow") != FLOW or data.get("prompt_id") != message.message_id:
            await redraw(message, views.flow_closed(FLOW))
            return
        current = await state.get_state()
        if current == Intake.working.state:
            return
        if timed_out(data):
            await state.clear()
            await redraw(message, views.flow_timed_out(FLOW))
            return

        if name == "stop":
            await state.clear()
            await redraw(message, views.flow_stopped(FLOW))
        elif name == "type" and current == Intake.type.state:
            await pick_type(message, state, user_id, arg)
        elif name == "newtype" and current == Intake.type.state:
            await state.set_state(Intake.type_name)
            await show(message, state, views.intake_type_name(), edit=True)
        elif name == "cat" and current == Intake.category.state and arg in ("STANDARD", "CRITICAL"):
            await create_type(message, state, user_id, arg)
        elif name == "due" and current == Intake.due.state:
            hours = int(arg) if arg.isdigit() else 0
            if hours not in dict(views.DUE_WINDOWS):
                return
            await state.update_data(hours=hours)
            await state.set_state(Intake.dispatch)
            await show(message, state, views.intake_dispatch(data["type_name"], hours), edit=True)
        elif name == "open" and current in (Intake.dispatch.state, Intake.person.state):
            await state.update_data(tasker_id=None, tasker_name=None)
            await state.set_state(Intake.confirm)
            await show(
                message, state, views.intake_confirm(data["type_name"], data["hours"], None), edit=True
            )
        elif name == "one" and current == Intake.dispatch.state:
            await list_people(message, state, user_id)
        elif name == "who" and current == Intake.person.state:
            await pick_person(message, state, user_id, arg)
        elif name == "go" and current == Intake.confirm.state:
            await create_task(message, state, user_id)
        # Anything else is a second tap on a step already taken. Ignore it.

    async def pick_type(message: Message, state: FSMContext, user_id: int, suffix: str) -> None:
        try:
            chosen = _match(await api.get(user_id, "/task-types"), suffix)
        except ApiError as e:
            await state.clear()
            await redraw(message, views.refused(e.message))
            return
        if chosen is None:
            await state.clear()
            await redraw(message, views.stale("That task type no longer exists."))
            return
        spec = views.ready_spec(chosen)
        if spec is None:
            await state.clear()
            await redraw(
                message, views.intake_not_ready(chosen["name"], settings.console_url, created=False)
            )
            return
        await state.update_data(type_id=chosen["id"], type_name=chosen["name"], spec_id=spec["id"])
        await state.set_state(Intake.due)
        await show(message, state, views.intake_due(chosen["name"]), edit=True)

    async def create_type(message: Message, state: FSMContext, user_id: int, category: str) -> None:
        data = await state.get_data()
        await state.set_state(Intake.working)
        try:
            created = await api.post(
                user_id, "/task-types", {"name": data.get("new_type_name", ""), "category": category}
            )
        except ApiError as e:
            # Usually a name already in use. Ask for another rather than restart.
            await state.set_state(Intake.type_name)
            await show(message, state, views.intake_type_name(e.message), edit=True)
            return
        await state.clear()
        await redraw(
            message, views.intake_not_ready(created["name"], settings.console_url, created=True)
        )

    async def list_people(message: Message, state: FSMContext, user_id: int) -> None:
        data = await state.get_data()
        try:
            # Certification is per spec VERSION: only people who watched this
            # version's tutorial can be handed the task directly.
            pool = await api.get(user_id, f"/taskers?certifiedFor={quote(data['spec_id'], safe='')}")
        except ApiError as e:
            await state.clear()
            await redraw(message, views.refused(e.message))
            return
        await state.set_state(Intake.person)
        await show(message, state, views.intake_people(data["type_name"], data["hours"], pool), edit=True)

    async def pick_person(message: Message, state: FSMContext, user_id: int, suffix: str) -> None:
        data = await state.get_data()
        try:
            pool = await api.get(user_id, f"/taskers?certifiedFor={quote(data['spec_id'], safe='')}")
        except ApiError as e:
            await state.clear()
            await redraw(message, views.refused(e.message))
            return
        person = _match(pool.get("ranked", []) + pool.get("unranked", []), suffix)
        if person is None:
            # They lost the certification between the list and the tap.
            await show(message, state, views.intake_people(data["type_name"], data["hours"], pool), edit=True)
            return
        await state.update_data(tasker_id=person["id"], tasker_name=person["name"])
        await state.set_state(Intake.confirm)
        await show(
            message, state, views.intake_confirm(data["type_name"], data["hours"], person["name"]), edit=True
        )

    async def create_task(message: Message, state: FSMContext, user_id: int) -> None:
        data = await state.get_data()
        await state.set_state(Intake.working)
        hours = data["hours"]
        due_at = datetime.now(timezone.utc) + timedelta(hours=hours)
        try:
            task = await api.post(
                user_id,
                "/tasks",
                {"taskTypeId": data["type_id"], "dueAt": due_at.isoformat().replace("+00:00", "Z")},
            )
        except ApiError as e:
            await state.clear()
            await redraw(message, views.intake_failed(e.message, None, False, settings.console_url))
            return

        try:
            if data.get("tasker_id"):
                await api.post(user_id, f"/tasks/{task['id']}/assign", {"taskerId": data["tasker_id"]})
            else:
                await api.post(user_id, f"/tasks/{task['id']}/open")
        except ApiError as e:
            # The task exists but went nowhere. Cancel it rather than leave a
            # draft on the board that nobody asked for.
            cancelled = True
            try:
                await api.post(
                    user_id, f"/tasks/{task['id']}/cancel", {"reason": "Could not be sent out from Telegram"}
                )
            except ApiError:
                cancelled = False
            await state.clear()
            await redraw(
                message, views.intake_failed(e.message, task["code"], cancelled, settings.console_url)
            )
            return

        await state.clear()
        await redraw(
            message,
            views.intake_done(task, data["type_name"], hours, data.get("tasker_name"), settings.console_url),
        )

    # --- typed answers -------------------------------------------------------

    @r.message(Intake.type_name)
    async def on_type_name(message: Message, state: FSMContext) -> None:
        if not message.from_user:
            return
        if await linked(message.from_user.id) is None:
            await state.clear()
            return
        data = await state.get_data()
        if timed_out(data):
            await state.clear()
            text, _ = views.flow_timed_out(FLOW)
            await message.answer(text)
            return
        name = (message.text or "").strip()
        if not name:
            await show(message, state, views.intake_type_name(), edit=False)
            return
        await state.update_data(new_type_name=name)
        await state.set_state(Intake.category)
        await show(message, state, views.intake_category(name), edit=False)

    @r.message(
        StateFilter(
            Intake.type,
            Intake.category,
            Intake.due,
            Intake.dispatch,
            Intake.person,
            Intake.confirm,
            Intake.working,
        )
    )
    async def on_stray_text(message: Message, state: FSMContext) -> None:
        """Typing where a button is expected. Without this the catch-all would
        answer with a list of commands, which reads as if the flow had ended."""
        if not message.from_user:
            return
        if await linked(message.from_user.id) is None:
            await state.clear()
            return
        if timed_out(await state.get_data()):
            await state.clear()
            text, _ = views.flow_timed_out(FLOW)
            await message.answer(text)
            return
        text, _ = views.flow_use_buttons()
        await message.answer(text)

    return r
