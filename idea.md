# Rakshak — Build Spec (for Cursor)

This is an implementation spec, not a pitch doc. Build against this directly. Where a decision was made to keep hackathon scope realistic, it's marked explicitly — don't gold-plate those areas.

---

## 0. What we're building, in one paragraph

An AI First Responder. A trigger (manual tap, spoken distress, simulated fall) opens a live voice conversation with a patient, conducted in their spoken language via Sarvam STT/TTS, reasoned over by Gemini Live. The AI triages, **stays in conversation with the patient reassuring them through the entire escalation process** (does not go silent once it decides to escalate), generates a structured emergency handoff, and works through an escalation chain of contacts. A real-time **Command Center dashboard** mirrors the entire event as it unfolds, for anyone watching who isn't holding the watch.

Build order: **orchestrator backend → dashboard → Gemini/Sarvam integration → trigger simulator (web button first) → real watch integration last, if time remains.** The watch is not the critical path. Don't let it become one.

---

## 1. Core state machine

This is the spine of the whole system. Implement this as an explicit state machine server-side (not implicit in prompt logic) so the dashboard can always render "where are we right now."

```
IDLE
  │  trigger fires (manual_tap | voice_distress | simulated_fall)
  ▼
LISTENING
  │  Sarvam STT streaming session opens, greeting played via TTS
  ▼
TRIAGING
  │  Gemini Live reasoning over the live conversation
  │  loop: patient speaks → STT → Gemini turn → TTS response
  │  Gemini calls assess() after each turn with a running severity level
  ▼
  ├── LOW severity → REASSURING (stay in conversation, no escalation, offer to end call)
  │
  └── MEDIUM/HIGH severity →
        ▼
      HANDOFF_GENERATED
        │  Gemini calls generate_handoff() → structured block produced
        ▼
      ESCALATING
        │  Gemini calls escalate() → contact chain begins
        │  *** conversation with patient DOES NOT STOP HERE ***
        │  AI switches tone: "I've messaged your daughter, she's on the way,
        │  I'm staying right here with you" — keeps listening, keeps responding
        ▼
      AWAITING_HANDOVER
        │  waiting for a human (family/security/services) to confirm arrival
        │  AI continues reassurance loop, periodic check-ins with patient
        ▼
      RESOLVED
           human confirms arrival (manual dashboard action for demo purposes)
           AI signs off: "Your daughter's here now. I'm glad you're okay."
```

**Why this matters more than it looks:** the old version of this product ended at `HANDOFF_GENERATED`. The state machine above is what makes "stay with the patient" a real behavior instead of a nice line in the pitch — `ESCALATING` and `AWAITING_HANDOVER` are conversation states, not just backend statuses. Gemini's system prompt (Section 4) must know it's still on an active call during these states.

---

## 2. System architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Trigger source  │────▶│   Orchestrator (BE)   │────▶│  Command Center  │
│  - web button     │     │   - state machine      │     │  Dashboard (FE)  │
│  - voice phrase   │     │   - Sarvam STT/TTS      │     │  - live transcript│
│  - watch (later)  │     │   - Gemini Live client  │     │  - patient state  │
└─────────────────┘     │   - escalation service  │     │  - AI assessment   │
                          └──────────────────────┘     │  - timeline        │
                                    │                    │  - handoff card    │
                                    │  WebSocket push      │  - escalation      │
                                    ▼                    │    progress        │
                          ┌──────────────────────┐     └─────────────────┘
                          │  Escalation targets    │
                          │  (WhatsApp/Twilio,     │
                          │   simulated for demo)  │
                          └──────────────────────┘
```

**Recommended stack** (optimize for what you and your team already know; this is a default, not a mandate):
- **Backend/orchestrator:** Node.js (TypeScript) or Python (FastAPI) — whichever your team is faster in. Needs to hold: the state machine, a Gemini Live WebSocket client, a Sarvam streaming STT/TTS client, and a WebSocket server pushing state to the dashboard.
- **Dashboard:** React + WebSocket client, single page. Keep it a single artifact-style page — don't build routing/auth/multi-page infra you don't need.
- **Trigger simulator:** literally a page/button that POSTs `{trigger_type: "manual_tap" | "voice_distress" | "simulated_fall"}` to the orchestrator. This is your primary demo trigger. Build this before touching the watch.
- **Realtime transport:** one WebSocket connection between backend and dashboard, pushing state-machine transitions and transcript deltas as they happen. Don't poll.

---

## 3. Data models

Define these as actual types/interfaces in code (TypeScript interfaces or Pydantic models), not loose dicts — the dashboard and escalation service both depend on shape stability.

```typescript
type TriggerType = "manual_tap" | "voice_distress" | "simulated_fall";

