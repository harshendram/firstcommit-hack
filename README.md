# Ally

The product is **Ally** — family care for an aging parent, not surveillance.  
Runbook + architecture: [`ally/README.md`](ally/README.md) · web `/` `/home` `/parent` · API `:8002`.

The original Rakshak recovery/SOS stack remains under `backend/` as plumbing (Twilio fallback, Wear OS transport).

---

# Rakshak (legacy plumbing)


![Next.js](https://img.shields.io/badge/Next.js-15-black)
![Express](https://img.shields.io/badge/Express.js-Backend-green)
![Wear%20OS](https://img.shields.io/badge/Wear%20OS-Galaxy-blue)
![Sarvam](https://img.shields.io/badge/Powered%20by-Sarvam-orange)

### AI-powered Post-Discharge Patient Monitoring Platform built with Sarvam AI

## The Problem

After patients are discharged from the hospital, clinicians have very little visibility into how they're recovering until the next follow-up visit.

Patients often go home with discharge instructions they may not fully understand, symptoms can worsen silently, and complications are only discovered after they become serious enough to require another hospital visit.

Rakshak bridges this gap through continuous AI-powered recovery monitoring.

---

## The Solution

Rakshak is an AI-powered post-discharge monitoring platform built using Sarvam AI.

Patients can interact with Rakshak through either the web application or a Galaxy Wear OS companion app. Both support AI-powered voice check-ins, while the wearable additionally enables vital monitoring and gyroscope-based fall detection. Every interaction is processed by Sarvam AI to understand patient responses, generate personalized follow-up questions, assess recovery risk, and keep clinicians updated in real time.

When the wearable detects a fall or emergency, Rakshak immediately alerts the configured responder while updating the care team.

---

## Architecture

Rakshak consists of three core components:

- 🌐 **Web Application** — AI-powered multilingual voice check-ins accessible from any browser.
- ⌚ **Galaxy Wear OS Companion App** — Voice check-ins with wearable sensor support including fall detection and vital monitoring.
- 🩺 **Doctor Dashboard** — Real-time recovery monitoring, AI-generated summaries, risk assessment, and emergency alerts.

Sarvam AI serves as the intelligence layer powering multilingual speech recognition, conversational reasoning, document understanding, and natural speech synthesis across all three components.

---

## Why Rakshak?

Unlike traditional symptom trackers, Rakshak combines multilingual voice conversations, discharge-aware follow-ups, wearable sensing, and real-time clinician visibility into a single platform—helping detect recovery issues earlier while reducing the burden on both patients and healthcare providers.

---

## Features

| Area | What you get |
|------|----------------|
| **Voice check-in** | Speak or tap chips; mic is primary — auto-sends after a pause |
| **Multilingual** | Hinglish / Indic STT + TTS; agent matches the patient’s language |
| **Personalized Recovery Context** | References recent recovery history and discharge instructions |
| **AI Risk Assessment** | AI-generated recovery risk classification (`continue_monitoring`, `recommend_doctor_review`, `escalate`) |
| **Doctor dashboard** | Multi-patient roster, same-day check-ins, live chart updates |
| **Onboarding** | Account + recovery form **or** discharge PDF upload |
| **Document intelligence** | Sarvam digitises discharge PDFs into usable care context |
| **Galaxy Wear OS Companion** | Care check-in + fall detection / SOS on Galaxy Watch 4+ |
| **Escalation** | Twilio WhatsApp / voice for surgical-team alerts |

### Demo Patient

**Lakshmi Rao** — recovering after a knee replacement surgery. The demo showcases continuity across multiple recovery check-ins while supporting personalized conversations based on discharge context.

Logged-in users can also check in as themselves with their own profile and history.

---

## Sarvam models & APIs used

Rakshak uses Sarvam throughout the entire patient journey—from multilingual speech recognition and conversational AI to document understanding and personalized recovery monitoring.

| Capability | Sarvam product / model | Role in Rakshak |
|------------|------------------------|-----------------|
| **Speech-to-text** | **Saaras v3** (`saaras:v3`) | Transcribe patient audio (code-mix / Indic) |
| **Text-to-speech** | **Bulbul v3** (`bulbul:v3`, speaker `priya`) | Agent speaks greetings and follow-ups |
| **LLM / reasoning** | **Sarvam 105B** (`sarvam-105b`) | Conversational care turns (JSON agent) |
| **Document intelligence** | **Document Digitisation / Vision** | Convert discharge PDFs into structured recovery context |

**Document parsing flow:** Discharge PDF → Sarvam Document Digitisation → Structured care context → Personalized AI follow-ups

Env defaults (overridable):

```env
SARVAM_STT_MODEL=saaras:v3
SARVAM_TTS_MODEL=bulbul:v3
SARVAM_TTS_SPEAKER=priya
SARVAM_LLM_MODEL=sarvam-105b
LLM_PROVIDER=sarvam
```

---

## Hardware note

The Galaxy Wear OS companion app requires a physical smartwatch with accelerometer and gyroscope sensors. As these sensors cannot be emulated in a standard web environment, the wearable workflow is demonstrated in the submission video, while the complete web experience can be evaluated directly from the deployed application.

---

## Repository layout

```
backend/     Express API + WebSockets (/care, /ws), CareAgent, Sarvam, Twilio
web/         Next.js — landing, check-in, doctor dashboard, emergency UIs
wear-os/     Kotlin + Compose companion (Android Studio)
```

| Route | Purpose |
|-------|---------|
| `/` | Landing |
| `/checkin` | Daily recovery check-in (browser mic) |
| `/doctor` | Surgical team dashboard (multi-patient) |
| `/command` | Emergency command center |
| `/patient` | Emergency patient simulator |
| `/family` | Family incident view |

WebSockets: `/care` (check-in), `/ws` (fall / SOS).

---

## How to run (local)

### Prerequisites

- Node.js 20+
- Sarvam API key ([dashboard.sarvam.ai](https://dashboard.sarvam.ai))
- Optional: Supabase Postgres (auth + patient profiles), Twilio (alerts)
- Optional: Android Studio + Galaxy Watch for Wear OS

### 1. Environment

```bash
cp .env.example .env
cp web/.env.local.example web/.env.local
```

Fill at least:

| Variable | Purpose |
|----------|---------|
| `SARVAM_API_KEY` | Saaras, Bulbul, LLM, document digitisation |
| `DATABASE_URL` | Supabase Postgres URI |
| `AUTH_SECRET` | Long random string for JWT login |
| Twilio + `CONTACT_*_PHONE` | Only if you want live escalation |
| `PUBLIC_WEB_URL` | Default `http://localhost:3000` |

`web/.env.local`:

| Variable | Default / example |
|----------|-------------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api` |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:3001/ws` |
| `NEXT_PUBLIC_CARE_WS_URL` | `ws://localhost:3001/care` |

### 2. Backend (`:3001`)

```bash
cd backend
npm install
npm run dev
```

### 3. Web (`:3000`)

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000/checkin](http://localhost:3000/checkin) and [http://localhost:3000/doctor](http://localhost:3000/doctor).

### 4. Quick demo

1. Open `/doctor` and `/checkin` side by side.
2. Sign in (or **Try demo** for Lakshmi).
3. Start check-in → hear Bulbul → speak or tap a chip.
4. Finish → confirm the doctor roster / chart updates.
5. Optional: upload a discharge PDF on onboarding (Sarvam document digitisation).

**Demo Note:** Lakshmi Rao is a demonstration patient with historical recovery data to showcase continuity across multiple check-ins. Today's voice conversation, AI reasoning, dashboard updates, and wearable events are processed live.

### 5. Wear OS (optional)

See [`wear-os/README.md`](wear-os/README.md). Point `orchestrator.ws` at `ws://<your-lan-ip>:3001/care`. The wearable path is also shown in the submission video — see **Hardware note** above.

---

## Risk actions

| Risk | Action | Notification |
|------|--------|--------------|
| 🟢 Green | `continue_monitoring` | None |
| 🟡 Amber | `recommend_doctor_review` | WhatsApp (when Twilio configured) |
| 🔴 Red | `escalate` | WhatsApp + voice call |

---

## License / hackathon

Built for the Sarvam Epoch Buildathon — demo-oriented; not a clinical device or EMR replacement.
