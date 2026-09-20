/**
 * One place that builds every AWS SDK client.
 *
 * Everything shares the same credential chain, the same adaptive retry policy and
 * the same keep-alive connection pool, so a cold Lambda or a long-lived container
 * both behave the same way. `AWS_ENDPOINT_URL` is honoured for local stacks
 * (LocalStack / `sam local`) — when it is unset the SDK resolves the real
 * regional endpoint, which is what the deployed stack does.
 */

import { Agent } from "node:https";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { ComprehendMedicalClient } from "@aws-sdk/client-comprehendmedical";
import { ConnectClient } from "@aws-sdk/client-connect";
import { PollyClient } from "@aws-sdk/client-polly";
import { S3Client } from "@aws-sdk/client-s3";
import { SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";
import { TextractClient } from "@aws-sdk/client-textract";
import { TranscribeStreamingClient } from "@aws-sdk/client-transcribe-streaming";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { config } from "../config.js";

/** Reusing TLS sessions is the single biggest latency win on a voice turn. */
const keepAlive = new Agent({
  keepAlive: true,
  maxSockets: 64,
  keepAliveMsecs: 15_000,
});

const requestHandler = new NodeHttpHandler({
  httpsAgent: keepAlive,
  connectionTimeout: 3_000,
  requestTimeout: 25_000,
});

/**
 * `adaptive` adds client-side rate limiting on top of standard backoff, which is
 * what keeps Bedrock and Transcribe usable when a demo hammers them in bursts.
 */
export function awsBase(region = config.aws.region) {
  return {
    region,
    maxAttempts: config.aws.maxAttempts,
    retryMode: "adaptive" as const,
    requestHandler,
    ...(config.aws.endpoint ? { endpoint: config.aws.endpoint } : {}),
  };
}

function memo<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= build());
}

export const bedrock = memo(() => new BedrockRuntimeClient(awsBase(config.aws.bedrockRegion)));

/** Second region for the same model — see `services/bedrock.ts` failover. */
export const bedrockFailover = memo(
  () => new BedrockRuntimeClient(awsBase(config.aws.bedrockFailoverRegion))
);

export const polly = memo(() => new PollyClient(awsBase()));
export const transcribeStreaming = memo(() => new TranscribeStreamingClient(awsBase()));
export const textract = memo(() => new TextractClient(awsBase()));
export const comprehendMedical = memo(() => new ComprehendMedicalClient(awsBase()));
export const sns = memo(() => new SNSClient(awsBase()));
export const sqs = memo(() => new SQSClient(awsBase()));
export const connect = memo(() => new ConnectClient(awsBase()));
export const s3 = memo(
  () =>
    new S3Client({
      ...awsBase(),
      // Path style only matters against a local endpoint; real S3 uses virtual hosts.
      forcePathStyle: Boolean(config.aws.endpoint),
    })
);

/** Human-readable line for the boot banner. */
export function awsSummary(): string {
  const where = config.aws.endpoint ? `endpoint=${config.aws.endpoint}` : "regional endpoints";
  return `${config.aws.region} · ${where}`;
}
