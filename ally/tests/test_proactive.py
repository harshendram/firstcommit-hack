from datetime import datetime, timedelta

import pytest

from core import clock
from proactive import channel, reminders


async def test_message_created_once_per_related_id(seeded, repo, pushes):
    first = await channel.post("amma", audience="parent", kind="morning", body="सुप्रभात", related_id="morning#d1")
    second = await channel.post("amma", audience="parent", kind="morning", body="again", related_id="morning#d1")
    assert first["created"] and not second["created"]
    assert second["id"] == first["id"]
    assert len(pushes) == 1


async def test_claim_is_single_use_and_adds_turn(seeded, repo, pushes):
    await channel.post("amma", audience="parent", kind="reminder", body="Reminder: BP tablet", related_id="r#1")
    claimed = channel.claim("amma", "parent")
    assert [m["body"] for m in claimed] == ["Reminder: BP tablet"]
    assert channel.claim("amma", "parent") == []
    assert repo.recent_turns("amma")[-1]["text"] == "Reminder: BP tablet"


async def test_audiences_are_isolated_and_expired_messages_not_delivered(seeded, repo, pushes):
    await channel.post("amma", audience="rahul", kind="escalation_ask", body="check on Amma", related_id="e#1")
    assert channel.claim("amma", "priya") == []
    clock.set_now(clock.now() + timedelta(hours=5))
    assert channel.claim("amma", "rahul") == []


def test_time_reminder_rolls_to_tomorrow_when_daily(seeded):
    spec = reminders.ReminderSpec(text="take BP tablet", kind="time", time_hhmm="08:00", recurrence="daily")
    due = reminders.first_due(spec, clock.now())  # now is 09:00
    assert clock.local_date(due) == "2026-09-19"
    with pytest.raises(ValueError):
        reminders.first_due(
            reminders.ReminderSpec(text="call Rahul", kind="time", time_hhmm="08:00", date="today"), clock.now()
        )


async def test_after_wake_reminder_scheduled_on_wake_and_fired(seeded, repo, pushes):
    spec = reminders.ReminderSpec(text="take BP tablet", kind="after_wake", offset_minutes=30, recurrence="daily")
    saved = reminders.create("amma", spec, created_by="test")
    assert saved["due_at"] is None
    wake = clock.now()
    assert reminders.schedule_after_wake("amma", wake) == 1

    assert await reminders.fire_due(wake + timedelta(minutes=10)) == 0
    assert await reminders.fire_due(wake + timedelta(minutes=31)) == 1
    assert pushes[-1]["type"] == "reminder"
    # daily after_wake waits for tomorrow's wake; nothing fires again today
    assert await reminders.fire_due(wake + timedelta(minutes=45)) == 0
    assert repo.get_reminder("amma", saved["id"])["status"] == "active"


async def test_daily_time_reminder_rolls_forward_after_firing(seeded, repo, pushes):
    spec = reminders.ReminderSpec(text="evening tablet", kind="time", time_hhmm="21:00", recurrence="daily")
    saved = reminders.create("amma", spec, created_by="test")
    fire_at = clock.at_local("2026-09-18", "21:01")
    assert await reminders.fire_due(fire_at) == 1
    nxt = repo.get_reminder("amma", saved["id"])
    assert nxt["due_at"] == clock.iso(clock.at_local("2026-09-19", "21:00"))
    assert await reminders.fire_due(fire_at) == 0


def test_confirmation_templates():
    en = reminders.confirmation(
        reminders.ReminderSpec(text="take your BP tablet", kind="after_wake", offset_minutes=30, recurrence="daily"), "en-IN"
    )
    assert en == "Okay — I'll remind you to take your BP tablet 30 minutes after you wake up every day."
    hi = reminders.confirmation(reminders.ReminderSpec(text="दवा लेना", kind="time", time_hhmm="21:00"), "hi-IN")
    assert "21:00" in hi and "दवा लेना" in hi
