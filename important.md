# Rakshak — Family PWA Spec

> **Status (implemented):** `/family` + `/family/:sessionId` live WebSocket view,
> `family_on_my_way` / `family_arrived` write path into the orchestrator (AI tells
> the patient), PWA manifest + icons + haptics. Amazon SNS alerts include the
> family deep link whenever a destination phone is configured.

Second frontend view for family members. Same React project, same WebSocket, same `SessionEvent`/`HandoffSummary` types as the Command Center dashboard — do not duplicate backend logic or create a new service. This is a new route/page only.

**Audience difference from the dashboard:** dashboard is for operators watching the whole event unfold (transcript, timeline, escalation chain). This is for one family member, on their phone, caring about exactly one thing: is my parent okay, and what do I do. Keep it sparse. No transcript, no timeline, no operator detail.

---

## 1. Make it feel like an app, not a webpage

- `manifest.json`: `"display": "standalone"`, custom name "Rakshak", theme/background colors matching the emergency card design. This alone removes the browser address bar when added to homescreen.
- Custom app icon (simple square PNG/SVG, red/urgent color, "R" or shield mark) referenced in the manifest — this is what shows up on the homescreen.
- Splash screen: handled by the manifest (`background_color` + icon), no extra code needed.
- `navigator.vibrate([200])` (or a short pattern) on both action button taps — real haptic feedback, works in Chrome/Android, no native code required.
- Route: `/family/:sessionId` — open this specific session, no login, no account. For the demo, either type the URL or scan a pre-generated QR code.

## 2. Screen 1 — Active Incident (the only real screen)

```
🚨 ACTIVE INCIDENT

Lakshmi Devi
AI is currently speaking to the patient   ← live text, updates from SessionEvent.state

━━━━━━━━━━━━━━━━━━━━━━━━
   ● HIGH RISK            ← color-coded severity badge, from HandoffSummary.severity
━━━━━━━━━━━━━━━━━━━━━━━━

Possible Hip Injury        ← HandoffSummary.condition
Conscious · Cannot Stand   ← HandoffSummary.symptoms

Family Notified            ← from escalation_chain status

┌────────────────────────┐
│      I'M ON MY WAY       │   ← large, full-width, tappable button
└────────────────────────┘
```

- Big typography, generous spacing, one clear focal point. No secondary navigation, no menu, no settings.
- All fields bind directly to the existing `SessionEvent`/`HandoffSummary` shape — reuse the same TypeScript types, do not redefine.
- "AI is currently speaking to the patient" line should reflect live `state` (`triaging` / `escalating` / `awaiting_handover`) in plain language, not raw state names.

## 3. Button behavior — this is the part that's actually new backend work

Right now the dashboard is read-only. This view **writes** state back, which the orchestrator doesn't yet support from a second client — build this deliberately, test it directly, don't leave it for last.

- **"I'm On My Way"** (visible during `escalating`/`awaiting_handover`):
  - Sends a WebSocket message / POST to orchestrator: mark the relevant `EscalationHop` as `acknowledged`.
  - Triggers haptic buzz + button morphs to a confirmed state.
  - Orchestrator relays this into the live AI conversation so the patient hears it acknowledged ("Your daughter's on her way").
- **"I've Arrived"** (replaces the above once tapped, or shown after a short delay for demo pacing):
  - Sends the `RESOLVED` transition to the orchestrator.
  - Triggers haptic buzz.
  - AI delivers its sign-off line to the patient ("I'm glad you're safe.").
  - Screen updates to a calm "Resolved" state — green, not red.

## 4. Explicitly skip

- Real push notifications (FCM/APNs) — not needed for a live demo, the phone is already open in your hand as part of the choreography.
- Login, accounts, multiple family members, contact management.
- Transcript view, timeline, anything operator-facing — that's the dashboard's job.
- A "Navigate" / Maps button unless there's spare time right at the end — cosmetic only, doesn't need to be functional, lowest priority in this doc.

## 5. Build order

1. Route + static layout matching Screen 1, wired to a mock `SessionEvent` first (no live data yet).
2. Connect to the real WebSocket, confirm live updates render correctly.
3. Wire "I'm On My Way" → orchestrator write path, confirm it reaches the AI conversation.
4. Wire "I've Arrived" → `RESOLVED` transition + sign-off.
5. Manifest, icon, splash, haptics — polish pass, last.
6. Test on an actual phone added to homescreen, not just desktop Chrome dev tools — standalone mode and vibration only really prove themselves on a real device.

Budget: this should not take longer than the original web Family View estimate. If step 3 (the write path) turns out to be harder than expected, that's the one thing worth protecting — the visual polish in step 5 is cheap and can be cut without losing the core beat.