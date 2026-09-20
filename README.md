# Suraksha

**Family care for an aging parent — without watching her.**

![Next.js](https://img.shields.io/badge/Next.js-15-black)
![AWS](https://img.shields.io/badge/AWS-Ship%20it-orange)
![Bedrock](https://img.shields.io/badge/Amazon-Bedrock-purple)
![Wear%20OS](https://img.shields.io/badge/Wear%20OS-Galaxy-blue)
![Cedar](https://img.shields.io/badge/Policy-Cedar-green)

> Most days, Suraksha says nothing at all. That’s the point.

Suraksha is a **hardware-first, agentic companion** for aging at home: Galaxy Watch + tablet voice + long-term memory + proactive care + consent-aware family escalation — built to **ship on AWS**.

Amma (72, Bengaluru) wears the watch and talks to Suraksha in Hindi or Hinglish. Rahul and Priya get a calm family view. They are notified only when something is actually wrong — and only the person who can show up is asked first.

**Build story + architecture diagram:** [`docs/suraksha-build-story.md`](docs/suraksha-build-story.md) · [`docs/suraksha-aws-architecture.png`](docs/suraksha-aws-architecture.png)  
**API / agent runbook:** [`ally/README.md`](ally/README.md)

---

## The problem

Adult children living in another city do not need a live feed of their parent’s day. Cameras and always-on dashboards steal independence. Silence leaves families guessing. Panic buttons only help if she can reach them and wants to press them.

Suraksha sits in between: it learns what is normal for Amma, talks to **her** first, remembers what she asked for, enforces what she said to keep private, and only then coordinates the person who can actually help.

---

## Who it’s for

| Who | What they get |
| --- | --- |
| **Parent (Amma)** | Watch + tablet companion; speak a task; almost no learning curve |
| **Family (Rahul, Priya)** | Calm home/command views; push only when needed; one-tap respond |
| **Nearby help (optional)** | Guard / neighbour path only if Cedar allows |

Suraksha is **not** an emergency service replacement. Family screens always surface **112**.

---

## What Suraksha does

| Capability | Detail |
| --- | --- |
| **Agentic voice companion** | Speak a task — reminders, check-ins, errands, health notes, consent. Tools run; it doesn’t only chat. |
| **All-in-one memory** | DynamoDB single-table facts: day log, mood, alerts, reminders, consent, audit — not a disposable chat blob. |
| **Hardware-first** | Galaxy Wear OS: wake, vitals, fall. Tablet for conversation. Put it on, talk. |
| **Fall detection** | Watch signals open investigation / scripts; family chain only after policy and judgement. |
| **Proactive care** | EventBridge every minute: due reminders, wake-window misses, investigation timeouts. |
| **Ask her first** | Missed wake or worrying signal → Suraksha checks in with Amma before looping family. |
| **Consent that blocks tools** | Spoken privacy rules → Cedar templates → `ConsentGuard` on every tool call; audit she can read. |
| **Evidence-only family Q&A** | “Did she sleep okay?” → answers only from tool-returned records, or not sure / private. |
| **Family escalation** | Step Functions: Rahul → timeout → Priya → ask about neighbour → neighbour if allowed → failsafe notify-all. |
| **Quiet by design** | Most days: no noise. Engagement is not the goal. |
| **Explore world (demo)** | 3D wardstone / gallery experience for storytelling and AWS gallery beats. |

### Example moments

| Moment | What happens | AWS |
| --- | --- | --- |
| First movement of the day | Watch posts `wake`; short morning check-in; “after I wake” reminders schedule | Lambda · DynamoDB · Bedrock · Polly |
| Amma speaks a task | Transcribe → companion agent + tools → typed reply → Polly speaks | Transcribe · Bedrock · Polly |
| “Don’t tell Priya about my health” | Fixed Cedar `forbid` template; she confirms; tools blocked thereafter | Cedar · DynamoDB audit |
| Not up by usual time | Worker opens investigation; asks Amma first | EventBridge · Lambda |
| Fall / unwell / no reply | Gate → Bedrock judge → tier policy in code | Bedrock · DynamoDB |
| Family needed | Step Functions callbacks + Web Push accept/decline | Step Functions · Secrets Manager |
| Family asks a question | Family Q&A agent; Cedar principal = asker | Bedrock · Cedar · DynamoDB |

---

## Architecture (AWS-first)

![Suraksha on AWS](docs/suraksha-aws-architecture.png)

```
Wear OS / Parent tablet / Family web
        │
   AWS Amplify (Next.js) ── Amazon Cognito (JWT)
        │
   Amazon API Gateway HTTP API
        │  JWT for people · device key for watch
        ▼
   AWS Lambda (containers via Amazon ECR)
        ├─ API  — FastAPI · companion · scripts · handoff
        ├─ Worker — proactive sweep
        └─ Escalation — Step Functions tasks
             │
             ├─ Amazon Bedrock (Nova 2 Lite) — agents + judge
             ├─ Amazon Transcribe — streaming STT
             ├─ Amazon Polly — neural TTS
             ├─ Cedar ConsentGuard — before every tool
             └─ Amazon DynamoDB — single-table memory
   Amazon EventBridge (1 min) → Worker
   AWS Step Functions → family chain (waitForTaskToken)
   AWS Secrets Manager · KMS · CloudWatch · CloudTrail
```

**Design rules**

- No silent LLM fallbacks — Bedrock failure → `llm_unavailable` in the UI.
- The model decides language and judgement; **code** decides actions.
- Safety cannot be switched off; conversations are never shared as a feed.
- History before today may be simulated and labelled; **today is live**.

---

## AWS services

| Layer | Services |
| --- | --- |
| Edge | Galaxy Wear OS · parent/family web |
| Presentation | **AWS Amplify Hosting** |
| Identity | **Amazon Cognito** (parent / family groups, custom attributes) |
| Edge API | **Amazon API Gateway** HTTP API (JWT + public device routes, throttling) |
| Compute | **AWS Lambda** (API, worker, escalation) · **Amazon ECR** |
| IaC | **AWS CDK** → **AWS CloudFormation** |
| Agents | **Amazon Bedrock** (Nova 2 Lite inference profile) · Strands-style tools |
| Voice | **Amazon Transcribe** (STT) · **Amazon Polly** (TTS) |
| Memory | **Amazon DynamoDB** (single table, GSI for due reminders, PITR, TTL) |
| Policy | **Cedar** ConsentGuard + DynamoDB audit |
| Secrets | **AWS Secrets Manager** (`ally/runtime`) · **AWS KMS** |
| Proactive | **Amazon EventBridge** (rate: 1 minute) |
| Escalation | **AWS Step Functions** Standard (`waitForTaskToken`) · Web Push (VAPID) |
| Ops | **Amazon CloudWatch** (logs, metrics, alarms, dashboard) · **AWS CloudTrail** |
| Access | **AWS IAM** least-privilege roles per function |

Deep dive: [`docs/suraksha-build-story.md`](docs/suraksha-build-story.md).

---

## Product surfaces (web)

| Route | Audience | Purpose |
| --- | --- | --- |
| `/` | Everyone | Landing — problem, how it works, architecture, watch story |
| `/parent` | Amma | Tablet companion — talk, tasks, check-ins |
| `/parent/privacy` | Amma | What was shared; consent / audit |
| `/home` | Family | Calm family dashboard |
| `/command` | Family | Timeline / command center |
| `/family/respond/[id]` | Family | Push landing — accept / decline escalation |
| `/guard` | Nearby help | Guard handset surface |
| `/explore` | Demo | 3D wardstone / gallery world |

---

## Repository layout

```
ally/          Agentic API — agents, policy (Cedar), scoring, store, escalation,
               proactive, voice, Lambda handlers, tests
web/           Next.js — landing, parent, family, command, guard, explore
infra/         AWS CDK — DynamoDB, Cognito, API Gateway, Lambda, EventBridge,
               Step Functions, IAM, CloudWatch
wear-os/       Kotlin · Compose — watch UI, fall / wake / vitals, AudioBridge
docs/          Build story + architecture diagram
scripts/       Deploy / secrets helpers
backend/       Legacy Rakshak plumbing (optional reference; not the Suraksha path)
```

---

## Deployed (Ship it)

| Piece | Where |
| --- | --- |
| Web | Amplify Hosting (auto-build on `main`) |
| API | API Gateway → Lambda containers |
| Auth | Cognito user pool (demo users: `amma`, `rahul`, `priya`, …) |
| Secrets | Secrets Manager bundle `ally/runtime` |
| Data | DynamoDB table `Ally` (single-table memory) |

Exact URLs and pool IDs: see [`ally/README.md`](ally/README.md) (environment-specific).

---

## Local development

### Prerequisites

- Node.js 20+
- Python 3.11+
- AWS credentials with access to DynamoDB / Bedrock (for live agent turns)
- Docker (for image builds / deploy)
- Optional: Android Studio + Galaxy Watch 4+ for Wear OS

### Agent API (`ally/` · port `8002`)

```powershell
cd ally
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
copy .env.example .env
python -m pytest -q
python scripts\smoke_bedrock.py
uvicorn app:app --reload --port 8002
```

### Web (`web/` · port `3000`)

```powershell
cd web
copy .env.local.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) · `/parent` · `/home` · `/command`.

### Deploy to AWS

```powershell
.\scripts\deploy.ps1 -SeedPassword "<family password>"
```

Runs tests, writes the Secrets Manager bundle, deploys the CDK stack, seeds the family, prints frontend settings. Demo timings (real parameters, not fakes):

```powershell
.\scripts\deploy.ps1 -SeedPassword "<password>" -c escalationContactTimeout=60 -c investigationWindowMin=2
```

Reset a demo day (keeps profile, family, consent, audit, labelled history):

```powershell
python ally/scripts/reset_day.py --yes
```

### Wear OS

See [`wear-os/README.md`](wear-os/README.md). Watch posts to the API watch route with the device key from Secrets Manager. Sensor path (fall / wake / vitals) is shown in the submission video when a physical watch is required.

---

## Team

| Member | Ownership |
| --- | --- |
| **Harshendra** | Agents, Cedar/consent, judge & scoring, Bedrock path, family web (`/home`, `/command`, respond) |
| **Shashwath** | Store, escalation, proactive, CDK / Step Functions / deploy, Wear OS plumbing, `/guard` |
| **Paccmann** | Watch UI & speech, voice/language, parent web & UI/i18n |

Explore / wardstone world: shared equally.

---

## Limitations

- Not a medical device, EMR, or replacement for emergency services.
- iOS web push may require home-screen install; respond page covers action buttons.
- New AWS accounts may be limited to Lambda concurrency 10 (provisioned concurrency deferred until quota increase).
- Physical watch sensors cannot be fully emulated in the browser — wearable flow is in the submission video.

---

## License / hackathon

Built for an AWS Ship it–style submission. Demo-oriented. Use responsibly; always keep human emergency numbers visible to family.
