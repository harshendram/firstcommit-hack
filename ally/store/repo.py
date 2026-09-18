"""Single-table DynamoDB repository. One item per fact; no unbounded blobs.

Errors propagate. The only caught exceptions are conditional-write failures, and only where they
mean "already exists" or "already claimed".
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Iterable

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from config import AWS_REGION, MESSAGE_EXPIRY_MIN, TABLE_NAME
from core import clock
from core.ids import new_id

TURN_TTL_DAYS = 30

GSI_PENDING = "PENDING"
GSI_DUE_REMINDER = "DUE_REMINDER"
GSI_DUE_INVESTIGATION = "DUE_INVESTIGATION"


def _to_ddb(value: Any) -> Any:
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _to_ddb(v) for k, v in value.items() if v is not None}
    if isinstance(value, (list, tuple)):
        return [_to_ddb(v) for v in value if v is not None]
    return value


def _from_ddb(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: _from_ddb(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_from_ddb(v) for v in value]
    if isinstance(value, set):
        return [_from_ddb(v) for v in value]
    return value


def _is_conditional_failure(err: ClientError) -> bool:
    return err.response.get("Error", {}).get("Code") in (
        "ConditionalCheckFailedException",
        "TransactionCanceledException",
    )


def _pk(parent_id: str) -> str:
    return f"PARENT#{parent_id}"


def _strip_keys(item: dict[str, Any] | None) -> dict[str, Any] | None:
    if item is None:
        return None
    return {k: v for k, v in _from_ddb(item).items() if k not in ("pk", "sk", "gsi1pk", "gsi1sk")}


class Repo:
    def __init__(self, table: Any | None = None) -> None:
        self.table = table or boto3.resource("dynamodb", region_name=AWS_REGION).Table(TABLE_NAME)
        self.client = self.table.meta.client

    # ---- generic helpers -------------------------------------------------------------------

    def _put(self, parent_id: str, sk: str, data: dict[str, Any], *, if_absent: bool = False, **extra: Any) -> bool:
        item = {"pk": _pk(parent_id), "sk": sk, **_to_ddb(data), **_to_ddb(extra)}
        kwargs: dict[str, Any] = {"Item": item}
        if if_absent:
            kwargs["ConditionExpression"] = "attribute_not_exists(pk)"
        try:
            self.table.put_item(**kwargs)
            return True
        except ClientError as err:
            if if_absent and _is_conditional_failure(err):
                return False
            raise

    def _get(self, parent_id: str, sk: str, *, consistent: bool = False) -> dict[str, Any] | None:
        resp = self.table.get_item(Key={"pk": _pk(parent_id), "sk": sk}, ConsistentRead=consistent)
        return _strip_keys(resp.get("Item"))

    def _query_prefix(
        self, parent_id: str, prefix: str, *, limit: int | None = None, newest_first: bool = False
    ) -> list[dict[str, Any]]:
        kwargs: dict[str, Any] = {
            "KeyConditionExpression": Key("pk").eq(_pk(parent_id)) & Key("sk").begins_with(prefix),
            "ScanIndexForward": not newest_first,
        }
        items: list[dict[str, Any]] = []
        while True:
            if limit:
                kwargs["Limit"] = limit - len(items)
            resp = self.table.query(**kwargs)
            items.extend(resp.get("Items", []))
            if (limit and len(items) >= limit) or "LastEvaluatedKey" not in resp:
                break
            kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
        return [_strip_keys(i) for i in items]  # type: ignore[misc]

    def _query_between(self, parent_id: str, lo: str, hi: str) -> list[dict[str, Any]]:
        resp = self.table.query(
            KeyConditionExpression=Key("pk").eq(_pk(parent_id)) & Key("sk").between(lo, hi)
        )
        return [_strip_keys(i) for i in resp.get("Items", [])]  # type: ignore[misc]

    def _update(
        self,
        parent_id: str,
        sk: str,
        set_fields: dict[str, Any] | None = None,
        *,
        remove: Iterable[str] = (),
        condition: str | None = None,
        values: dict[str, Any] | None = None,
        return_new: bool = False,
        return_old: bool = False,
    ) -> dict[str, Any] | None:
        names: dict[str, str] = {}
        vals: dict[str, Any] = dict(_to_ddb(values or {}))
        parts: list[str] = []
        for i, (key, value) in enumerate((set_fields or {}).items()):
            if value is None:
                remove = [*remove, key]
                continue
            names[f"#s{i}"] = key
            vals[f":s{i}"] = _to_ddb(value)
            parts.append(f"#s{i} = :s{i}")
        expr = ""
        if parts:
            expr += "SET " + ", ".join(parts)
        removals = list(remove)
        if removals:
            for j, key in enumerate(removals):
                names[f"#r{j}"] = key
            expr += " REMOVE " + ", ".join(f"#r{j}" for j in range(len(removals)))
        kwargs: dict[str, Any] = {
            "Key": {"pk": _pk(parent_id), "sk": sk},
            "UpdateExpression": expr.strip(),
        }
        if condition:
            kwargs["ConditionExpression"] = condition
            if "#status" in condition:
                names["#status"] = "status"
        if names:
            kwargs["ExpressionAttributeNames"] = names
        if vals:
            kwargs["ExpressionAttributeValues"] = vals
        if return_new:
            kwargs["ReturnValues"] = "ALL_NEW"
        elif return_old:
            kwargs["ReturnValues"] = "ALL_OLD"
        resp = self.table.update_item(**kwargs)
        return _strip_keys(resp.get("Attributes")) if (return_new or return_old) else None

    def _delete(self, parent_id: str, sk: str) -> None:
        self.table.delete_item(Key={"pk": _pk(parent_id), "sk": sk})

    # ---- profile & roster -----------------------------------------------------------------

    def get_profile(self, parent_id: str) -> dict[str, Any] | None:
        return self._get(parent_id, "PROFILE")

    def put_profile(self, parent_id: str, profile: dict[str, Any]) -> None:
        self._put(parent_id, "PROFILE", {**profile, "parent_id": parent_id})

    def list_members(self, parent_id: str) -> list[dict[str, Any]]:
        members = self._query_prefix(parent_id, "MEMBER#")
        return sorted(members, key=lambda m: m.get("order", 99))

    def get_member(self, parent_id: str, member_id: str) -> dict[str, Any] | None:
        return self._get(parent_id, f"MEMBER#{member_id}")

    def put_member(self, parent_id: str, member: dict[str, Any]) -> None:
        self._put(parent_id, f"MEMBER#{member['id']}", member)

    # ---- day summaries --------------------------------------------------------------------

    def get_day(self, parent_id: str, day: str) -> dict[str, Any]:
        return self._get(parent_id, f"DAY#{day}") or {"date": day}

    def update_day(self, parent_id: str, day: str, **fields: Any) -> dict[str, Any]:
        return self._update(parent_id, f"DAY#{day}", {"date": day, **fields}, return_new=True) or {}

    def set_day_if_absent(self, parent_id: str, day: str, field: str, value: Any) -> bool:
        """Atomically set a field only once per day (e.g. first wake)."""
        try:
            self.table.update_item(
                Key={"pk": _pk(parent_id), "sk": f"DAY#{day}"},
                UpdateExpression="SET #d = :d, #f = :v",
                ConditionExpression="attribute_not_exists(#f)",
                ExpressionAttributeNames={"#d": "date", "#f": field},
                ExpressionAttributeValues={":d": day, ":v": _to_ddb(value)},
            )
            return True
        except ClientError as err:
            if _is_conditional_failure(err):
                return False
            raise

    def increment_day(self, parent_id: str, day: str, field: str, *, limit: int | None = None) -> int:
        kwargs: dict[str, Any] = {
            "Key": {"pk": _pk(parent_id), "sk": f"DAY#{day}"},
            "UpdateExpression": "SET #d = :d ADD #f :one",
            "ExpressionAttributeNames": {"#d": "date", "#f": field},
            "ExpressionAttributeValues": {":d": day, ":one": 1},
            "ReturnValues": "UPDATED_NEW",
        }
        if limit is not None:
            kwargs["ConditionExpression"] = "attribute_not_exists(#f) OR #f < :limit"
            kwargs["ExpressionAttributeValues"][":limit"] = limit
        try:
            resp = self.table.update_item(**kwargs)
        except ClientError as err:
            if limit is not None and _is_conditional_failure(err):
                return -1
            raise
        return int(resp["Attributes"][field])

    def list_days(self, parent_id: str, first: str, last: str) -> list[dict[str, Any]]:
        return self._query_between(parent_id, f"DAY#{first}", f"DAY#{last}")

    # ---- turns & signals ------------------------------------------------------------------

    def add_turn(self, parent_id: str, speaker: str, text: str, **extra: Any) -> dict[str, Any]:
        at = clock.now()
        turn = {
            "id": new_id(),
            "speaker": speaker,
            "text": text,
            "at": clock.iso(at),
            "ttl": clock.epoch(at + timedelta(days=TURN_TTL_DAYS)),
            **extra,
        }
        self._put(parent_id, f"TURN#{turn['at']}#{turn['id']}", turn)
        return turn

    def recent_turns(self, parent_id: str, limit: int = 12) -> list[dict[str, Any]]:
        now_epoch = clock.epoch(clock.now())
        rows = self._query_prefix(parent_id, "TURN#", limit=limit, newest_first=True)
        return list(reversed([r for r in rows if int(r.get("ttl", now_epoch + 1)) > now_epoch]))

    def add_signal(self, parent_id: str, kind: str, **data: Any) -> dict[str, Any]:
        at = clock.now()
        signal = {
            "id": new_id(),
            "kind": kind,
            "at": clock.iso(at),
            "ttl": clock.epoch(at + timedelta(days=TURN_TTL_DAYS)),
            **data,
        }
        self._put(parent_id, f"SIGNAL#{signal['at']}#{signal['id']}", signal)
        return signal

    def signals_between(self, parent_id: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
        return self._query_between(parent_id, f"SIGNAL#{clock.iso(start)}", f"SIGNAL#{clock.iso(end)}~")

    # ---- dedupe + proactive messages ------------------------------------------------------

    def claim_dedupe(self, parent_id: str, key: str, value: str = "1") -> bool:
        return self._put(parent_id, f"DEDUPE#{key}", {"value": value, "at": clock.iso(clock.now())}, if_absent=True)

    def create_message(
        self,
        parent_id: str,
        *,
        audience: str,
        kind: str,
        title: str,
        body: str,
        related_id: str,
        data: dict[str, Any] | None = None,
        expires_min: int = MESSAGE_EXPIRY_MIN,
    ) -> tuple[dict[str, Any], bool]:
        """Create a message exactly once per related_id. Returns (message, created)."""
        at = clock.now()
        msg = {
            "id": new_id(),
            "audience": audience,
            "kind": kind,
            "title": title,
            "body": body,
            "related_id": related_id,
            "data": data or {},
            "status": "pending",
            "created_at": clock.iso(at),
            "expires_at": clock.iso(at + timedelta(minutes=expires_min)),
            "ttl": clock.epoch(at + timedelta(days=TURN_TTL_DAYS)),
        }
        pk = _pk(parent_id)
        try:
            self.client.transact_write_items(
                TransactItems=[
                    {
                        "Put": {
                            "TableName": self.table.name,
                            "Item": _to_ddb({"pk": pk, "sk": f"DEDUPE#msg#{related_id}", "msg_id": msg["id"]}),
                            "ConditionExpression": "attribute_not_exists(pk)",
                        }
                    },
                    {
                        "Put": {
                            "TableName": self.table.name,
                            "Item": _to_ddb(
                                {
                                    "pk": pk,
                                    "sk": f"MSG#{msg['id']}",
                                    "gsi1pk": f"{GSI_PENDING}#{parent_id}#{audience}",
                                    "gsi1sk": msg["created_at"],
                                    **_to_ddb(msg),
                                }
                            ),
                        }
                    },
                ]
            )
            return msg, True
        except ClientError as err:
            if not _is_conditional_failure(err):
                raise
        existing = self._get(parent_id, f"DEDUPE#msg#{related_id}", consistent=True) or {}
        found = self._get(parent_id, f"MSG#{existing.get('msg_id')}", consistent=True)
        return found or msg, False

    def claim_pending_messages(self, parent_id: str, audience: str) -> list[dict[str, Any]]:
        resp = self.table.query(
            IndexName="gsi1",
            KeyConditionExpression=Key("gsi1pk").eq(f"{GSI_PENDING}#{parent_id}#{audience}"),
        )
        now_iso = clock.iso(clock.now())
        claimed: list[dict[str, Any]] = []
        for raw in resp.get("Items", []):
            try:
                item = self._update(
                    parent_id,
                    raw["sk"],
                    {"status": "delivered", "delivered_at": now_iso},
                    remove=["gsi1pk", "gsi1sk"],
                    condition="#status = :pending AND expires_at > :now",
                    values={":pending": "pending", ":now": now_iso},
                    return_new=True,
                )
            except ClientError as err:
                if _is_conditional_failure(err):
                    if raw.get("expires_at", "") <= now_iso:
                        self._update(parent_id, raw["sk"], {"status": "expired"}, remove=["gsi1pk", "gsi1sk"])
                    continue
                raise
            if item:
                claimed.append(item)
        return sorted(claimed, key=lambda m: m["created_at"])

    def expire_pending_messages(self, parent_id: str, related_prefix: str) -> int:
        """Retire questions that no longer need an answer (e.g. after an all-clear)."""
        retired = 0
        for row in self._query_prefix(parent_id, "MSG#", newest_first=True, limit=200):
            if row.get("status") != "pending" or not str(row.get("related_id", "")).startswith(related_prefix):
                continue
            self._update(
                parent_id,
                f"MSG#{row['id']}",
                {"status": "superseded"},
                remove=["gsi1pk", "gsi1sk"],
                condition="#status = :pending",
                values={":pending": "pending"},
            )
            retired += 1
        return retired

    def get_message(self, parent_id: str, msg_id: str) -> dict[str, Any] | None:
        return self._get(parent_id, f"MSG#{msg_id}")

    def ack_message(self, parent_id: str, msg_id: str) -> None:
        self._update(parent_id, f"MSG#{msg_id}", {"status": "acknowledged", "acked_at": clock.iso(clock.now())})

    def messages_since(self, parent_id: str, since_iso: str, *, kind: str | None = None) -> list[dict[str, Any]]:
        rows = self._query_prefix(parent_id, "MSG#", newest_first=True, limit=200)
        return [r for r in rows if r.get("created_at", "") >= since_iso and (kind is None or r.get("kind") == kind)]

    # ---- reminders ------------------------------------------------------------------------

    def put_reminder(self, parent_id: str, reminder: dict[str, Any]) -> None:
        extra: dict[str, Any] = {}
        if reminder.get("status") == "active" and reminder.get("due_at"):
            extra = {"gsi1pk": GSI_DUE_REMINDER, "gsi1sk": f"{reminder['due_at']}#{parent_id}"}
        self._put(parent_id, f"REMINDER#{reminder['id']}", {**reminder, "parent_id": parent_id}, **extra)

    def list_reminders(self, parent_id: str, *, status: str | None = "active") -> list[dict[str, Any]]:
        rows = self._query_prefix(parent_id, "REMINDER#")
        return [r for r in rows if status is None or r.get("status") == status]

    def get_reminder(self, parent_id: str, reminder_id: str) -> dict[str, Any] | None:
        return self._get(parent_id, f"REMINDER#{reminder_id}")

    def due_reminders(self, until: datetime) -> list[dict[str, Any]]:
        resp = self.table.query(
            IndexName="gsi1",
            KeyConditionExpression=Key("gsi1pk").eq(GSI_DUE_REMINDER) & Key("gsi1sk").lte(f"{clock.iso(until)}#~"),
        )
        return [_strip_keys(i) for i in resp.get("Items", [])]  # type: ignore[misc]

    # ---- consent rules & audit ------------------------------------------------------------

    def put_consent(self, parent_id: str, rule: dict[str, Any]) -> None:
        self._put(parent_id, f"CONSENT#{rule['id']}", rule)

    def get_consent(self, parent_id: str, rule_id: str) -> dict[str, Any] | None:
        return self._get(parent_id, f"CONSENT#{rule_id}")

    def list_consents(self, parent_id: str, *, statuses: tuple[str, ...] = ("active",)) -> list[dict[str, Any]]:
        return [r for r in self._query_prefix(parent_id, "CONSENT#") if r.get("status") in statuses]

    def update_consent(self, parent_id: str, rule_id: str, **fields: Any) -> None:
        self._update(parent_id, f"CONSENT#{rule_id}", fields)

    def put_audit(self, parent_id: str, row: dict[str, Any]) -> str:
        sk = f"AUDIT#{row['at']}#{row['id']}"
        self._put(parent_id, sk, row)
        return sk

    def update_audit(self, parent_id: str, sk: str, **fields: Any) -> None:
        self._update(parent_id, sk, fields)

    def list_audit(self, parent_id: str, limit: int = 100) -> list[dict[str, Any]]:
        return self._query_prefix(parent_id, "AUDIT#", limit=limit, newest_first=True)

    # ---- alerts & investigations ----------------------------------------------------------

    def put_alert(self, parent_id: str, alert: dict[str, Any]) -> None:
        self._put(parent_id, f"ALERT#{alert['created_at']}#{alert['id']}", alert)

    def update_alert(self, parent_id: str, alert: dict[str, Any], **fields: Any) -> dict[str, Any]:
        return self._update(
            parent_id, f"ALERT#{alert['created_at']}#{alert['id']}", fields, return_new=True
        ) or {}

    def list_alerts(self, parent_id: str, limit: int = 30) -> list[dict[str, Any]]:
        return self._query_prefix(parent_id, "ALERT#", limit=limit, newest_first=True)

    def get_alert(self, parent_id: str, alert_id: str) -> dict[str, Any] | None:
        for alert in self.list_alerts(parent_id, limit=100):
            if alert["id"] == alert_id:
                return alert
        return None

    def open_alert(self, parent_id: str) -> dict[str, Any] | None:
        for alert in self.list_alerts(parent_id, limit=10):
            if alert.get("status") in ("investigating", "escalating"):
                return alert
        return None

    def put_investigation(self, parent_id: str, inv: dict[str, Any]) -> None:
        extra: dict[str, Any] = {}
        if inv.get("status") == "open":
            extra = {"gsi1pk": GSI_DUE_INVESTIGATION, "gsi1sk": f"{inv['due_at']}#{parent_id}"}
        self._put(parent_id, f"INVESTIGATION#{inv['id']}", {**inv, "parent_id": parent_id}, **extra)

    def close_investigation(self, parent_id: str, inv_id: str, status: str) -> bool:
        """Close exactly once; returns False if it was already closed."""
        try:
            self._update(
                parent_id,
                f"INVESTIGATION#{inv_id}",
                {"status": status, "closed_at": clock.iso(clock.now())},
                remove=["gsi1pk", "gsi1sk"],
                condition="#status = :open",
                values={":open": "open"},
            )
            return True
        except ClientError as err:
            if _is_conditional_failure(err):
                return False
            raise

    def open_investigation(self, parent_id: str) -> dict[str, Any] | None:
        rows = self._query_prefix(parent_id, "INVESTIGATION#", newest_first=True, limit=5)
        return next((r for r in rows if r.get("status") == "open"), None)

    def due_investigations(self, until: datetime) -> list[dict[str, Any]]:
        resp = self.table.query(
            IndexName="gsi1",
            KeyConditionExpression=Key("gsi1pk").eq(GSI_DUE_INVESTIGATION)
            & Key("gsi1sk").lte(f"{clock.iso(until)}#~"),
        )
        return [_strip_keys(i) for i in resp.get("Items", [])]  # type: ignore[misc]

    # ---- escalations ----------------------------------------------------------------------

    def acquire_escalation_lock(self, parent_id: str, esc_id: str, stale_after_h: int = 6) -> bool:
        """One open escalation per parent. A lock older than `stale_after_h` (nobody marked arrival) is reclaimable."""
        now = clock.now()
        try:
            self.table.put_item(
                Item={"pk": _pk(parent_id), "sk": "ESC_ACTIVE", "esc_id": esc_id, "at": clock.iso(now)},
                ConditionExpression="attribute_not_exists(pk) OR #at < :stale",
                ExpressionAttributeNames={"#at": "at"},
                ExpressionAttributeValues={":stale": clock.iso(now - timedelta(hours=stale_after_h))},
            )
            return True
        except ClientError as err:
            if _is_conditional_failure(err):
                return False
            raise

    def active_escalation_id(self, parent_id: str) -> str | None:
        row = self._get(parent_id, "ESC_ACTIVE", consistent=True)
        return row.get("esc_id") if row else None

    def release_escalation_lock(self, parent_id: str, esc_id: str) -> None:
        try:
            self.table.delete_item(
                Key={"pk": _pk(parent_id), "sk": "ESC_ACTIVE"},
                ConditionExpression=Attr("esc_id").eq(esc_id),
            )
        except ClientError as err:
            if not _is_conditional_failure(err):
                raise

    def put_escalation(self, parent_id: str, esc: dict[str, Any]) -> None:
        self._put(parent_id, f"ESC#{esc['id']}", esc)

    def get_escalation(self, parent_id: str, esc_id: str, *, consistent: bool = True) -> dict[str, Any] | None:
        return self._get(parent_id, f"ESC#{esc_id}", consistent=consistent)

    def update_escalation(self, parent_id: str, esc_id: str, **fields: Any) -> dict[str, Any]:
        return self._update(parent_id, f"ESC#{esc_id}", fields, return_new=True) or {}

    def consume_escalation_token(self, parent_id: str, esc_id: str, token_version: int) -> dict[str, Any] | None:
        """Single-use: bump the version only if it still matches.

        Returns the item as it was *before* consumption (so the caller still has the task token),
        or None if the token was already used or superseded.
        """
        try:
            return self._update(
                parent_id,
                f"ESC#{esc_id}",
                {"token_version": token_version + 1, "task_token": None},
                condition="token_version = :v AND attribute_exists(task_token)",
                values={":v": token_version},
                return_old=True,
            )
        except ClientError as err:
            if _is_conditional_failure(err):
                return None
            raise

    def append_escalation_event(self, parent_id: str, esc_id: str, event: dict[str, Any]) -> None:
        self.table.update_item(
            Key={"pk": _pk(parent_id), "sk": f"ESC#{esc_id}"},
            UpdateExpression="SET #t = list_append(if_not_exists(#t, :empty), :e)",
            ExpressionAttributeNames={"#t": "timeline"},
            ExpressionAttributeValues={":e": [_to_ddb({"at": clock.iso(clock.now()), **event})], ":empty": []},
        )

    def list_escalations(self, parent_id: str, limit: int = 10) -> list[dict[str, Any]]:
        rows = self._query_prefix(parent_id, "ESC#")
        return sorted(rows, key=lambda e: e.get("created_at", ""), reverse=True)[:limit]

    # ---- push subscriptions ---------------------------------------------------------------

    def put_push_subscription(self, parent_id: str, audience: str, endpoint_hash: str, sub: dict[str, Any]) -> None:
        self._put(parent_id, f"PUSH#{audience}#{endpoint_hash}", {"audience": audience, "subscription": sub})

    def list_push_subscriptions(self, parent_id: str, audience: str) -> list[dict[str, Any]]:
        return [
            {**row, "hash": row.get("hash")}
            for row in self._query_prefix_with_sk(parent_id, f"PUSH#{audience}#")
        ]

    def delete_push_subscription(self, parent_id: str, audience: str, endpoint_hash: str) -> None:
        self._delete(parent_id, f"PUSH#{audience}#{endpoint_hash}")

    def _query_prefix_with_sk(self, parent_id: str, prefix: str) -> list[dict[str, Any]]:
        resp = self.table.query(
            KeyConditionExpression=Key("pk").eq(_pk(parent_id)) & Key("sk").begins_with(prefix)
        )
        return [{**_from_ddb(i), "hash": i["sk"].rsplit("#", 1)[-1]} for i in resp.get("Items", [])]


_repo: Repo | None = None


def get_repo() -> Repo:
    global _repo
    if _repo is None:
        _repo = Repo()
    return _repo


def set_repo(repo: Repo | None) -> None:
    """Tests only."""
    global _repo
    _repo = repo
