from __future__ import annotations

import re

from ulid import ULID

_SAFE = re.compile(r"^[a-z0-9_]{1,40}$")


def new_id() -> str:
    return str(ULID()).lower()


def safe_entity_id(value: str) -> str:
    """Entity ids are embedded in Cedar text; only allow a strict alphabet."""
    if not _SAFE.match(value or ""):
        raise ValueError(f"invalid entity id: {value!r}")
    return value
