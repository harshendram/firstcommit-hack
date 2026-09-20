# Rakshak — demo runbook

**Deployed**
- Frontend: AWS Amplify Hosting — https://main.d2dqtm6sqego9a.amplifyapp.com
- API: Amazon API Gateway — https://6cuto4692g.execute-api.us-east-1.amazonaws.com
- Health: `/health` → `{"ok":true,...}` · `/health/deep` → region, model, breaker states

**Local polish note:** UI changes in this repo reach the live URLs on the next push to `main` —
Amplify Hosting rebuilds the frontend automatically, and `scripts/deploy.ps1` redeploys the stack.
If you cannot redeploy before the talk, present on the current deploy and use the fallbacks below.

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
- Drop `samsung-health-sensor-api.aar` into `wear-os/app/libs/` (see that folder's README).
- Watch status shows `Measuring vitals…` then e.g. `HR 78 · SpO₂ 97% · 4.2k steps`.
- Doctor `/doctor` trends add an SpO₂ series only after a live reading exists.

---

## Pre-demo checklist (15–20 min before)

1. **Confirm AWS is answering** — `npm --prefix backend run smoke:aws`. It checks STS, Bedrock,
   Polly, Comprehend Medical and Transcribe in one pass and exits non-zero on the first failure.
   Do this first; everything below assumes it passed.
2. **Check the deep health endpoint** — open `/health/deep`. The `degraded` array should be empty.
   If a circuit breaker shows `open`, that dependency is sick — see the fallback table.
3. **Wake the API** — open `/health` in a tab and leave it open. A cold Lambda adds a second or
   two to the first voice turn; a warm one does not.
4. **Open tabs (laptop, 1280–1440px)**
   - Tab A: `/` landing
   - Tab B: `/checkin`
   - Tab C: `/doctor`
   - Tab D (optional SOS): `/command` or `/patient`
5. **On `/doctor`:** confirm "Live feed" (green). If "Reconnecting", refresh after health is OK.
6. **Reset once:** click **Reset demo** so Lakshmi shows seeded history without a stale live transcript.
7. **Mic + audio:** allow microphone on `/checkin`; tap once so the browser unlocks TTS autoplay.
8. **Voice escalation:** optional. A live family call needs an Amazon Connect instance and
   `CONTACT_*_PHONE`. Without it, pitch the fall story from the dashboard replay or `/command`.
9. **Login (if showing multi-patient):** use your own demo account — do not put real secrets in
   slides. Placeholders: username `________` / password `________`.
10. **Network:** prefer venue ethernet or a personal hotspot you control; avoid captive-portal
    Wi-Fi, which breaks WebSockets.

---

## 3–5 minute click path

| Time | Where | What you say / do |
|------|--------|-------------------|
| 0:00 | `/` | Brand: *Rakshak catches readmission before day thirty.* One line on Amazon Transcribe → Bedrock → Polly. CTA → check-in. |
| 0:40 | `/checkin` | **Skip details — Lakshmi Rao demo.** Hear the Polly greeting (Hinglish). Prefer **chips** (Walk done → Antibiotic → Dressing) for reliability; mic is the wow if the room is quiet. |
| 1:40 | Same | Finish / auto-complete → **Patient status** card (Stable / score) → "Open dashboard". |
| 2:00 | `/doctor` | Roster + census. Lakshmi highest/focus. Point at **AI recovery summary**, **Why this risk**, **Recovery score**, discharge plan strip. |
| 2:50 | Scroll | Timeline + mobility / trends — "compares today to the expected curve." |
| 3:20 | Fall block | **Fall detection** capability replay (or `/command` if you rehearsed SOS). Watch → AI → doctor → family. |
| 3:50 | Close | One line: continuous post-discharge visibility, patient language, clinician action — not another chat log. |

**If short on time:** skip landing; start on check-in chips → doctor summary → fall replay.

### The judge question worth being ready for

*"What happens when Bedrock goes down?"* — open `/health/deep` and show the breaker states.
A region-shaped failure fails the whole turn over to `BEDROCK_FAILOVER_REGION` and emits an
`LLMFailover` metric; three in five minutes raises a CloudWatch alarm. Past that the API returns
`llm_unavailable` and the UI says so — nothing fakes a reply. Details in
[`docs/RESILIENCE.md`](docs/RESILIENCE.md).

---

## Known risks & fallbacks

| Risk | Mitigation |
|------|------------|
| Cold Lambda / WS "Reconnecting" | Hit `/health` first; refresh doctor + check-in; keep the health tab open. |
| TTS blocked by browser | Banner **Tap to hear Rakshak**; click it once after start. |
| Mic noisy / Transcribe garbles Hindi | Use **demo chips** — same write-back to the dashboard. |
| Bedrock throttle | It fails over to the second region on its own. If both are degraded, reset the demo and narrate over the seeded doctor chart. |
| Polly generative unavailable in-region | It retries on the neural engine automatically; the voice is the same Kajal. |
| Watch buzz does nothing | Expected without Wear OS paired — say "signals the Galaxy Watch"; show the video or `/command`. |
| Amazon Connect not configured | Do not promise a live call; use the fall **demo replay** + workflow strip. |
| Weird live transcript from an earlier run | **Reset demo** before the talk. |

---

## What needs live AWS access for "wow"

There are no API keys to paste. Everything below authenticates with the AWS credential chain —
the Lambda execution role when deployed, `aws configure` or SSO locally.

| Moment | Needs |
|--------|--------|
| Voice greeting + replies | Amazon Polly, `OFFLINE_SPEECH=false` |
| Mic → transcript | Amazon Transcribe + browser mic |
| Agent reasoning | Amazon Bedrock model access for Amazon Nova in your region |
| Discharge PDF digitisation | Amazon Textract + Amazon Comprehend Medical |
| Live SMS escalate | Amazon SNS + `CONTACT_*_PHONE` (and a destination that has opted in) |
| Live voice escalate | Amazon Connect instance, contact flow, claimed number |
| Doctor roster / login | Amazon Aurora Serverless v2 (or any Postgres) via `DATABASE_URL` |
| Wear buzz / fall sensors | Physical Galaxy Watch + WS to the backend |
| Live HR / steps / SpO₂ | Galaxy Watch 4 app + BODY_SENSORS; SpO₂ needs Health Platform Dev mode + Samsung AAR |

Chip-only check-in + the doctor dashboard still tell the full product story without a mic.

---

## Env quick reference

See [`.env.example`](.env.example). Minimum for the voice demo: `AWS_REGION` plus working AWS
credentials, `AUTH_SECRET`, and `DATABASE_URL` (auth/roster). Web: `NEXT_PUBLIC_API_URL` and
`NEXT_PUBLIC_CARE_WS_URL` (or `NEXT_PUBLIC_WS_URL`) pointing at the API host (`wss://…/care`).
