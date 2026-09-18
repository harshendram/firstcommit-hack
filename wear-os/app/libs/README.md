# Samsung Health Sensor SDK (SpO₂)

SpO₂ on Galaxy Watch 4 uses Samsung's **Health Sensor SDK** AAR — it is
not on Maven Central without a partner key.

## Local demo setup

1. Download `samsung-health-sensor-api.aar` from
   [Samsung Health Sensor SDK](https://developer.samsung.com/health/sensor/overview.html)
   (requires a Samsung Developer account).
2. Place the file here as:
   `wear-os/app/libs/samsung-health-sensor-api.aar`
3. Sync Gradle / rebuild. `fileTree` already picks up `*.aar` in this folder.
4. On the watch, enable **Health Platform developer mode** (see `wear-os/README.md`).

Without the AAR, heart rate and steps still work via Health Services; SpO₂
reports as unavailable and is omitted from the WebSocket payload (no fake values).

## Production

Partner / release signing is required for Health Platform outside developer mode.
See Samsung's Health Sensor SDK policy docs.
