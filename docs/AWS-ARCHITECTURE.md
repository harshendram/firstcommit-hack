# AWS architecture

Every managed service in this repository is reached through the AWS SDK with the standard
credential chain: an IAM role when deployed, `aws configure` or SSO locally. There are no
third-party API keys, no proxy services and no webhook tunnels anywhere in the stack.

The whole thing is defined in [`infra/`](../infra) as AWS CDK (Python). `cdk synth` produces
**63 CloudFormation resources across 17 AWS services**.

---

## 1. Service map

| Layer | Service | Where it lives |
|---|---|---|
| Hosting | **AWS Amplify Hosting** | `amplify.yml` — builds `web/` on push to `main` |
| Identity | **Amazon Cognito** user pool + groups (`parent`, `family`) | `infra/ally_stack.py` |
| Edge | **Amazon API Gateway** HTTP API, JWT authorizer, per-route throttling | `infra/ally_stack.py` |
| Compute | **AWS Lambda** — three container functions (API, worker, escalation step) | `ally/Dockerfile` |
| Reasoning | **Amazon Bedrock** — Amazon Nova via cross-region inference profile | `ally/llm/bedrock.py`, `backend/src/services/bedrock.ts` |
| Agents | **Strands Agents** with Bedrock tool use and `BeforeToolCallEvent` hooks | `ally/agents/` |
| Speech in | **Amazon Transcribe** streaming, en-IN / hi-IN identification | `ally/voice/transcribe.py`, `backend/src/services/speech.ts` |
| Speech out | **Amazon Polly** — Kajal, generative engine with neural fallback | `ally/voice/speech.py`, `backend/src/services/speech.ts` |
| Documents | **Amazon Textract** (TABLES + FORMS) | `backend/src/services/documentDigitisation.ts` |
| Clinical NLP | **Amazon Comprehend Medical** `DetectEntitiesV2` | same file |
| Key-value data | **Amazon DynamoDB** single table + GSI, PITR on | `ally/store/repo.py` |
| Relational data | **Amazon Aurora Serverless v2** (PostgreSQL) | `backend/src/db/pool.ts` |
| Objects | **Amazon S3** — discharge PDFs, staged call audio | `backend/src/services/callAudioStore.ts` |
| Workflow | **AWS Step Functions** STANDARD, `waitForTaskToken` | `infra/escalation_asl.py` |
| Schedule | **Amazon EventBridge** — one-minute sweep | `infra/ally_stack.py` |
| SMS | **Amazon SNS** — transactional publish + ops topic | `backend/src/services/notifications.ts` |
| Voice calls | **Amazon Connect** — `StartOutboundVoiceContact` | same file |
| Durability | **Amazon SQS** — dead-letter queues | `infra/ally_stack.py` |
| Secrets | **AWS Secrets Manager** — one bundle, RDS-managed Aurora password | `ally/core/secrets.py` |
| Backup | **AWS Backup** — daily DynamoDB recovery points, 35-day retention | `infra/ally_stack.py` |
| Authorization | **Cedar** policies evaluated per tool call | `ally/policy/` |
| Observability | **Amazon CloudWatch** metrics, 6 alarms, dashboard; **AWS X-Ray** traces | `infra/ally_stack.py` |

---

## 2. Request path — one voice turn

```
Amma taps the mic on the tablet
   │
   │  16 kHz mono PCM16 WAV (web/src/lib/recordWav.ts)
   ▼
Amazon CloudFront + AWS Amplify Hosting  ──►  Amazon Cognito (ID token)
   │
   ▼
Amazon API Gateway (HTTP API)  ── JWT authorizer, 20 rps / 40 burst
   │
   ▼
AWS Lambda — FastAPI behind the Lambda Web Adapter
   │
   ├─► Amazon Transcribe Streaming     audio → text, en-IN / hi-IN identified per clip
   │
   ├─► Strands Agent → Amazon Bedrock (Amazon Nova)
   │      ├─ ConsentGuard hook → Cedar decision → audit item in DynamoDB
   │      └─ tools read only from Amazon DynamoDB
   │
   ├─► Amazon Polly (Kajal, generative)   text → MP3
   │
   └─► Amazon DynamoDB                    one item per fact
```

No step in that chain is a third-party call. The only bytes that leave AWS are the audio
returned to the browser.

---

