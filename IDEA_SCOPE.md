# IDEA_SCOPE.md — Rakshak: Post-Discharge Recovery Agent

Status: **Idea Lock — approved · demo-ready**

Selected Sarvam Parameter: **Voice Experience**

---

## One-line pitch

Hospitals discharge chronic and surgical patients into a 30-day blind spot — the window where most preventable readmissions happen. Rakshak is an AI post-discharge care agent that runs a ~30-second multilingual voice check-in every day, compares today against an expected recovery curve, and writes the next clinical action into the surgical team's workflow before a quiet infection becomes a bounce-back admission.

---

## Locked contract

| Decision | Locked answer |
|---|---|
| User | Lakshmi Devi, 72 — day 12 after total knee replacement, Hinglish speaker |
| Job | Daily ~30s voice check-in → classify risk vs expected recovery → write recommendation |
| Hard input | Accented Hindi–English code-mix (“Cefuroxime le liya… ghutne ka dard wapas badh gaya”) |
| Final output | Surgical dashboard with reasoning trail + `continue_monitoring` / `recommend_doctor_review` / `escalate` |
| Sarvam parameter | Voice Experience (Saaras STT + Bulbul TTS) |
| Memory | Seeded 11-day recovery history (improves then reverses); live check-in layered on top |
| Payer | Hospital chain (30-day readmission cost) |
| Non-goals | Fall detection · SOS · EMR · auth · vector DB · multi-patient |

---

## Architecture (what is implemented)

```
Browser mic (P1) / Wear OS watch (P0)
        │
        ▼
  /care WebSocket  →  CareOrchestrator
        │                 ├─ CareAgent (Sarvam LLM, JSON turns)
        │                 ├─ Saaras STT (codemix) + Bulbul TTS
        │                 ├─ buildMemoryAnchor()   ← Memory beat
        │                 ├─ expectedRecovery()    ← day-N curve
        │                 ├─ classifyRisk()        ← mechanical thresholds
        │                 ├─ careStore.appendCheckIn()  ← write-back
        │                 └─ notifyDoctorReview / notifyDoctorUrgent (WhatsApp + call)
        ▼
  Doctor dashboard (/doctor) live via WS
```

### Reused from prior build
- Sarvam STT/TTS client with codemix mode
- Language helpers, Express + WS server, Next.js shell, design tokens
- Twilio WhatsApp / voice for amber review + red escalation

### Dropped
- FallDetector / SOS as the product story
- Emergency escalation chain as the primary path
- Family PWA as the primary demo surface

---

## Demo flow (~3 min)

1. Open `/doctor` — seeded recovery curve, mobility trend, pain reversing after day 7.
2. Open `/checkin` (or watch) — start today's check-in.
3. Patient speaks code-mix: “Cefuroxime le liya, but ghutne ka dard wapas badh gaya hai.”
4. Agent recalls: last week the knee felt better; pain and walking have reversed.
5. Adaptive follow-up about the wound → patient answers.
6. Classification writes back live (`recommend_doctor_review` or `escalate`).
7. Doctor reads recommendation in <30s; WhatsApp/call fires on amber/red.

**Honesty line if asked:** historical days are simulated seed data; today's check-in is live.

---

## Acceptance tests

| Case | Input | Expect |
|---|---|---|
| A · amber | pain returning + wound fine | amber · `recommend_doctor_review` |
| B · green | pain less + wound fine | green · `continue_monitoring` |
| C · red | wound red + chills / discharge | red · `escalate` |
