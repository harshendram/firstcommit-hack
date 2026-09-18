"""Seed Amma's profile, family roster and 13 days of *simulated* history (dated relative to today).

Optionally creates Cognito users for the family and the parent tablet.

    python scripts/seed.py                       # profile + roster + history
    python scripts/seed.py --cognito --password 'Temp#Pass123'   # also create/refresh Cognito users
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from config import AWS_REGION, COGNITO_USER_POOL_ID  # noqa: E402
from core import clock  # noqa: E402
from store.repo import get_repo  # noqa: E402

SEED = ROOT / "seed" / "amma.json"


def seed_data() -> None:
    data = json.loads(SEED.read_text(encoding="utf-8"))
    parent_id = data["parent_id"]
    repo = get_repo()
    repo.put_profile(parent_id, data["profile"])
    for member in data["members"]:
        repo.put_member(parent_id, member)
    template = data["history_template"]
    for offset, day_t in enumerate(template):
        day = clock.days_ago(len(template) - offset)
        repo.update_day(
            parent_id,
            day,
            wake_at=clock.iso(clock.at_local(day, day_t["wake"])),
            checkin_at=clock.iso(clock.at_local(day, day_t["checkin"])),
            mood=day_t["mood"],
            reminders_done=day_t["reminders_done"],
            notes=day_t["notes"],
            simulated=True,
            score=0.05,
        )
    print(f"seeded {parent_id}: profile, {len(data['members'])} members, {len(template)} simulated days")


def seed_cognito(password: str) -> None:
    import boto3

    if not COGNITO_USER_POOL_ID:
        raise SystemExit("COGNITO_USER_POOL_ID is not set")
    data = json.loads(SEED.read_text(encoding="utf-8"))
    cognito = boto3.client("cognito-idp", region_name=AWS_REGION)
    users = [("amma", "parent", "parent")] + [(m["id"], m["id"], "family") for m in data["members"]]
    for username, member_id, group in users:
        attrs = [
            {"Name": "custom:parent_id", "Value": data["parent_id"]},
            {"Name": "custom:member_id", "Value": member_id},
        ]
        try:
            cognito.admin_create_user(
                UserPoolId=COGNITO_USER_POOL_ID,
                Username=username,
                UserAttributes=attrs,
                MessageAction="SUPPRESS",
            )
        except cognito.exceptions.UsernameExistsException:
            cognito.admin_update_user_attributes(UserPoolId=COGNITO_USER_POOL_ID, Username=username, UserAttributes=attrs)
        cognito.admin_set_user_password(UserPoolId=COGNITO_USER_POOL_ID, Username=username, Password=password, Permanent=True)
        cognito.admin_add_user_to_group(UserPoolId=COGNITO_USER_POOL_ID, Username=username, GroupName=group)
        print(f"cognito user {username} → {group}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cognito", action="store_true")
    parser.add_argument("--password", default="")
    args = parser.parse_args()
    seed_data()
    if args.cognito:
        if not args.password:
            raise SystemExit("--password is required with --cognito")
        seed_cognito(args.password)
