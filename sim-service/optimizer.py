"""Greedy resource rebalancer across facilities.

Rule: for each resource type (beds, doctors, ambulances), if one facility
is running hotter than UTIL_HIGH (0.85) and another is cooler than UTIL_LOW
(0.60), move 1 unit from the cool facility to the hot one, never dropping
a donor below MIN_CAPACITY (1).

One pass, at most one move per resource type, then the caller re-runs the
simulation with the new configs. We do not iterate against fresh util
numbers here — that keeps the demo deterministic and easy to narrate.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from seed_config import MIN_CAPACITY, UTIL_HIGH, UTIL_LOW
from simpy_model import RESOURCE_TYPES, run_simulation

RESOURCE_SINGULAR = {
    "beds": "bed",
    "doctors": "doctor",
    "ambulances": "ambulance",
}


def propose_rebalance(
    sim_results: dict[str, Any],
    facility_configs: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (new_facility_configs, list_of_moves).

    Each move:
      {
        "resource": "doctors",
        "from_id": "riverside_medical",
        "from_name": "Riverside Medical",
        "to_id": "city_general",
        "to_name": "City General",
        "units": 1,
        "summary": "Moved 1 doctor from Riverside Medical to City General",
        "from_util": 0.43,
        "to_util": 0.93,
      }
    """
    configs = deepcopy(facility_configs)
    cfg_by_id = {c["id"]: c for c in configs}
    facilities = sim_results.get("facilities") or {}
    moves: list[dict[str, Any]] = []

    # Snapshot so a bed move doesn't change who we consider for doctors.
    snapshot = {
        fid: {
            "id": fid,
            "name": body.get("name", fid),
            "utilization": dict(body.get("utilization") or {}),
            "capacity": dict(body.get("capacity") or {}),
        }
        for fid, body in facilities.items()
        if fid in cfg_by_id
    }

    for rtype in RESOURCE_TYPES:
        hottest: tuple[str, float] | None = None
        coolest: tuple[str, float] | None = None
        for fid, body in snapshot.items():
            u = float(body["utilization"].get(rtype, 0.0))
            if hottest is None or u > hottest[1]:
                hottest = (fid, u)
            if coolest is None or u < coolest[1]:
                coolest = (fid, u)

        if hottest is None or coolest is None:
            continue
        if hottest[0] == coolest[0]:
            continue
        if hottest[1] <= UTIL_HIGH or coolest[1] >= UTIL_LOW:
            continue
        if int(cfg_by_id[coolest[0]][rtype]) <= MIN_CAPACITY:
            continue

        donor = cfg_by_id[coolest[0]]
        recv = cfg_by_id[hottest[0]]
        donor[rtype] = int(donor[rtype]) - 1
        recv[rtype] = int(recv[rtype]) + 1
        noun = RESOURCE_SINGULAR[rtype]
        summary = f"Moved 1 {noun} from {donor['name']} to {recv['name']}"
        moves.append(
            {
                "resource": rtype,
                "from_id": donor["id"],
                "from_name": donor["name"],
                "to_id": recv["id"],
                "to_name": recv["name"],
                "units": 1,
                "summary": summary,
                "from_util": round(coolest[1], 4),
                "to_util": round(hottest[1], 4),
            }
        )

    return configs, moves


def simulate_then_rebalance(
    facility_configs: list[dict[str, Any]],
    sim_duration: float,
    seed: int,
    extra_patients: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run → propose moves → re-run. Headline numbers sit at the top."""
    before = run_simulation(
        facility_configs,
        sim_duration=sim_duration,
        seed=seed,
        extra_patients=extra_patients,
    )
    new_configs, moves = propose_rebalance(before, facility_configs)

    if moves:
        after = run_simulation(
            new_configs,
            sim_duration=sim_duration,
            seed=seed,
            extra_patients=extra_patients,
        )
    else:
        after = before
        new_configs = deepcopy(facility_configs)

    wait_before = float(before["overall"]["avg_wait_time_min"])
    wait_after = float(after["overall"]["avg_wait_time_min"])
    sla_before = int(before["overall"]["sla_breaches_red"])
    sla_after = int(after["overall"]["sla_breaches_red"])
    wait_delta = round(wait_before - wait_after, 3)
    wait_pct = (
        round(100.0 * wait_delta / wait_before, 1) if wait_before > 0 else 0.0
    )

    # Hotspot = facility that received a move, else the slowest before.
    hotspot_id = moves[0]["to_id"] if moves else None
    if hotspot_id is None:
        hotspot_id = max(
            before["facilities"],
            key=lambda fid: before["facilities"][fid]["avg_wait_time_min"],
        )
    hot_before = before["facilities"][hotspot_id]
    hot_after = after["facilities"][hotspot_id]
    hot_b = float(hot_before["avg_wait_time_min"])
    hot_a = float(hot_after["avg_wait_time_min"])

    return {
        "headline": {
            "avg_wait_before_min": wait_before,
            "avg_wait_after_min": wait_after,
            "wait_improvement_min": wait_delta,
            "wait_improvement_pct": wait_pct,
            "sla_breaches_before": sla_before,
            "sla_breaches_after": sla_after,
            "sla_improvement": sla_before - sla_after,
            "hotspot_name": hot_before["name"],
            "hotspot_wait_before_min": hot_b,
            "hotspot_wait_after_min": hot_a,
            "hotspot_wait_improvement_min": round(hot_b - hot_a, 3),
            "moves_count": len(moves),
            "rebalance_happened": bool(moves),
        },
        "moves": moves,
        "move_summaries": [m["summary"] for m in moves],
        "before": before,
        "after": after,
        "new_facility_configs": new_configs,
    }
