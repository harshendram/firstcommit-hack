"""Proactive message channel: Ally speaks first (morning check-in, reminders, questions, updates).

Each message is created at most once per `related_id` and claimed by at most one device.
Push is a best-effort wake-up; the message itself lives in DynamoDB until claimed or expired.
"""

from __future__ import annotations

from typing import Any

from notify import push
from store.repo import get_repo

PUSH_TITLES = {
    "morning": "Good morning",
    "reminder": "A gentle reminder",
    "investigation": "Ally is checking in",
    "neighbour_question": "Ally has a question",
    "family_note": "A note from family",
    "escalation_ask": "Can you check on Amma?",
    "escalation_update": "Update about Amma",
    "all_clear": "Amma is okay",
}


async def post(
    parent_id: str,
    *,
    audience: str,
    kind: str,
    body: str,
    related_id: str,
    title: str | None = None,
    data: dict[str, Any] | None = None,
    push_extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    msg, created = get_repo().create_message(
        parent_id,
        audience=audience,
        kind=kind,
        title=title or PUSH_TITLES.get(kind, "Ally"),
        body=body,
        related_id=related_id,
        data=data,
    )
    delivery: dict[str, Any] = {"skipped": "duplicate"}
    if created:
        delivery = await push.send(
            parent_id,
            audience,
            {"type": kind, "msg_id": msg["id"], "title": msg["title"], "body": body[:240], **(push_extra or {})},
        )
    return {**msg, "created": created, "delivery": delivery}


def claim(parent_id: str, audience: str) -> list[dict[str, Any]]:
    repo = get_repo()
    messages = repo.claim_pending_messages(parent_id, audience)
    if audience == "parent":
        for msg in messages:
            repo.add_turn(parent_id, "ally", msg["body"], agent=f"proactive:{msg['kind']}", msg_id=msg["id"])
    return messages


def acknowledge(parent_id: str, msg_id: str) -> None:
    get_repo().ack_message(parent_id, msg_id)
