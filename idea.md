# Rakshak — Build Spec (for Cursor)

This is an implementation spec, not a pitch doc. Build against this directly. Where a decision was made to keep hackathon scope realistic, it's marked explicitly — don't gold-plate those areas.

---

## 0. What we're building, in one paragraph

An AI First Responder. A trigger (manual tap, spoken distress, simulated fall) opens a live voice conversation with a patient, conducted in their spoken language via Amazon Transcribe and Amazon Polly, reasoned over by Amazon Bedrock. The AI triages, **stays in conversation with the patient reassuring them through the entire escalation process** (does not go silent once it decides to escalate), generates a structured emergency handoff, and works through an escalation chain of contacts. A real-time **Command Center dashboard** mirrors the entire event as it unfolds, for anyone watching who isn't holding the watch.

Build order: **orchestrator backend → dashboard → AWS voice + reasoning integration → trigger simulator (web button first) → real watch integration last, if time remains.** The watch is not the critical path. Don't let it become one.

---

## 1. Core state machine

This is the spine of the whole system. Implement this as an explicit state machine server-side (not implicit in prompt logic) so the dashboard can always render "where are we right now."

```
IDLE
  │  trigger fires (manual_tap | voice_distress | simulated_fall)
  ▼
LISTENING
  │  Amazon Transcribe streaming session opens, greeting played via Polly
  ▼
TRIAGING
  │  Amazon Bedrock reasoning over the live conversation
  │  loop: patient speaks → Transcribe → Bedrock turn → Polly response
  │  the agent calls assess() after each turn with a running severity level
  ▼
  ├── LOW severity → REASSURING (stay in conversation, no escalation, offer to end call)
  │
  └── MEDIUM/HIGH severity →
        ▼
      HANDOFF_GENERATED
        │  the agent calls generate_handoff() → structured block produced
        ▼
      ESCALATING
        │  the agent calls escalate() → contact chain begins
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

**Why this matters more than it looks:** the old version of this product ended at `HANDOFF_GENERATED`. The state machine above is what makes "stay with the patient" a real behavior instead of a nice line in the pitch — `ESCALATING` and `AWAITING_HANDOVER` are conversation states, not just backend statuses. The system prompt (Section 4) must know it's still on an active call during these states.

---

## 2. System architecture

```
┌─────────────────┐     ┌──────────────────────────┐     ┌─────────────────┐
│  Trigger source  │────▶│   Orchestrator (BE)      │────▶│  Command Center  │
│  - web button     │     │   - state machine         │     │  Dashboard (FE)  │
│  - voice phrase   │     │   - Amazon Transcribe STT │     │  - live transcript│
│  - watch (later)  │     │   - Amazon Polly TTS      │     │  - patient state  │
└─────────────────┘     │   - Amazon Bedrock agent  │     │  - AI assessment   │
                          │   - escalation service    │     │  - timeline        │
                          └──────────────────────────┘     │  - handoff card    │
                                    │                    │  - escalation      │
                                    │  WebSocket push      │    progress        │
                                    ▼                    └─────────────────┘
                          ┌──────────────────────────┐
                          │  Escalation targets       │
                          │  Amazon SNS (SMS)         │
                          │  Amazon Connect (voice)   │
                          └──────────────────────────┘
