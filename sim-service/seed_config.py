"""Default facility configs for the Rakshak resource-allocation demo.

The numbers are intentionally IMBALANCED across hospitals, not uniformly busy:
City General is the hotspot, Riverside has slack, St. Mary's sits in the middle.
Overall system load lands roughly in the 60–75% band, but City's doctors run
hot enough (>85%) and Riverside's run slack enough (<60%) that the greedy
rebalancer has a clean "move 1 doctor" story.

TWEAK THESE IF THE DEMO ISN'T DRAMATIC ENOUGH
---------------------------------------------
- CITY_GENERAL["arrival_rate"]:   raise (e.g. 0.145 → 0.16) to explode waits
                                  at the hotspot. Lower if the sim looks chaotic.
- RIVERSIDE_MEDICAL["arrival_rate"]: lower (e.g. 0.08 → 0.06) to free more slack
                                  for the donor facility.
- MEAN_DOCTOR_MIN:                raise (22 → 26) to push doctor utilization up
                                  without adding more arrivals.
- RED_SHARE:                      raise (0.18 → 0.28) to create more SLA
                                  breaches (red wait > 15 min) for the headline.
- CITY_GENERAL["doctors"]:        drop 3 → 2 for a more extreme before-state
                                  (keep >= 1; optimizer floor is 1).
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

# --- mix / service-time knobs (shared across facilities) --------------------

# Priority mix. Lower SimPy priority number = served first.
# 0 = red (critical), 1 = amber, 2 = green.
RED_SHARE = 0.18
AMBER_SHARE = 0.27
# remainder is green

# Mean service times in minutes. Doctors are the scarce bottleneck on purpose.
MEAN_AMBULANCE_MIN = 18.0  # red patients only (scoop-and-run)
MEAN_DOCTOR_MIN = 22.0  # treatment once a doctor is seized
MEAN_BED_HOLD_MIN = 8.0  # observation after the doctor releases

# SLA: a red patient waiting longer than this (minutes) is a breach.
RED_SLA_MIN = 15.0

# Optimizer thresholds (mirrored in optimizer.py; kept here for the README).
UTIL_HIGH = 0.85
UTIL_LOW = 0.60
MIN_CAPACITY = 1

# --- facilities -------------------------------------------------------------

CITY_GENERAL: dict[str, Any] = {
    "id": "city_general",
    "name": "City General",
    "beds": 10,
    "doctors": 3,
    "ambulances": 2,
    # ~9.1 arrivals/hour. With 3 doctors @ 22 min mean → ρ ≈ 1.10 (over capacity).
    # After the rebalancer adds a 4th doctor, ρ ≈ 0.83 — waits collapse.
    "arrival_rate": 0.150,
}

RIVERSIDE_MEDICAL: dict[str, Any] = {
    "id": "riverside_medical",
    "name": "Riverside Medical",
    "beds": 15,
    "doctors": 4,
    "ambulances": 2,
    # ~4.7 arrivals/hour. With 4 doctors @ 22 min mean → ρ ≈ 0.43 (slack).
    "arrival_rate": 0.078,
}

ST_MARYS: dict[str, Any] = {
    "id": "st_marys",
    "name": "St. Mary's",
    "beds": 8,
    "doctors": 2,
    "ambulances": 1,
    # ~3.6 arrivals/hour. With 2 doctors @ 22 min mean → ρ ≈ 0.66 (middle).
    "arrival_rate": 0.060,
}

DEFAULT_FACILITIES: list[dict[str, Any]] = [
    CITY_GENERAL,
    RIVERSIDE_MEDICAL,
    ST_MARYS,
]

DEFAULT_SIM_DURATION_MIN = 480  # 8-hour shift
DEFAULT_SEED = 42
# /simulate/inject-patient still finishes in well under a second at 480 min;
# we need the full shift so utilization is stable enough to trigger a rebalance.
INJECT_WINDOW_MIN = 480
INJECT_AT_MIN = 180.0  # land mid-shift, after queues have formed


def default_facility_configs() -> list[dict[str, Any]]:
    """Deep copy so callers can mutate without contaminating the module defaults."""
    return deepcopy(DEFAULT_FACILITIES)


def facility_by_id(
    configs: list[dict[str, Any]], facility_id: str
) -> dict[str, Any] | None:
    needle = facility_id.strip().lower()
    for cfg in configs:
        if str(cfg["id"]).lower() == needle or str(cfg["name"]).lower() == needle:
            return cfg
    return None
