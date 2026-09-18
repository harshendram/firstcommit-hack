# Ally

Family care for an aging parent, **without making her feel watched**.

> Most days, Ally says nothing at all. That's the point.

Amma (72, Bengaluru, speaks Hindi) talks to Ally on a tablet and wears a watch. Her children, Rahul (Pune) and Priya (Bengaluru), get a calm dashboard. They only get a push notification when something is actually wrong. Amma decides what they may know, by voice.

## What it does

| Moment | What happens | AWS / open source |
|---|---|---|
| First movement of the day | The watch posts `wake`; Ally speaks a ≤3-sentence morning check-in grounded only in real data; "after I wake up" reminders are scheduled | Lambda · DynamoDB · Bedrock Nova 2 Lite · Polly Kajal |
| Amma talks | Sarvam STT → Strands companion agent with tools → typed `CompanionReply` → Polly Kajal speaks | Strands Agents · Bedrock |
| "Priya ko meri tabiyat ke baare mein mat batana" | The tool renders a **Cedar** `forbid` rule from a fixed template (the model never writes Cedar); Amma confirms with हाँ | Cedar (`cedarpy`) |
| Any tool call | A Strands `BeforeToolCallEvent` hook asks Cedar first; every allow/deny is written to an audit log Amma can read | Strands hooks · Cedar · DynamoDB |
| Not up by her usual time | The one-minute sweep opens an investigation and asks **Amma first** | EventBridge · Lambda |
| No reply, or she says she's unwell | A deterministic gate → LLM judge (severity + confidence) → tier policy in code | Bedrock |
| Family escalation | Rahul → timeout → Priya → ask Amma about the neighbour → neighbour only if Cedar allows; replies come back from notification buttons | **Step Functions** `waitForTaskToken` · Web Push |
| Family asks "Did she sleep okay?" | Answers only from records returned by tools this turn, or "not sure" / "private" | Strands · Cedar |

## Architecture

```
Amplify (Next.js) ── Cognito ── API Gateway HTTP API (JWT)
                                   │
                   Lambda (FastAPI + Lambda Web Adapter, container)
                     ├─ Strands agents → Bedrock Nova 2 Lite (inference profile)
                     ├─ ConsentGuard hook → Cedar → audit log
                     ├─ Sarvam STT · Polly Kajal TTS
                     └─ DynamoDB single table (one item per fact)
EventBridge (1 min) → Lambda worker: reminders · wake window · investigation timeouts
Step Functions (STANDARD): ask child → timeout → next → parent → neighbour → notify all (failsafe)
Web Push (VAPID keys in Secrets Manager) → family phones & Amma's tablet
Wear OS watch → POST /ally/watch (device key)
```

**Design rules:**
- No silent fallbacks. If Bedrock fails, the API returns `llm_unavailable` and the UI says so.
- The model decides language and judgement; code decides actions.
- Safety can't be switched off; conversations are never shared.
- Only history before today is simulated and labelled. Today is live.

## Local development

```powershell
cd ally
python -m venv .venv; .venv\Scripts\activate
pip install -r requirements-dev.txt
copy .env.example .env        # set SARVAM_API_KEY; ALLY_DEV_TOOLS=1 enables the dev identity switcher
python -m pytest -q           # 48 offline tests (moto DynamoDB, no network)
python scripts\smoke_bedrock.py   # live Bedrock check: every schema, exits non-zero on failure
uvicorn app:app --reload --port 8002
```

Local runs use a real DynamoDB table named by `ALLY_TABLE` (create it with the stack, or run DynamoDB Local).

```powershell
cd web; copy .env.local.example .env.local; npm install; npm run dev
```

Pages:
- `/parent`: Amma's tablet
- `/parent/privacy`: what Ally shared about her
- `/home`: family dashboard
- `/family/respond/[id]`: where a push notification lands
- `/command`: timeline

## Deployed

| Piece | Where |
|---|---|
| Web app | https://main.d2dqtm6sqego9a.amplifyapp.com (Amplify Hosting, auto-builds on push to `main`) |
| API | https://6cuto4692g.execute-api.us-east-1.amazonaws.com |
| Sign-in | Cognito pool `us-east-1_labF3UJsJ`; users `amma`, `rahul`, `priya`, `sunita` |
| Secrets | AWS Secrets Manager, one bundle: `ally/runtime` |
| Data | DynamoDB `Ally` (single table) |

## Deploy

Prerequisites: Docker Desktop, AWS CLI v2, CDK CLI, Bedrock access for Nova 2 Lite, and `SARVAM_API_KEY` in the root `.env`.

```powershell
.\scripts\deploy.ps1 -SeedPassword "<family password>"
```

The script runs the tests, writes the Secrets Manager bundle, deploys the stack, seeds Amma and the family, and prints the frontend settings. The frontend redeploys itself whenever you push to `main`.

Before a rehearsal, clear the day: `python ally/scripts/reset_day.py --yes` (keeps profile, family, consent rules, audit log and the simulated history).

For filming, shorten timings with `-c escalationContactTimeout=60 -c investigationWindowMin=2`. These are real settings, not a scripted demo.

## Cost notes
- DynamoDB on-demand, Step Functions Standard (a handful of transitions per escalation), and EventBridge are pennies.
- Nova 2 Lite is billed per token; the judge only runs behind the deterministic gate.
- Images are x86_64 (this build machine's Docker engine); `-c architecture=arm64` switches to cheaper Graviton where an arm64 builder is available.
- Provisioned and reserved concurrency are off, because a new account's total Lambda concurrency is 10 and AWS rejects reservations below that. After a quota increase, `-c provisionedConcurrency=1` removes cold starts on voice turns (about $0.60/day).

## Limitations
- Ally is not an emergency service. The family screen always shows 112.
- iOS web push requires the app installed to the home screen and has no action buttons; the respond page covers it.
