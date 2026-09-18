"""Reminders: fixed-time ("at 9 pm") or relative to waking ("30 minutes after I wake up")."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from core import clock
from core.ids import new_id
from proactive import channel
from store.repo import get_repo


class ReminderSpec(BaseModel):
    text: str = Field(min_length=2, max_length=160, description="What to remind her about, e.g. 'take your BP tablet'.")
    kind: Literal["time", "after_wake"]
    time_hhmm: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    date: Literal["today", "tomorrow"] | None = None
    offset_minutes: int | None = Field(default=None, ge=0, le=720)
    recurrence: Literal["none", "daily"] = "none"

    @model_validator(mode="after")
    def _shape(self) -> "ReminderSpec":
        if self.kind == "time" and not self.time_hhmm:
            raise ValueError("time reminders need time_hhmm")
        if self.kind == "after_wake" and self.offset_minutes is None:
            self.offset_minutes = 0
        return self


def first_due(spec: ReminderSpec, now: datetime) -> datetime | None:
    if spec.kind == "after_wake":
        return None
    day = clock.local_date(now + timedelta(days=1 if spec.date == "tomorrow" else 0))
    due = clock.at_local(day, spec.time_hhmm or "09:00")
    if due <= now:
        if spec.date == "today" and spec.recurrence == "none":
            raise ValueError("that time has already passed today")
        due += timedelta(days=1)
    return due


def create(parent_id: str, spec: ReminderSpec, *, created_by: str) -> dict[str, Any]:
    now = clock.now()
    due = first_due(spec, now)
    reminder = {
        "id": new_id(),
        **spec.model_dump(),
        "status": "active",
        "due_at": clock.iso(due) if due else None,
        "created_by": created_by,
        "created_at": clock.iso(now),
    }
    repo = get_repo()
    if spec.kind == "after_wake":
        day = repo.get_day(parent_id, clock.local_date(now))
        if day.get("wake_at"):  # she's already up today: schedule from today's wake
            wake = clock.parse_iso(day["wake_at"])
            candidate = wake + timedelta(minutes=spec.offset_minutes or 0)
            if candidate > now:
                reminder["due_at"] = clock.iso(candidate)
    repo.put_reminder(parent_id, reminder)
    return reminder


def confirmation(spec: ReminderSpec, language: str) -> str:
    """Template confirmation — no second model call."""
    hi = language == "hi-IN"
    if spec.kind == "after_wake":
        mins = spec.offset_minutes or 0
        when_en = "when you wake up" if mins == 0 else f"{mins} minutes after you wake up"
        when_hi = "आपके उठते ही" if mins == 0 else f"आपके उठने के {mins} मिनट बाद"
    else:
        t = datetime.strptime(spec.time_hhmm or "09:00", "%H:%M")
        when_en = t.strftime("%I:%M %p").lstrip("0")
        when_hi = f"{spec.time_hhmm} बजे"
        if spec.date == "tomorrow":
            when_en, when_hi = f"tomorrow at {when_en}", f"कल {when_hi}"
        else:
            when_en = f"at {when_en}"
    daily_en = " every day" if spec.recurrence == "daily" else ""
    daily_hi = " रोज़" if spec.recurrence == "daily" else ""
    if hi:
        return f"ठीक है — मैं{daily_hi} {when_hi} आपको याद दिलाऊँगी: {spec.text}।"
    return f"Okay — I'll remind you to {spec.text} {when_en}{daily_en}."


def schedule_after_wake(parent_id: str, wake: datetime) -> int:
    repo = get_repo()
    count = 0
    for reminder in repo.list_reminders(parent_id):
        if reminder.get("kind") != "after_wake":
            continue
        due = wake + timedelta(minutes=int(reminder.get("offset_minutes") or 0))
        repo.put_reminder(parent_id, {**reminder, "due_at": clock.iso(due), "wake_day": clock.local_date(wake)})
        count += 1
    return count


async def fire_due(now: datetime) -> int:
    repo = get_repo()
    fired = 0
    for reminder in repo.due_reminders(now):
        parent_id = reminder["parent_id"]
        profile = repo.get_profile(parent_id) or {}
        body = _reminder_text(reminder["text"], profile.get("language", "en-IN"))
        await channel.post(
            parent_id,
            audience="parent",
            kind="reminder",
            body=body,
            related_id=f"reminder#{reminder['id']}#{reminder['due_at']}",
            data={"reminder_id": reminder["id"]},
        )
        fired += 1
        if reminder.get("recurrence") == "daily" and reminder.get("kind") == "time":
            next_due = clock.parse_iso(reminder["due_at"]) + timedelta(days=1)
            while next_due <= now:
                next_due += timedelta(days=1)
            repo.put_reminder(parent_id, {**reminder, "due_at": clock.iso(next_due)})
        elif reminder.get("recurrence") == "daily":  # after_wake: waits for tomorrow's wake
            repo.put_reminder(parent_id, {**reminder, "due_at": None})
        else:
            repo.put_reminder(parent_id, {**reminder, "status": "done", "due_at": None})
    return fired


def _reminder_text(text: str, language: str) -> str:
    return f"याद दिलाना: {text}" if language == "hi-IN" else f"Reminder: {text}"


def mark_done(parent_id: str, reminder_id: str) -> None:
    get_repo().increment_day(parent_id, clock.local_date(), "reminders_done")