```

**Recommended stack** (optimize for what you and your team already know; this is a default, not a mandate):
- **Backend/orchestrator:** Node.js (TypeScript) or Python (FastAPI) — whichever your team is faster in. Needs to hold: the state machine, an Amazon Bedrock client, Amazon Transcribe streaming and Amazon Polly clients, and a WebSocket server pushing state to the dashboard.
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
  text: string;               // transcript, from Amazon Transcribe or the agent's own reply
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

## 4. Amazon Bedrock integration

**Model:** Amazon Nova, through a cross-region inference profile (`us.amazon.nova-2-lite-v1:0`), so Bedrock spreads load across the US regions on its own.
**API:** the **Converse** API. One request shape across every Bedrock model, and first-class tool use — the agent calls the tools below and we read structured arguments instead of parsing prose.
**Credentials:** the standard AWS chain. An IAM role when deployed, `aws configure` or SSO locally. There is no API key to leak, and no ephemeral-token dance even where the orchestrator faces a client.
**Inference config:** `maxTokens` around 512 and `temperature` 0.3. This is a latency-sensitive conversational use case, not a deep-reasoning one.
**Failure handling:** a turn that fails with a region-shaped error (throttle, 5xx, model-not-ready) is retried whole in `BEDROCK_FAILOVER_REGION`. Past that the API returns an explicit error — nothing invents a reply. See `docs/RESILIENCE.md`.

### Tools to register (Converse `toolConfig`)

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

Iterate on this prompt against scripted test inputs (mild dizziness, "I fell and can't get up," chest pain, confusion/rambling) before wiring it to real audio — text-mode testing first is much faster to iterate on than full audio round trips. `LLM_PROVIDER=offline` runs the same cases deterministically in CI.

---

## 5. Voice integration — Amazon Transcribe + Amazon Polly

- **STT:** Amazon Transcribe **streaming**, `pcm` encoding at 16 kHz mono. The browser recorder (`web/src/lib/recordWav.ts`) and the Wear OS `AudioBridge` both emit exactly that, so there is no transcode step between the mic and the transcript.
- **Language identification:** turn on `IdentifyLanguage` with `LanguageOptions` of `en-IN,hi-IN` and `PreferredLanguage` set to the patient's profile language. This is the whole reason a Hinglish sentence works without asking the patient to pick a language first. Transcribe reports the language of the *audio*; the text itself is the better signal for code-mix, so the transcript is re-checked against a code-mix heuristic before the reply language is chosen.
- **TTS:** Amazon Polly, voice **Kajal**, `generative` engine. Kajal covers Hindi and Indian English on one voice, so a code-mix reply does not need voice switching mid-sentence. The generative engine is not in every region — an `EngineNotSupportedException` retries on `neural`, logged rather than hidden.
- **Division of labour:** Bedrock reasons, Transcribe listens, Polly speaks. Keep it that way. Resist folding transcription into the reasoning call: separate services mean a sick STT degrades the check-in to text chips instead of taking the whole turn down with it.

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

- Prescription OCR beyond the discharge-summary path. Hardcode `medical_history` and `medications` as test data for the demo patient. (Discharge PDFs *are* handled — Amazon Textract plus Amazon Comprehend Medical — but don't widen that to arbitrary prescriptions.)
- Real ambulance/emergency-services dispatch to 108/911. The `emergency_services` hop sends an Amazon SNS SMS to a demo number you configure — it does **not** place a real emergency call.
- Multi-language support beyond one demo language.
- User accounts, auth, persistent storage beyond the current session, historical dashboards.
- Live interpreter mode (patient↔doctor↔family three-way translation) — genuinely good idea, but only attempt this after Sections 1–6 are fully working and demo-rehearsed. Treat it as a separate, optional build task, not part of this spec's critical path.
- Live map / responder routing — cut. Doesn't demonstrate anything about the AI and needs real or convincingly fake geodata to not look broken.

---

## 8. Build checklist (rough order, adjust to your team)

- [ ] Orchestrator skeleton with the state machine (Section 1), no AI wired in yet — just trigger → state transitions, testable via the web trigger button
- [ ] WebSocket push from orchestrator to a placeholder dashboard, confirm real-time updates work end to end
- [ ] Amazon Bedrock Converse connection, text-mode first, tool use wired to state machine transitions
- [ ] Swap text-mode for full audio, wire in Amazon Transcribe streaming + Amazon Polly
- [ ] Dashboard built out to the full spec in Section 6, connected to real session data
- [ ] Escalation chain logic + simulated Amazon SNS / Amazon Connect sends
- [ ] "Stay with the patient" behavior explicitly tested — confirm the AI keeps talking through ESCALATING/AWAITING_HANDOVER rather than going silent
- [ ] Latency pass: measure round-trip time at each hop, cut wherever possible (see latency notes in the planning doc)
- [ ] Full run-throughs with the web trigger button, 10+ times, timed
- [ ] Only once all of the above is solid: watch integration and/or interpreter mode, whichever has more remaining time budget

---

## 9. Config / environment

```
AWS_REGION=us-east-1       # credentials come from the standard chain — no API keys
BEDROCK_MODEL_ID=us.amazon.nova-2-lite-v1:0
BEDROCK_FAILOVER_REGION=us-west-2
POLLY_VOICE=Kajal
POLLY_ENGINE=generative
DEMO_LANGUAGE=kn-IN         # pick one, don't generalize early
ESCALATION_MODE=simulated   # vs "live" once Amazon SNS / Amazon Connect are wired up
```

---

Build against the checklist in order. If you're short on time near the end, the dashboard and the "stay with the patient" behavior are worth protecting over the watch integration and the interpreter mode — they're cheaper, lower-risk, and do more work per hour spent.