## 3. Escalation path

```
Deviation detected (one-minute Amazon EventBridge sweep → AWS Lambda worker)
   │
   ▼
Deterministic gate  →  Amazon Bedrock judge (severity + confidence)  →  tier policy in code
   │
   ▼
AWS Step Functions (STANDARD)   ── one execution per investigation
   │
   ├─ Ask child 1      Lambda .waitForTaskToken, timeout → next
   ├─ Ask child 2      same
   ├─ Ask the parent about the neighbour
   ├─ Neighbour        only if Cedar allows
   └─ Failsafe         notify everyone, release the lock
   │
   ├─► Web Push (VAPID keys in AWS Secrets Manager) → family phones
   ├─► Amazon SNS      transactional SMS, mirrored to the ops topic
   └─► Amazon Connect  outbound call; the contact flow plays a Polly clip staged in
                       Amazon S3 and captures "press 1", posting the acknowledgement
                       back through Amazon API Gateway
   │
   └─► anything undeliverable → Amazon SQS dead-letter queue → CloudWatch alarm
```

`waitForTaskToken` is what makes the chain honest: the state machine is genuinely parked
waiting for a human, not polling a timer. A reply from a push notification button, an SMS,
or the "press 1" callback all resolve the same token.

---

## 4. Document intelligence

A discharge PDF arrives on `/api/profiles/discharge`:

1. Under 5 MB it goes straight to **Amazon Textract** `AnalyzeDocument` with the `TABLES` and
   `FORMS` features — plain OCR flattens medication tables into unusable prose, these keep the
   structure.
2. Over 5 MB it is written to **Amazon S3** and run through `StartDocumentAnalysis`, polled to
   completion.
3. The extracted text goes to **Amazon Comprehend Medical** `DetectEntitiesV2`, which names
   medications, dosages, conditions and procedures. Entities below 0.75 confidence are dropped —
   a wrong medication name in the agent's context is worse than a missing one.
4. The combined text plus the structured entity block becomes the care context the agent reads.

---

## 5. Identity and authorization

Two independent layers, and both have to say yes:

- **Amazon Cognito** answers *who is this*. The HTTP API's JWT authorizer rejects an unknown
  caller at the edge, before Lambda is ever invoked. Custom attributes (`parent_id`, `member_id`)
  carry the family relationship.
- **Cedar** answers *may they know this*. A Strands `BeforeToolCallEvent` hook evaluates every
  single tool call against policies Amma sets by voice. The model never writes Cedar — a tool
  renders a `forbid` rule from a fixed template and Amma confirms it aloud. Every allow and every
  deny is written to an audit log she can read.

---

## 6. Local development

The SDK clients are the real ones. Only the endpoint changes:

```bash
# Real AWS (default) — leave AWS_ENDPOINT_URL unset
npm --prefix backend run smoke:aws

# Local stack
AWS_ENDPOINT_URL=http://localhost:4566 npm --prefix backend run dev
```

`AWS_ENDPOINT_URL` is read once in `backend/src/aws/clients.ts` and applied to every client.
Nothing else in the codebase knows or cares which of the two it is talking to.

For a no-network rehearsal, `OFFLINE_AI=true` and `OFFLINE_SPEECH=true` swap in deterministic
clients that follow the same escalation rules, so the acceptance tests still mean something.

---

## 7. Cost

| Service | Shape | Demo cost |
|---|---|---|
| Amazon Bedrock (Nova) | per token; the judge only runs behind the deterministic gate | cents per rehearsal |
| Amazon Transcribe | per second of audio; clips are capped at 12 s | cents |
| Amazon Polly | per character, generative tier | cents |
| Amazon DynamoDB | on-demand | pennies |
| AWS Step Functions | STANDARD, a handful of transitions per escalation | pennies |
| Amazon EventBridge | one rule, per minute | pennies |
| AWS Lambda | ARM64 (Graviton), no provisioned concurrency by default | pennies |
| Amazon Connect | per minute of outbound call, plus the claimed number | the only meaningful line item |

Images build for ARM64 by default; `-c architecture=x86_64` switches back where no arm64 Docker
builder is available. Provisioned concurrency is off because a new account's total Lambda
concurrency is 10 and AWS rejects reservations below that — after a quota increase,
`-c provisionedConcurrency=1` removes cold starts on voice turns.
