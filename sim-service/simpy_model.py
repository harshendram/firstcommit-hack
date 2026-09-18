"""Discrete-event simulation of 3 healthcare facilities (SimPy + queueing).

Each facility has three PriorityResources: beds, doctors, ambulances.
Patients arrive as a Poisson process. Lower priority number is served first
(0 = red/critical, 1 = amber, 2 = green).

Patient path
------------
1. (red only) seize an ambulance, hold for transport, release
2. seize a bed (held through treatment + a short observation)
3. seize a doctor, hold for treatment, release doctor
4. hold remaining bed observation, release bed

Wait time = minutes from arrival until a doctor actually starts treatment.
That is the number we put on the dashboard.

All per-patient random draws (priority, service times) happen at spawn,
before any queueing, so the same seed + same arrival rates produce the
same patients when we re-run after a rebalance — only capacities change.
"""

from __future__ import annotations

import math
import random
from typing import Any

import simpy

from seed_config import (
    AMBER_SHARE,
    DEFAULT_SEED,
    DEFAULT_SIM_DURATION_MIN,
    MEAN_AMBULANCE_MIN,
    MEAN_BED_HOLD_MIN,
    MEAN_DOCTOR_MIN,
    RED_SHARE,
    RED_SLA_MIN,
    default_facility_configs,
)

PRIORITY_LABEL = {0: "red", 1: "amber", 2: "green"}
RESOURCE_TYPES = ("beds", "doctors", "ambulances")


def _exp_mean(mean_min: float) -> float:
    """Draw from Exp(mean). Clamp so a 0.0 never stalls the event loop."""
    if mean_min <= 0:
        return 0.1
    return max(0.1, random.expovariate(1.0 / mean_min))


def _sample_priority() -> int:
    u = random.random()
    if u < RED_SHARE:
        return 0
    if u < RED_SHARE + AMBER_SHARE:
        return 1
    return 2


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(math.ceil(p / 100.0 * len(ordered)) - 1)))
    return round(ordered[idx], 3)


class Facility:
    def __init__(self, env: simpy.Environment, cfg: dict[str, Any]):
        self.id: str = cfg["id"]
        self.name: str = cfg["name"]
        self.arrival_rate: float = float(cfg["arrival_rate"])
        self.capacity = {
            "beds": int(cfg["beds"]),
            "doctors": int(cfg["doctors"]),
            "ambulances": int(cfg["ambulances"]),
        }
        self.beds = simpy.PriorityResource(env, capacity=self.capacity["beds"])
        self.doctors = simpy.PriorityResource(env, capacity=self.capacity["doctors"])
        self.ambulances = simpy.PriorityResource(
            env, capacity=self.capacity["ambulances"]
        )
        self.busy_min = {r: 0.0 for r in RESOURCE_TYPES}
        self.records: list[dict[str, Any]] = []
        self._seq = 0

    def next_id(self, prefix: str = "") -> str:
        self._seq += 1
        tag = prefix or self.id
        return f"{tag}-{self._seq:04d}"

    def add_busy(self, resource: str, minutes: float) -> None:
        if minutes > 0:
            self.busy_min[resource] += minutes


def _patient(
    env: simpy.Environment,
    facility: Facility,
    patient_id: str,
    priority: int,
    t_amb: float,
    t_doc: float,
    t_bed: float,
    sim_duration: float,
) -> simpy.events.Process:
    arrival = env.now
    rec: dict[str, Any] = {
        "facility_id": facility.id,
        "facility_name": facility.name,
        "patient_id": patient_id,
        "priority": priority,
        "priority_label": PRIORITY_LABEL[priority],
        "arrival_time": round(arrival, 3),
        "wait_time": None,
        "service_start": None,
        "service_end": None,
        "completed": False,
    }
    # Append immediately so patients still in queue at T=sim_duration are counted.
    facility.records.append(rec)

    queue_wait = 0.0

    try:
        # --- ambulance (red / critical only) --------------------------------
        if priority == 0:
            with facility.ambulances.request(priority=priority) as req:
                t_req = env.now
                yield req
                queue_wait += env.now - t_req
                hold = min(t_amb, max(0.0, sim_duration - env.now))
                busy_start = env.now
                yield env.timeout(hold)
                facility.add_busy("ambulances", env.now - busy_start)

        # --- bed, then doctor (bed is held through treatment) ---------------
        with facility.beds.request(priority=priority) as bed_req:
            t_req = env.now
            yield bed_req
            queue_wait += env.now - t_req
            bed_start = env.now
            with facility.doctors.request(priority=priority) as doc_req:
                t_req = env.now
                yield doc_req
                queue_wait += env.now - t_req
                service_start = env.now
                rec["wait_time"] = round(queue_wait, 3)
                rec["service_start"] = round(service_start, 3)
                doc_hold = min(t_doc, max(0.0, sim_duration - env.now))
                yield env.timeout(doc_hold)
                facility.add_busy("doctors", env.now - service_start)

            obs = min(t_bed, max(0.0, sim_duration - env.now))
            yield env.timeout(obs)
            facility.add_busy("beds", env.now - bed_start)
            rec["service_end"] = round(env.now, 3)
            rec["completed"] = True
    except simpy.Interrupt:
        pass


