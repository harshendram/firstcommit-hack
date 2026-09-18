"""Names render in the script of the language being spoken."""

from __future__ import annotations

from typing import Any


def display(person: dict[str, Any] | None, language: str, fallback: str = "") -> str:
    if not person:
        return fallback
    if language == "hi-IN" and person.get("name_hi"):
        return str(person["name_hi"])
    return str(person.get("name") or fallback)
