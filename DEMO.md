# Rakshak — Epoch demo runbook

**Deployed**
- Frontend: https://rakshak-alpha-lake.vercel.app/
- Backend: https://rakshak-80hs.onrender.com
- Health: https://rakshak-80hs.onrender.com/api/health → `{"ok":true}`

**Local polish note:** Doctor/check-in polish and trend fixes in this repo need a Vercel + Render redeploy to show on the live URLs. If you cannot redeploy before the talk, present on the current deploy and use the fallbacks below.

---

## Wear OS — Galaxy Watch 4 vitals

Live check-ins pull **heart rate**, **steps**, and (when available) **SpO₂**
from the watch and attach them to the care check-in.

### SpO₂ developer mode (required for local demos)

1. On the Galaxy Watch: **Settings → Apps → Health Platform**.
2. Tap **Health Platform** about **10 times** until `[Dev mode]` appears.
3. Without developer mode (or a Samsung partner key), SpO₂ returns unavailable —
   HR and steps still work. Rakshak never invents an SpO₂ number.

### Demo tips

- Wear the watch **snug**, stay still **10–30s** after tapping **Check in**.
- Allow **BODY_SENSORS** + **ACTIVITY_RECOGNITION** when prompted.
- Drop `samsung-health-sensor-api.aar` into `wear-os/app/libs/` (see that folder’s README).
- Watch status shows `Measuring vitals…` then e.g. `HR 78 · SpO₂ 97% · 4.2k steps`.
- Doctor `/doctor` trends add an SpO₂ series only after a live reading exists.

---

## Pre-demo checklist (15–20 min before)

1. **Wake the backend** — open `/api/health` in a tab. Wait until JSON returns (Render free tier can take 30–90s on cold start). Leave that tab open.
2. **Optional keep-alive** — UptimeRobot (or similar) pinging `https://rakshak-80hs.onrender.com/api/health` every 5 min. Root `/health` is in local code; deployed probe is **`/api/health` only**.
3. **Open tabs (laptop, 1280–1440px)**
   - Tab A: `/` landing
   - Tab B: `/checkin`
   - Tab C: `/doctor`
   - Tab D (optional SOS): `/command` or `/patient`
4. **On `/doctor`:** confirm “Live feed” (green). If “Reconnecting”, refresh after health is OK.
5. **Reset once:** click **Reset demo** so Lakshmi shows seeded history without a stale weird live transcript.
6. **Mic + audio:** allow microphone on `/checkin`; tap once so browser unlocks TTS autoplay.
7. **Sarvam keys:** voice STT/TTS/LLM need `SARVAM_API_KEY` on Render. Without it, use **text chips** only.
8. **Twilio:** optional. Live family call/SMS needs Twilio + `CONTACT_*_PHONE`. Pitch fall story from dashboard replay or `/command` video/path without live dial.
9. **Login (if showing multi-patient):** use your own demo account — do not put real secrets in slides. Placeholders: username `________` / password `________`.
10. **Network:** prefer hotel/venue ethernet or a personal hotspot you control; avoid captive portal Wi‑Fi for WebSocket.

---

## 3–5 minute click path

| Time | Where | What you say / do |
|------|--------|-------------------|
| 0:00 | `/` | Brand: *Rakshak catches readmission before day thirty.* One line on Sarvam STT → LLM → TTS. CTA → check-in. |
| 0:40 | `/checkin` | **Skip details — Lakshmi Rao demo.** Hear Bulbul greeting (Hinglish). Prefer **chips** (Walk done → Antibiotic → Dressing) for reliability; mic is the wow if room is quiet. |
| 1:40 | Same | Finish / auto-complete → **Patient status** card (Stable / score) → “Open dashboard”. |
| 2:00 | `/doctor` | Roster + census. Lakshmi highest/focus. Point at **AI recovery summary**, **Why this risk**, **Recovery score**, discharge plan strip. |
| 2:50 | Scroll | Timeline + mobility / trends — “compares today to the expected curve.” |
| 3:20 | Fall block | **Fall detection** capability replay (or `/command` if you rehearsed SOS). Watch → AI → doctor → family. |
| 3:50 | Close | One line: continuous post-discharge visibility, patient language, clinician action — not another chat log. |

**If short on time:** skip landing; start on check-in chips → doctor summary → fall replay.

---

## Known risks & fallbacks

| Risk | Mitigation |
|------|------------|
| Render cold start / WS “Reconnecting” | Hit `/api/health` first; refresh doctor + check-in; keep health tab open. |
| TTS blocked by browser | Banner **Tap to hear Rakshak**; click it once after start. |
| Mic noisy / STT garbles Hindi | Use **demo chips** — same write-back to dashboard. |
| Sarvam 429 / API error | Reset demo; retry with chips; if dead, narrate over doctor seeded chart (already looks real). |
| Buzz watch does nothing | Expected without Wear OS paired — say “signals the Galaxy Watch”; show video or `/command`. |
| Twilio not configured | Do not promise a live call; use fall **demo replay** + workflow strip. |
| Weird live transcript from earlier run | **Reset demo** before the talk. |
| Deploy missing latest UI polish | Present current deploy; local fixes are in git working tree until you redeploy. |

---

## What needs live keys for “wow”

| Moment | Needs |
|--------|--------|
| Voice greeting + replies (Bulbul) | `SARVAM_API_KEY`, TTS not mocked |
| Mic → transcript (Saaras) | Same + browser mic |
| Agent reasoning (Sarvam 105B) | `LLM_PROVIDER=sarvam` + key (else mock/gemini per env) |
| Discharge PDF digitisation | Sarvam document API + key |
| Live WhatsApp / voice escalate | Twilio + contact phones |
| Wear buzz / fall sensors | Physical Galaxy Watch + WS to backend |
| Live HR / steps / SpO₂ on check-in | Galaxy Watch 4 app + BODY_SENSORS; SpO₂ needs Health Platform Dev mode + Samsung AAR |

Chip-only check-in + doctor dashboard still tells the full product story without mic.

---

## Env quick reference

See `.env.example`. Minimum for voice demo: `SARVAM_API_KEY`, `AUTH_SECRET`, `DATABASE_URL` (auth/roster). Web: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CARE_WS_URL` (or `NEXT_PUBLIC_WS_URL`) pointing at the Render host (`wss://…/care`).
