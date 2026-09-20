# Resilience

Ally calls someone's family when their mother might be lying on a floor. The interesting
question is not what it does when everything works — it is what it does when a dependency is
sick, and whether a human can tell the difference.

The rule underneath all of this: **degrade loudly, never silently**. If Amazon Bedrock is
unavailable the API returns `llm_unavailable` and the tablet says so. Nothing in this codebase
invents a reply, fakes a transcript, or reports an escalation that did not happen.

---

## 1. Layers, cheapest first

### Amazon Bedrock

| Layer | What it does | Where |
|---|---|---|
| Cross-region inference profile | The model id carries a `us.` prefix, so Bedrock itself spreads every request across the US regions before any of our code runs | `BEDROCK_MODEL_ID` |
| Adaptive retry | botocore / the AWS SDK retry throttles and 5xx with client-side rate limiting, not just backoff | `ally/llm/bedrock.py`, `backend/src/aws/clients.ts` |
| Whole-turn region failover | A turn that fails with a region-shaped error is retried in `BEDROCK_FAILOVER_REGION` | `ally/llm/bedrock.py`, `backend/src/services/bedrock.ts` |
| Circuit breaker | Four consecutive failures open the breaker for 20 s, so a dead region stops adding latency to every turn | `backend/src/aws/resilience.ts` |
| Explicit failure | Past all of that, the caller gets `llm_unavailable` and the UI shows it | `ally/core/errors.py` |

Failover only engages on errors that mean *this region cannot serve me*: `ThrottlingException`,
`ServiceUnavailableException`, `InternalServerException`, `ModelNotReadyException`,
`ModelTimeoutException`, connection resets, and any 429 or 5xx. A `ValidationException` is not
retried in a second region, because it would fail there too.

Every failover emits a CloudWatch `LLMFailover` metric. Three in five minutes raises an alarm —
that is the signal that the primary region is degraded, and it arrives before users notice.

### Amazon Transcribe and Amazon Polly

- Both sit behind their own circuit breakers. A sick Transcribe degrades the check-in to text
  chips; it does not stall the WebSocket turn behind a timeout.
- Polly's generative engine is not available in every region. When it answers
  `EngineNotSupportedException` the call is retried on `neural`, and the downgrade is logged
  rather than hidden.

### Amazon Connect and Amazon SNS

- Voice and SMS have separate breakers, so a sick Connect instance does not stop the SMS.
- `notifyContact` degrades voice → SMS rather than giving up on the contact.
- Anything that fails past its retries is written to an **Amazon SQS dead-letter queue**. A missed
  escalation becomes a queue depth with an alarm on it, not a log line nobody reads.

### AWS Step Functions

- STANDARD workflow, so every state transition is durable. A Lambda that dies mid-escalation does
  not lose the chain.
- Each hop is `waitForTaskToken` with a timeout: no reply advances to the next contact rather
  than hanging.
- Every state has a `Catch` onto a **Failsafe** branch that notifies everybody and releases the
  lock. The worst case is too many people being told, never nobody.
- A two-hour execution timeout bounds a chain that somehow stalls anyway.

### Data

- **Amazon DynamoDB** — on-demand capacity, point-in-time recovery on, `RETAIN` removal policy so
  a `cdk destroy` cannot take the table with it. **AWS Backup** keeps daily recovery points for 35
  days, which is what an accidental delete actually needs; PITR covers the rest.
- **Amazon Aurora Serverless v2** — credentials come from an RDS-managed secret in AWS Secrets
  Manager, so rotation needs no redeploy. The connection pool drops itself on an idle-client
  error, which is how a failover surfaces in `pg`; the next query reconnects to the promoted
  writer.

### Edge

- Amazon API Gateway throttles at 20 rps with a 40 burst. A runaway client is shed at the edge
  instead of exhausting a 10-execution Lambda concurrency budget.
- The JWT authorizer rejects unknown callers before Lambda is invoked at all.

---

## 2. Health endpoints

| Endpoint | Meaning | Who polls it |
|---|---|---|
| `GET /health` | Liveness. Always 200 while the process is up. | Load balancer target group, Route 53 health check |
| `GET /health/deep` | Readiness. Reports region, model, voice config and every circuit-breaker state. | Dashboards, pre-demo checks |

`/health/deep` returns 200 even when a breaker is open, and names the degraded dependencies in a
`degraded` array. That distinction matters: the app is *degraded*, not *down*, and a health check
that fails on a degraded dependency would take the whole service out of rotation over one sick
downstream.

```json
{
  "ok": true,
  "region": "us-east-1",
  "model": "us.amazon.nova-2-lite-v1:0",
  "voice": { "stt": "amazon-transcribe", "tts": "amazon-polly:Kajal:generative" },
  "breakers": { "bedrock": "closed", "polly": "closed", "transcribe": "half_open" },
  "degraded": ["transcribe"]
}
```

---

## 3. Alarms

Six CloudWatch alarms, all actioned onto the `ally-ops` SNS topic:

| Alarm | Threshold | What it means |
|---|---|---|
| `LlmErrorsAlarm` | 1 error / 5 min | Bedrock is failing in **both** regions |
| `LlmFailoverAlarm` | 3 failovers / 5 min | The primary region is degraded |
| `ApiErrorsAlarm` | 5 errors / 5 min | The API function is throwing |
| `EscalationFailuresAlarm` | 1 failure | A family escalation did not complete — someone may not have been contacted |
| `NotificationDlqAlarm` | 1 message | An alert could not be delivered |
| `WorkerDlqAlarm` | 1 message | A sweep failed; reminders and wake windows may be late |

The CloudWatch dashboard plots API p90 latency and errors, Bedrock latency with errors and
failovers side by side, Step Functions started/succeeded/failed, and both DLQ depths.

AWS X-Ray tracing is active on all three Lambda functions and on the state machine, so a slow
voice turn can be attributed to Transcribe, Bedrock or Polly rather than guessed at.

---

## 4. What is deliberately not resilient

Being honest about this is part of the design:

- **Ally is not an emergency service.** The family screen always shows 112. No amount of retry
  logic makes an app a substitute for an ambulance.
- **There is no fallback text.** A cached or canned reply that sounds like the model would be a
  lie told to someone who may be frightened. The UI says the assistant is unavailable instead.
- **Safety cannot be switched off.** Consent rules restrict what family may *know*. They never
  restrict what Ally may *do* when someone is in danger.
- **No multi-region active-active.** The data plane is single-region. Bedrock fails over because
  it is stateless; DynamoDB and Aurora do not, because a split-brain care record is worse than a
  regional outage. Recovery is PITR plus AWS Backup, and that trade is deliberate.