def _arrivals(env: simpy.Environment, facility: Facility, sim_duration: float):
    rate = facility.arrival_rate
    if rate <= 0:
        return
    while True:
        gap = random.expovariate(rate)
        yield env.timeout(gap)
        if env.now >= sim_duration:
            return
        pid = facility.next_id()
        priority = _sample_priority()
        env.process(
            _patient(
                env,
                facility,
                pid,
                priority,
                _exp_mean(MEAN_AMBULANCE_MIN),
                _exp_mean(MEAN_DOCTOR_MIN),
                _exp_mean(MEAN_BED_HOLD_MIN),
                sim_duration,
            )
        )


def _inject(
    env: simpy.Environment,
    facility: Facility,
    sim_duration: float,
    at: float,
    priority: int,
    patient_id: str,
):
    if at > 0:
        yield env.timeout(at)
    env.process(
        _patient(
            env,
            facility,
            patient_id,
            priority,
            _exp_mean(MEAN_AMBULANCE_MIN),
            _exp_mean(MEAN_DOCTOR_MIN),
            _exp_mean(MEAN_BED_HOLD_MIN),
            sim_duration,
        )
    )


def _avg(xs: list[float]) -> float:
    return round(sum(xs) / len(xs), 3) if xs else 0.0


def _summarize(
    facilities: list[Facility],
    sim_duration: float,
    seed: int,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fac_out: dict[str, Any] = {}
    all_waits: list[float] = []
    sla_total = 0
    red_completed = 0
    completed_total = 0

    def _effective_wait(r: dict[str, Any]) -> float:
        if r["wait_time"] is not None:
            return float(r["wait_time"])
        # Still queued when the clock stopped — count time already spent waiting.
        return round(max(0.0, sim_duration - float(r["arrival_time"])), 3)

    for fac in facilities:
        recs = fac.records
        done = [r for r in recs if r["completed"]]
        waits = [_effective_wait(r) for r in recs]
        by_pri: dict[str, list[float]] = {"red": [], "amber": [], "green": []}
        sla = 0
        red_here = 0
        for r in recs:
            w = _effective_wait(r)
            by_pri[r["priority_label"]].append(w)
            if r["priority"] == 0:
                red_here += 1
                if w > RED_SLA_MIN:
                    sla += 1
        red_completed += red_here

        sla_total += sla
        completed_total += len(done)
        all_waits.extend(waits)

        util = {}
        for rtype in RESOURCE_TYPES:
            cap = fac.capacity[rtype]
            denom = cap * sim_duration
            util[rtype] = round(min(1.0, fac.busy_min[rtype] / denom), 4) if denom else 0.0

        fac_out[fac.id] = {
            "id": fac.id,
            "name": fac.name,
            "capacity": dict(fac.capacity),
            "arrival_rate": fac.arrival_rate,
            "patients_arrived": len(recs),
            "patients_completed": len(done),
            "avg_wait_time_min": _avg(waits),
            "median_wait_time_min": _percentile(waits, 50),
            "p90_wait_time_min": _percentile(waits, 90),
            "avg_wait_by_priority": {
                k: _avg(v) for k, v in by_pri.items()
            },
            "sla_breaches_red": sla,
            "red_patients": red_here,
            "utilization": util,
        }

    overall = {
        "patients_arrived": len(all_waits),
        "patients_completed": completed_total,
        "avg_wait_time_min": _avg(all_waits),
        "median_wait_time_min": _percentile(all_waits, 50),
        "p90_wait_time_min": _percentile(all_waits, 90),
        "sla_breaches_red": sla_total,
        "red_patients": red_completed,
        "red_sla_minutes": RED_SLA_MIN,
    }
    out: dict[str, Any] = {
        "seed": seed,
        "sim_duration_min": sim_duration,
        "overall": overall,
        "facilities": fac_out,
    }
    if extra:
        out.update(extra)
    return out


def run_simulation(
    facility_configs: list[dict[str, Any]] | None = None,
    sim_duration: float = DEFAULT_SIM_DURATION_MIN,
    seed: int = DEFAULT_SEED,
    extra_patients: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run one simulation and return per-facility + overall KPIs.

    extra_patients: optional list of
      {facility_id, priority, at_min?, patient_id?}
    injected on top of the Poisson arrivals.
    """
    configs = facility_configs or default_facility_configs()
    random.seed(int(seed))
    env = simpy.Environment()
    facilities = [Facility(env, cfg) for cfg in configs]
    by_id = {f.id: f for f in facilities}

    for fac in facilities:
        env.process(_arrivals(env, fac, sim_duration))

    injected_ids: list[str] = []
    for i, spec in enumerate(extra_patients or []):
        fid = str(spec["facility_id"])
        fac = by_id.get(fid)
        if fac is None:
            for f in facilities:
                if f.name.lower() == fid.lower() or f.id.lower() == fid.lower():
                    fac = f
                    break
        if fac is None:
            continue
        pid = str(spec.get("patient_id") or f"injected-{i+1}")
        at = float(spec.get("at_min", 0.0))
        pri = int(spec["priority"])
        injected_ids.append(pid)
        env.process(_inject(env, fac, sim_duration, at, pri, pid))

    env.run(until=sim_duration)

    extra = {"injected_patient_ids": injected_ids} if injected_ids else None
    result = _summarize(facilities, sim_duration, int(seed), extra=extra)

    # Attach the injected patients' own records so the API can surface them.
    if injected_ids:
        injected_records = []
        for fac in facilities:
            for rec in fac.records:
                if rec["patient_id"] in injected_ids:
                    injected_records.append(rec)
        result["injected_patients"] = injected_records
    return result


def find_patient(sim_results: dict[str, Any], patient_id: str) -> dict[str, Any] | None:
    for rec in sim_results.get("injected_patients") or []:
        if rec["patient_id"] == patient_id:
            return rec
    return None
