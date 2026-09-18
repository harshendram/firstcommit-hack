"""Offline fixtures: moto DynamoDB, a frozen IST clock, no network (push/SFN/LLM are faked per test)."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any

os.environ.update(
    {
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_SESSION_TOKEN": "testing",
        "AWS_DEFAULT_REGION": "us-east-1",
        "AWS_REGION": "us-east-1",
        "ALLY_TABLE": "AllyTest",
        "ALLY_HMAC_SECRET": "test-secret",
        "ALLY_DEVICE_KEY": "device-key",
        "ALLY_STATE_MACHINE_ARN": "",
        "ALLY_VAPID_PRIVATE_KEY": "",
        "ALLY_SECRET_NAME": "",
    }
)

import boto3  # noqa: E402
import pytest  # noqa: E402
from moto import mock_aws  # noqa: E402

from core import clock  # noqa: E402
from policy import consent  # noqa: E402
from store import repo as repo_mod  # noqa: E402


@pytest.fixture(autouse=True)
def aws():
    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="us-east-1")
        table = ddb.create_table(
            TableName="AllyTest",
            KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
            AttributeDefinitions=[
                {"AttributeName": "pk", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
                {"AttributeName": "gsi1pk", "AttributeType": "S"},
                {"AttributeName": "gsi1sk", "AttributeType": "S"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "gsi1",
                    "KeySchema": [
                        {"AttributeName": "gsi1pk", "KeyType": "HASH"},
                        {"AttributeName": "gsi1sk", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        repo_mod.set_repo(repo_mod.Repo(table))
        consent._cache.clear()
        yield
        repo_mod.set_repo(None)


@pytest.fixture(autouse=True)
def frozen_clock():
    clock.set_now(datetime.fromisoformat("2026-09-18T09:00:00+05:30"))
    yield
    clock.set_now(None)


@pytest.fixture
def repo() -> repo_mod.Repo:
    return repo_mod.get_repo()


@pytest.fixture
def seeded(repo) -> dict[str, Any]:
    profile = {
        "name": "Amma",
        "language": "hi-IN",
        "baseline": {"wake_window": ["06:30", "07:45"], "vocal_baseline": {"avg_words_per_min": 105}},
    }
    repo.put_profile("amma", profile)
    for m in [
        {"id": "rahul", "name": "Rahul", "relation": "son", "role": "child", "order": 1},
        {"id": "priya", "name": "Priya", "relation": "daughter", "role": "child", "order": 2},
        {"id": "sunita", "name": "Sunita aunty", "relation": "neighbour", "role": "neighbour", "order": 3},
    ]:
        repo.put_member("amma", m)
    return profile


@pytest.fixture
def pushes(monkeypatch) -> list[dict[str, Any]]:
    sent: list[dict[str, Any]] = []

    async def fake_send(parent_id: str, audience: str, payload: dict[str, Any]) -> dict[str, Any]:
        sent.append({"audience": audience, **payload})
        return {"sent": 1, "failed": 0}

    from notify import push

    monkeypatch.setattr(push, "send", fake_send)
    return sent


class FakeSfn:
    def __init__(self) -> None:
        self.success: list[tuple[str, str]] = []
        self.stopped: list[str] = []
        self.started: list[dict[str, Any]] = []
        self.timed_out_tokens: set[str] = set()

    def send_task_success(self, taskToken: str, output: str) -> None:
        from botocore.exceptions import ClientError

        if taskToken in self.timed_out_tokens:
            raise ClientError({"Error": {"Code": "TaskTimedOut", "Message": "timed out"}}, "SendTaskSuccess")
        self.success.append((taskToken, output))

    def stop_execution(self, executionArn: str, cause: str) -> None:
        self.stopped.append(executionArn)

    def start_execution(self, stateMachineArn: str, name: str, input: str) -> dict[str, Any]:
        self.started.append({"name": name, "input": input})
        return {"executionArn": f"arn:aws:states:us-east-1:1:execution:esc:{name}"}


@pytest.fixture
def sfn(monkeypatch) -> FakeSfn:
    fake = FakeSfn()
    from escalation import service

    monkeypatch.setattr(service, "_sfn", lambda: fake)
    monkeypatch.setattr(service, "STATE_MACHINE_ARN", "arn:aws:states:us-east-1:1:stateMachine:esc")
    return fake
