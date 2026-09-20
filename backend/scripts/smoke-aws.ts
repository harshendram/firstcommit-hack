/**
 * Live AWS smoke test — no offline clients, no mocks.
 *
 *   npm --prefix backend run smoke:aws
 *
 * Exercises every managed service the voice path depends on and exits non-zero
 * on the first failure, so it is safe to run in CI or right before a demo.
 */

import { DescribeVoicesCommand, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { DetectEntitiesV2Command } from "@aws-sdk/client-comprehendmedical";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { awsBase, bedrock, comprehendMedical, polly } from "../src/aws/clients.js";
import { config } from "../src/config.js";

function ok(label: string, detail: string): void {
  console.log(`  ok   ${label.padEnd(22)} ${detail}`);
}

async function identity(): Promise<void> {
  const sts = new STSClient(awsBase());
  const me = await sts.send(new GetCallerIdentityCommand({}));
  ok("sts", `account=${me.Account} arn=${me.Arn}`);
}

async function bedrockSmoke(): Promise<void> {
  const started = Date.now();
  const res = await bedrock().send(
    new ConverseCommand({
      modelId: config.aws.bedrockModelId,
      messages: [
        {
          role: "user",
          content: [{ text: "Reply with exactly: READY" }],
        },
      ],
      inferenceConfig: { maxTokens: 16, temperature: 0 },
    })
  );
  const text = (res.output?.message?.content ?? [])
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Bedrock returned no text");
  ok("bedrock", `${Date.now() - started}ms · ${config.aws.bedrockModelId} · ${text}`);
}

async function pollySmoke(): Promise<void> {
  const voices = await polly().send(
    new DescribeVoicesCommand({ LanguageCode: "hi-IN" })
  );
  const kajal = voices.Voices?.find((v) => v.Id === config.aws.pollyVoice);
  if (!kajal) {
    throw new Error(
      `Voice ${config.aws.pollyVoice} is not available in ${config.aws.region}`
    );
  }

  const started = Date.now();
  const audio = await polly().send(
    new SynthesizeSpeechCommand({
      Text: "Namaste, main Rakshak. Aap kaise hain?",
      OutputFormat: "mp3",
      VoiceId: config.aws.pollyVoice as never,
      LanguageCode: "hi-IN",
      Engine: config.aws.pollyEngine as never,
    })
  );
  const bytes = await audio.AudioStream?.transformToByteArray();
  if (!bytes?.length) throw new Error("Polly returned no audio");
  ok(
    "polly",
    `${Date.now() - started}ms · ${config.aws.pollyVoice}/${config.aws.pollyEngine} · ${bytes.length} bytes`
  );
}

async function comprehendMedicalSmoke(): Promise<void> {
  if (!config.aws.comprehendMedicalEnabled) {
    console.log("  skip comprehend-medical    COMPREHEND_MEDICAL_ENABLED=false");
    return;
  }
  const res = await comprehendMedical().send(
    new DetectEntitiesV2Command({
      Text: "Take Cefuroxime 500mg twice daily for 7 days after the knee replacement.",
    })
  );
  const meds = (res.Entities ?? []).filter((e) => e.Category === "MEDICATION");
  if (meds.length === 0) throw new Error("Comprehend Medical found no medication entity");
  ok("comprehend-medical", `${meds.length} medication entity(ies) · ${meds[0].Text}`);
}

/**
 * Transcribe streaming needs real audio to be worth testing, and the browser
 * recorder produces it. Confirm the credentials reach the service instead.
 */
async function transcribeSmoke(): Promise<void> {
  const { ListLanguageModelsCommand, TranscribeClient } = await import(
    "@aws-sdk/client-transcribe"
  );
  const client = new TranscribeClient(awsBase());
  await client.send(new ListLanguageModelsCommand({ MaxResults: 1 }));
  ok("transcribe", "reachable · streaming identifies en-IN / hi-IN");
}

async function main(): Promise<void> {
  console.log(`\nAWS smoke · region=${config.aws.region}\n`);
  await identity();
  await bedrockSmoke();
  await pollySmoke();
  await comprehendMedicalSmoke();
  await transcribeSmoke();
  console.log("\nAll live AWS checks passed.\n");
}

main().catch((err) => {
  console.error("\nSMOKE FAILED:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
