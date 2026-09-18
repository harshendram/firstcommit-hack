# Wear OS — Rakshak Care (Galaxy Watch 4+)

Native Kotlin / Jetpack Compose companion for **post-discharge recovery**
check-ins, plus **accelerometer fall detection** that opens the emergency
voice triage on `/ws`.

## Modes

1. **Care (default)** — tap **Check in** → `/care` daily recovery conversation.
2. **SOS** — drop the watch (or tap **Simulate fall**) → `/ws` fall triage,
   Twilio escalation, same as the original Rakshak emergency path.

Fall detection is armed while idle. It disarms during an active check-in so a
gesture mid-conversation doesn't hijack the session.

## Recovery check-in flow

1. Open **Rakshak** (status: `Check in · fall armed`).
2. Tap **Check in** → `start_checkin` on the Care WebSocket.
3. Watch measures vitals in parallel (HR ~12s, SpO₂ up to ~25s, today's steps).
4. Sends `{ type: "watch_vitals", resting_hr, spo2?, steps? }` when any succeed.
5. Agent greets via TTS → mic opens automatically after speech.
6. Speak (or **Send now**) → `patient_audio`.
7. Loop until phase = `complete`. Tap **Again** for another run.

## Galaxy Watch 4 vitals

| Signal | API | Notes |
|--------|-----|--------|
| Heart rate | Health Services `MeasureClient` / `HEART_RATE_BPM` | Spot measure on check-in start |
| Steps | Health Services PassiveMonitoring / `STEPS_DAILY` (fallback: step counter) | Mapped to `activity_index` ≈ steps/100 |
| SpO₂ | Samsung Health Sensor SDK `SPO2_ON_DEMAND` | Needs AAR in `app/libs/` + Health Platform **developer mode** |

### Enable SpO₂ developer mode

1. Watch: **Settings → Apps → Health Platform**.
2. Tap the Health Platform row ~**10 times** until `[Dev mode]` shows.
3. Download `samsung-health-sensor-api.aar` from
   [Samsung Health Sensor SDK](https://developer.samsung.com/health/sensor/overview.html)
   and place it at `wear-os/app/libs/samsung-health-sensor-api.aar`.
4. Rebuild the APK.

Without the AAR / Dev mode, SpO₂ shows as unavailable on the watch and is
**omitted** from the payload (no fake %). HR + steps still flow to the doctor dashboard.

Wear the watch snug and stay still 10–30 seconds during measurement.

## Fall / SOS flow

1. Keep the app open (sensors only run while foregrounded).
2. Drop the watch onto a soft surface from ~20–40 cm, **or** tap **Simulate fall**.
3. Watch switches to SOS, connects to `/ws`, fires `simulated_fall`.
4. Rakshak asks if you're OK — answer by voice; escalation runs on the backend.
5. When the emergency session resolves, the watch returns to care mode and
   re-arms fall detection.

`orchestrator.ws` may point at `/care` or `/ws` — the clients derive both paths.



## Open in Android Studio



1. Android Studio → **Open** → this `wear-os/` folder.

2. Let Gradle sync.

3. Enable **Developer options** + **ADB debugging** / **Debug over Wi‑Fi** on the Galaxy Watch 4.

4. Care backend must be running (`backend` on port **3001**, path **`/care`**).

5. Run the `app` configuration onto the watch.



## Point the watch at your laptop



Emulator default (`10.0.2.2`) will **not** work on a physical watch.



### Same Wi‑Fi (preferred)



1. Find your laptop LAN IP, e.g. `192.168.1.42`.

2. Edit `local.properties`:



```properties

orchestrator.ws=ws://192.168.1.42:3001/care

```



### Windows Mobile Hotspot



1. On the laptop: **Settings → Mobile hotspot → On**. Note the hotspot name/password.

2. On the Galaxy Watch: join that hotspot Wi‑Fi.

3. On the laptop, the hotspot **gateway** is almost always `192.168.137.1` (this is the PC itself).

4. Set:



```properties

orchestrator.ws=ws://192.168.137.1:3001/care

```



5. Windows firewall: allow inbound **TCP 3001** (Node / private networks).

6. Verify from the laptop:



```powershell

Test-NetConnection 192.168.137.1 -Port 3001

# Expect TcpTestSucceeded : True

```



7. Sync Gradle / **rebuild + reinstall the APK** so `BuildConfig.ORCHESTRATOR_WS` updates.



Legacy `…/ws` values are accepted and rewritten to `/care` in code.



## "Broken pipe" / reconnect



OkHttp shows **Broken pipe** when the watch writes to a socket the backend already closed (tsx restart, EADDRINUSE fight, hotspot blip, or a huge TTS frame).



The watch client now:



- Auto-reconnects with backoff

- Fetches agent TTS over **HTTP** (`GET /api/care/tts/:id`) instead of a multi‑hundred‑KB WebSocket JSON frame

- Surfaces clearer status: `Connection lost — retrying…`



If it still fails: keep **one** backend on 3001 (`npm run dev` once), wait for the watch status to return to `Tap to check in`, then start check-in again.



## What it does



- Connects to Care WS: `ws://HOST:3001/care` (role `watch`)

- **Check in** → `start_checkin`

- **Talk / auto-mic** → `patient_audio` after agent TTS

- Plays agent TTS via `care_tts.audio_url` (HTTP) from the Care orchestrator

- Ignores `care_doctor` on the watch