type SessionState =
  | "idle" | "listening" | "triaging" | "reassuring"
  | "handoff_generated" | "escalating" | "awaiting_handover" | "resolved";

type Severity = "low" | "medium" | "high";

interface ConversationTurn {
  speaker: "patient" | "ai";
  text: string;               // transcript, from Sarvam STT or Gemini output transcription
  timestamp: string;          // ISO 8601
  language: string;           // e.g. "kn-IN"
}

interface HandoffSummary {
  patient_name: string;
  age: number;
  location: string;
  condition: string;          // short clinical description
  symptoms: string[];
  medical_history: string[];  // hardcoded test data for demo, see Section 7
  medications: string[];      // hardcoded test data for demo, see Section 7
  recommended_action: string;
  severity: Severity;
  generated_at: string;
}

interface EscalationHop {
  contact_name: string;
  contact_role: "neighbour" | "security" | "family" | "emergency_services";
  status: "pending" | "notified" | "acknowledged" | "timed_out";
  notified_at?: string;
}

interface SessionEvent {
  session_id: string;
  state: SessionState;
  trigger_type: TriggerType;
  severity: Severity | null;
  transcript: ConversationTurn[];
  handoff: HandoffSummary | null;
  escalation_chain: EscalationHop[];
  started_at: string;
  updated_at: string;
}
```

`SessionEvent` is the single object the dashboard subscribes to — push the full updated object (or a diff, if you want to optimize) over the WebSocket on every state change or new transcript turn.

---

## 4. Gemini Live integration

**Model:** `gemini-3.1-flash-live-preview` (or current live-audio model — check availability at build time).
**Connection:** WebSocket, server-to-server from your orchestrator. Use an ephemeral token, not a raw API key, if the orchestrator has any client-facing surface.
**Response modality:** `AUDIO`, with output transcription enabled so you get text for the dashboard without a separate STT pass on Gemini's own output.
**Thinking config:** keep `thinking_level` at `low`/`minimal` — this is a latency-sensitive conversational use case, not a deep-reasoning one.

### Function declarations to register

```
assess(severity: "low" | "medium" | "high", reasoning: string)
  — called after each patient turn during TRIAGING to update state machine

generate_handoff(patient_name, age, location, condition, symptoms[],
                  recommended_action)
  — called once, when severity is first assessed medium or high

escalate(chain: EscalationHop[])
  — called once, immediately after generate_handoff

stay_and_reassure()
  — called on entering ESCALATING/AWAITING_HANDOVER; signals the orchestrator
    the AI should continue the conversation loop rather than end the session
```

### System prompt (starting point — tune during Day 2 testing)

```
You are Rakshak, a calm, warm AI first responder speaking with an elderly
person who may be in distress. You are having a real-time voice
conversation in their language. Your job has three phases:

1. TRIAGE: Ask short, simple, one-idea-at-a-time questions to understand
   what's wrong. Never sound clinical or rushed. Examples: "Are you able to
   stand up?" "Where does it hurt?" "Can you breathe okay?"
   After each answer, silently call assess() with your current severity
   read: low (no real danger), medium (needs family attention soon), or
   high (needs urgent help now).

2. HANDOFF + ESCALATION: The moment severity is medium or high, call
   generate_handoff() with what you know so far, then call escalate().
   Do NOT end the conversation here. Immediately tell the patient what
   you've done in a reassuring tone — e.g. "I've let your daughter know,
   she's on her way. I'm going to stay right here with you until she
   arrives." Call stay_and_reassure().

3. STAY WITH THE PATIENT: Continue the conversation. Check in periodically
   ("Still with me? How are you feeling now?"). Keep responses short — this
   is a real-time call, not a chat transcript. If the patient's condition
   changes, re-assess and update the handoff if needed.

