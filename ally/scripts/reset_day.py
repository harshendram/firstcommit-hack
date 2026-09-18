"""Clear today's live items so a rehearsal starts from a clean morning.

Keeps the profile, roster, consent rules, simulated history and the audit log. Removes today's
alerts, investigations, escalations, messages, signals, conversation turns and dedupe guards.

    python scripts/reset_day.py            # dry run
    python scripts/reset_day.py --yes
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from boto3.dynamodb.conditions import Key  # noqa: E402

from config import PARENT_ID  # noqa: E402
from core import clock  # noqa: E402
from store.repo import _pk, get_repo  # noqa: E402

CLEAR_PREFIXES = ("ALERT#", "INVESTIGATION#", "ESC#", "ESC_ACTIVE", "MSG#", "SIGNAL#", "TURN#", "DEDUPE#")


def main(parent_id: str, apply: bool) -> None:
    repo = get_repo()
    resp = repo.table.query(KeyConditionExpression=Key("pk").eq(_pk(parent_id)))
    doomed = [i["sk"] for i in resp.get("Items", []) if i["sk"].startswith(CLEAR_PREFIXES)]
    today = repo.get_day(parent_id, clock.local_date())
    print(f"{len(doomed)} operational items; today = { {k: today.get(k) for k in ('wake_at', 'checkin_at', 'im_okay_at')} }")
    if not apply:
        print("dry run — pass --yes to clear")
        return
    with repo.table.batch_writer() as batch:
        for sk in doomed:
            batch.delete_item(Key={"pk": _pk(parent_id), "sk": sk})
    repo.table.delete_item(Key={"pk": _pk(parent_id), "sk": f"DAY#{clock.local_date()}"})
    print("cleared; profile, family, consent rules, audit log and simulated history kept")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--parent", default=PARENT_ID)
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    main(args.parent, args.yes)
