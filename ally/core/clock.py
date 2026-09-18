"""All day boundaries are in the parent's timezone; all stored timestamps are UTC ISO strings."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from config import TZ

ZONE = ZoneInfo(TZ)
_override: datetime | None = None


def set_now(dt: datetime | None) -> None:
    """Tests only: freeze the clock."""
    global _override
    _override = dt


def now() -> datetime:
    return (_override or datetime.now(timezone.utc)).astimezone(ZONE)


def iso(dt: datetime) -> str:
    """UTC, second precision, lexicographically sortable."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(ZONE)


def local_date(dt: datetime | None = None) -> str:
    return (dt or now()).astimezone(ZONE).date().isoformat()


def at_local(day: str | date, hhmm: str) -> datetime:
    d = date.fromisoformat(day) if isinstance(day, str) else day
    hh, mm = (int(x) for x in hhmm.split(":"))
    return datetime.combine(d, time(hh, mm), tzinfo=ZONE)


def hhmm(dt: datetime) -> str:
    return dt.astimezone(ZONE).strftime("%H:%M")


def epoch(dt: datetime) -> int:
    return int(dt.timestamp())


def days_ago(n: int, dt: datetime | None = None) -> str:
    return local_date((dt or now()) - timedelta(days=n))