Tone: calm, warm, unhurried, never alarmed even if the patient is panicking
— your calm is what keeps them calm. Keep every response under two
sentences unless the patient asks for detail. Speak naturally in whatever
language the patient is using; do not switch to English unless they do.
```

Iterate on this prompt against scripted test inputs (mild dizziness, "I fell and can't get up," chest pain, confusion/rambling) before wiring it to real audio — text-mode testing first is much faster to iterate on than full audio round trips.

---

## 5. Sarvam integration

- **STT:** Saaras v3, Streaming API over WebSocket, `pcm_s16le` or `pcm_raw` audio. This is telephony-tuned — good fit for a phone/watch mic. Enable VAD for turn-taking and barge-in.
- **TTS:** Bulbul v3. Pick one demo voice and one demo language up front (e.g. Kannada) and don't generalize beyond it until the core loop is solid. Consider a Pronunciation Dictionary if family/medical terms are being mispronounced.
- **Where Sarvam sits vs. Gemini's own audio:** Gemini Live can technically do native multilingual audio itself. Use Sarvam anyway for STT/TTS — it's the whole reason the product feels native rather than translated, and it's the stack this event is built around. Don't let Gemini's native audio quietly replace Sarvam's role; keep the division of labor from the architecture doc (Gemini reasons, Sarvam speaks/listens).

---

## 6. Command Center Dashboard — spec

This is not a debug panel. It needs to look like a product, because judges will read it as directly as they hear the audio.

**Layout (single screen, no scrolling required if possible):**

```
┌──────────────────────────────────────────────────────────┐
│  🚨 RAKSHAK — AI First Responder          [state badge]   │
├───────────────────────┬──────────────────────────────────┤
│  Live Transcript        │  Patient Status                   │
│  (auto-scrolling,       │  - Severity: ● HIGH                │
│   speaker-labeled,      │  - Current phase: ESCALATING       │
│   streaming in as       │                                     │
│   it's spoken)          │  Emergency Handoff                 │
│                          │  ┌─────────────────────────────┐  │
│                          │  │ Patient: Lakshmi Devi, 72     │  │
│                          │  │ Condition: possible hip       │  │
│                          │  │  fracture                     │  │
│                          │  │ ...                            │  │
│                          │  └─────────────────────────────┘  │
├───────────────────────┴──────────────────────────────────┤
│  Escalation Progress                                        │
│  ● Neighbour notified  →  ● Daughter notified  →  ○ EMS      │
├──────────────────────────────────────────────────────────┤
│  Timeline: 0:00 trigger  0:04 triage start  0:19 escalated   │
└──────────────────────────────────────────────────────────┘
```

**Non-negotiables:**
- No raw JSON, logs, HTTP status codes, or token counts visible anywhere on this screen. If you're debugging, use a separate dev console, not this view.
- The transcript panel must feel alive — text appearing as it's spoken, not a static block that snaps in after the fact. This is your "watch the AI think" wow moment and it's nearly free once the WebSocket plumbing exists.
- Severity should be a clear visual state (color-coded badge), not a number in a table.
- Keep it to one screen. If you're tempted to add tabs or extra views, don't — this needs to be readable at a glance from across a room.

---

## 7. Explicitly out of scope — do not build these

- Prescription OCR / Sarvam Vision integration. Hardcode `medical_history` and `medications` as test data for the demo patient. Mention it as roadmap in the pitch, don't build it.
- Real ambulance/emergency-services dispatch to 108/911. The `emergency_services` hop sends a Twilio WhatsApp/SMS alert to a demo number you configure — it does **not** place a real emergency call.
- Multi-language support beyond one demo language.
- User accounts, auth, persistent storage beyond the current session, historical dashboards.
- Live interpreter mode (patient↔doctor↔family three-way translation) — genuinely good idea, but only attempt this after Sections 1–6 are fully working and demo-rehearsed. Treat it as a separate, optional build task, not part of this spec's critical path.
- Live map / responder routing — cut. Doesn't demonstrate anything about the AI and needs real or convincingly fake geodata to not look broken.

---

## 8. Build checklist (rough order, adjust to your team)

- [ ] Orchestrator skeleton with the state machine (Section 1), no AI wired in yet — just trigger → state transitions, testable via the web trigger button
- [ ] WebSocket push from orchestrator to a placeholder dashboard, confirm real-time updates work end to end
- [ ] Gemini Live connection, text-mode first, function calling wired to state machine transitions
- [ ] Swap text-mode for full audio, wire in Sarvam STT + TTS
- [ ] Dashboard built out to the full spec in Section 6, connected to real session data
- [ ] Escalation chain logic + simulated WhatsApp/Twilio sends
- [ ] "Stay with the patient" behavior explicitly tested — confirm the AI keeps talking through ESCALATING/AWAITING_HANDOVER rather than going silent
- [ ] Latency pass: measure round-trip time at each hop, cut wherever possible (see latency notes in the planning doc)
- [ ] Full run-throughs with the web trigger button, 10+ times, timed
- [ ] Only once all of the above is solid: watch integration and/or interpreter mode, whichever has more remaining time budget

---

## 9. Config / environment

```
GEMINI_API_KEY=            # or ephemeral token flow if orchestrator is client-facing
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
SARVAM_API_KEY=
SARVAM_STT_MODEL=saaras:v3
SARVAM_TTS_MODEL=bulbul:v3
DEMO_LANGUAGE=kn-IN         # pick one, don't generalize early
ESCALATION_MODE=simulated   # vs "live" if real WhatsApp/Twilio wired up
```

---

Build against the checklist in order. If you're short on time near the end, the dashboard and the "stay with the patient" behavior are worth protecting over the watch integration and the interpreter mode — they're cheaper, lower-risk, and do more work per hour spent.