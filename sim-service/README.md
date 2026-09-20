# Rakshak sim-service

Python microservice that simulates patient arrivals and scarce resources
(beds, doctors, ambulances) across three facilities, then greedily
rebalances capacity to cut wait times for high-priority patients.

Self-contained — the existing Express / Next.js / Wear OS apps are not
imported or modified. Call this over HTTP from the dashboard.

## Setup

```bash
cd sim-service
python -m venv .venv

# Windows
.venv\Scripts\activate
pip install -r requirements.txt

# macOS / Linux
# source .venv/bin/activate
# pip install -r requirements.txt
```

## Run

```bash
uvicorn app:app --reload --port 8001
```

Health check: [http://127.0.0.1:8001/health](http://127.0.0.1:8001/health)

CORS is open for `localhost:3000` / `:3001` / `:5173` and
`https://main.d2dqtm6sqego9a.amplifyapp.com`. Add more origins with a comma-separated
`CORS_ORIGINS` env var.

## Curl examples

All bodies are optional except `/simulate/inject-patient`. Default seed is `42`
so results are reproducible for a demo recording.

### Baseline 8-hour simulation

```bash
curl -s -X POST http://127.0.0.1:8001/simulate ^
  -H "Content-Type: application/json" ^
  -d "{\"seed\": 42}"
```

macOS / Linux:

```bash
curl -s -X POST http://127.0.0.1:8001/simulate \
  -H "Content-Type: application/json" \
  -d '{"seed": 42}'
```

Override arrival rates (patients per **minute**):

```bash
curl -s -X POST http://127.0.0.1:8001/simulate \
  -H "Content-Type: application/json" \
  -d '{"seed": 42, "arrival_rates": {"city_general": 0.16, "riverside_medical": 0.06, "st_marys": 0.06}}'
```

### Rebalance (the demo endpoint)

Look at `headline.avg_wait_before_min` vs `headline.avg_wait_after_min` first.

```bash
curl -s -X POST http://127.0.0.1:8001/simulate/rebalance \
  -H "Content-Type: application/json" \
  -d '{"seed": 42}'
```

### Inject a red patient (dashboard hook)

Call this when a real check-in / fall escalates to red. Target **< 2s**.

```bash
curl -s -X POST http://127.0.0.1:8001/simulate/inject-patient \
  -H "Content-Type: application/json" \
  -d '{"facility_id": "city_general", "priority": 0, "seed": 42}'
```

Render `headline.facility_name`, `headline.old_wait_min`, `headline.new_wait_min`,
and `headline.move_made` (`"no rebalance needed"` when nothing moved).

## Tuning the demo

Edit comments at the top of `seed_config.py`. The fastest levers:

| Knob | Effect |
|------|--------|
| `CITY_GENERAL["arrival_rate"]` | Raise to make City General waits blow up |
| `RIVERSIDE_MEDICAL["arrival_rate"]` | Lower to give the donor more slack |
| `MEAN_DOCTOR_MIN` | Raise to push doctor utilization without more arrivals |
| `RED_SHARE` | Raise to create more red SLA breaches (> 15 min wait) |
