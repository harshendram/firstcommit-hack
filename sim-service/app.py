"""Rakshak resource-allocation simulator — FastAPI microservice.

Self-contained. The existing Express backend / Next.js app call this over HTTP.
Run from this folder:

    uvicorn app:app --reload --port 8001
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from optimizer import propose_rebalance, simulate_then_rebalance
from seed_config import (
    DEFAULT_SEED,
    DEFAULT_SIM_DURATION_MIN,
    INJECT_AT_MIN,
    INJECT_WINDOW_MIN,
    default_facility_configs,
    facility_by_id,
)
from simpy_model import find_patient, run_simulation

PRIORITY_LABEL = {0: "red", 1: "amber", 2: "green"}

app = FastAPI(
    title="Rakshak Sim Service",
    description="SimPy resource-allocation simulation + greedy rebalance across 3 facilities.",
    version="1.0.0",
)

_DEFAULT_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "https://rakshak-alpha-lake.vercel.app",
]
_extra = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_DEFAULT_ORIGINS + _extra,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SimulateRequest(BaseModel):
    facility_configs: list[dict[str, Any]] | None = None
    arrival_rates: dict[str, float] | None = Field(
        default=None,
        description="Optional map of facility_id → arrivals per minute. Overrides configs.",
    )
    sim_duration: float | None = Field(default=None, ge=1, le=10_000)
    seed: int | None = Field(default=None)


class InjectRequest(BaseModel):
    facility_id: str = Field(description="Facility id or name, e.g. city_general")
    priority: int = Field(default=0, ge=0, le=2, description="0=red, 1=amber, 2=green")
    seed: int | None = None
    sim_duration: float | None = Field(default=None, ge=1, le=10_000)
    facility_configs: list[dict[str, Any]] | None = None
    arrival_rates: dict[str, float] | None = None


def _merge_configs(
    facility_configs: list[dict[str, Any]] | None,
    arrival_rates: dict[str, float] | None,
) -> list[dict[str, Any]]:
    configs = facility_configs or default_facility_configs()
    # Always copy so we never mutate module defaults.
    merged: list[dict[str, Any]] = []
    for cfg in configs:
        row = dict(cfg)
        for key in ("beds", "doctors", "ambulances"):
            row[key] = int(row[key])
        row["arrival_rate"] = float(row["arrival_rate"])
        merged.append(row)
    if arrival_rates:
        by_id = {c["id"]: c for c in merged}
        for key, rate in arrival_rates.items():
            hit = by_id.get(key) or facility_by_id(merged, key)
            if hit is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown facility in arrival_rates: {key}",
                )
            hit["arrival_rate"] = float(rate)
    return merged


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "rakshak-sim"}


@app.get("/config")
def get_config() -> dict[str, Any]:
    """Default facilities — useful when wiring the dashboard."""
    return {
        "facilities": default_facility_configs(),
        "sim_duration_min": DEFAULT_SIM_DURATION_MIN,
        "seed": DEFAULT_SEED,
        "inject_window_min": INJECT_WINDOW_MIN,
    }


@app.post("/simulate")
def simulate(body: SimulateRequest | None = None) -> dict[str, Any]:
    body = body or SimulateRequest()
    configs = _merge_configs(body.facility_configs, body.arrival_rates)
    duration = body.sim_duration or DEFAULT_SIM_DURATION_MIN
    seed = DEFAULT_SEED if body.seed is None else int(body.seed)
    return run_simulation(configs, sim_duration=duration, seed=seed)


@app.post("/simulate/rebalance")
def simulate_rebalance(body: SimulateRequest | None = None) -> dict[str, Any]:
    body = body or SimulateRequest()
    configs = _merge_configs(body.facility_configs, body.arrival_rates)
    duration = body.sim_duration or DEFAULT_SIM_DURATION_MIN
    seed = DEFAULT_SEED if body.seed is None else int(body.seed)
    return simulate_then_rebalance(configs, sim_duration=duration, seed=seed)


@app.post("/simulate/inject-patient")
def inject_patient(body: InjectRequest) -> dict[str, Any]:
    """Drop one patient onto a short run and report wait + whether we rebalance.

    This is the endpoint the existing dashboard should call when a real
    patient's risk goes red (fall / AI check-in escalation).
    """
    configs = _merge_configs(body.facility_configs, body.arrival_rates)
    fac = facility_by_id(configs, body.facility_id)
    if fac is None:
        known = ", ".join(c["id"] for c in configs)
        raise HTTPException(
            status_code=400,
            detail=f"Unknown facility_id {body.facility_id!r}. Known: {known}",
        )

    duration = body.sim_duration or INJECT_WINDOW_MIN
    seed = DEFAULT_SEED if body.seed is None else int(body.seed)
    # Land mid-shift so the extra patient hits a formed queue.
    at = (
        INJECT_AT_MIN
        if duration > INJECT_AT_MIN + 60
        else max(0.0, duration * 0.25)
    )
    extra = [
        {
            "facility_id": fac["id"],
            "priority": int(body.priority),
            "at_min": at,
            "patient_id": "injected-1",
        }
    ]

    before = run_simulation(
        configs, sim_duration=duration, seed=seed, extra_patients=extra
    )
    rec = find_patient(before, "injected-1")
    fac_before = before["facilities"][fac["id"]]

    new_configs, moves = propose_rebalance(before, configs)
    rebalance_triggered = bool(moves)

    if rebalance_triggered:
        after = run_simulation(
            new_configs, sim_duration=duration, seed=seed, extra_patients=extra
        )
        rec_after = find_patient(after, "injected-1")
        fac_after = after["facilities"][fac["id"]]
    else:
        after = before
        rec_after = rec
        fac_after = fac_before

    def _wait(record: dict[str, Any] | None) -> float | None:
        if record is None:
            return None
        if record.get("wait_time") is not None:
            return record["wait_time"]
        return round(max(0.0, duration - float(record["arrival_time"])), 3)

    patient_wait_before = _wait(rec)
    patient_wait_after = _wait(rec_after)
    # Dashboard-facing waits are the facility averages — that's the number
    # that moves when we rebalance, and the one a clinician can act on.
    old_wait = fac_before["avg_wait_time_min"]
    new_wait = fac_after["avg_wait_time_min"]

    move_made = moves[0]["summary"] if moves else "no rebalance needed"
    pri_label = PRIORITY_LABEL[int(body.priority)]

    return {
        "headline": {
            "facility_name": fac["name"],
            "priority_label": pri_label,
            "old_wait_min": old_wait,
            "new_wait_min": new_wait,
            "move_made": move_made,
            "rebalance_triggered": rebalance_triggered,
        },
        "facility_id": fac["id"],
        "facility_name": fac["name"],
        "priority": int(body.priority),
        "priority_label": pri_label,
        "injected_patient_id": "injected-1",
        "injected_at_min": at,
        "sim_duration_min": duration,
        "seed": seed,
        "wait_time_min": old_wait,
        "wait_time_after_rebalance_min": new_wait,
        "injected_patient_wait_min": patient_wait_before,
        "injected_patient_wait_after_min": patient_wait_after,
        "facility_avg_wait_before_min": fac_before["avg_wait_time_min"],
        "facility_avg_wait_after_min": fac_after["avg_wait_time_min"],
        "rebalance_triggered": rebalance_triggered,
        "move_made": move_made,
        "moves": moves,
        "injected_patient": rec,
        "before": before,
        "after": after if rebalance_triggered else None,
        "new_facility_configs": new_configs if rebalance_triggered else configs,
    }
