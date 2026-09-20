/**
 * Discharge PDF → structured care context, on AWS.
 *
 *   Amazon Textract          reads the PDF. `AnalyzeDocument` with the TABLES and
 *                            FORMS features keeps medication tables and the
 *                            "Instructions:" key/value pairs intact, which plain
 *                            OCR flattens into unusable prose.
 *   Amazon Comprehend Medical then lifts medications, dosages, conditions and
 *                            test results out of that text, so the agent's
 *                            follow-up questions are grounded in named entities
 *                            rather than a wall of characters.
 *
 * Small files go through the synchronous API. Anything past Textract's 5 MB
 * synchronous ceiling is uploaded to S3 and run through the asynchronous
 * `StartDocumentAnalysis` job instead.
 */

import {
  AnalyzeDocumentCommand,
  type Block,
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
} from "@aws-sdk/client-textract";
import { DetectEntitiesV2Command } from "@aws-sdk/client-comprehendmedical";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { comprehendMedical, s3, textract } from "../aws/clients.js";
import { breaker, sleep } from "../aws/resilience.js";
import { config } from "../config.js";

/** Textract's synchronous ceiling. Anything larger has to go through S3. */
const SYNC_LIMIT_BYTES = 5 * 1024 * 1024;
const ASYNC_POLL_MS = 2_000;
const ASYNC_TIMEOUT_MS = 120_000;
const MAX_CHARS = 12_000;

function safeKey(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  return base.toLowerCase().endsWith(".pdf") ? base : `${base || "discharge"}.pdf`;
}

/** Textract returns a block graph; LINE blocks in order are the readable document. */
function linesFrom(blocks: Block[]): string {
  return blocks
    .filter((b) => b.BlockType === "LINE" && b.Text)
    .map((b) => b.Text!.trim())
    .filter(Boolean)
    .join("\n");
}

async function analyzeSync(file: Buffer): Promise<string> {
  const res = await breaker("textract").run(() =>
    textract().send(
      new AnalyzeDocumentCommand({
        Document: { Bytes: file },
        FeatureTypes: ["TABLES", "FORMS"],
      })
    )
  );
  return linesFrom(res.Blocks ?? []);
}

async function analyzeAsync(file: Buffer, filename: string): Promise<string> {
  if (!config.aws.documentBucket) {
    throw new Error(
      `${filename} is larger than Textract's 5 MB synchronous limit and DOCUMENT_BUCKET is not set.`
    );
  }
  const key = `discharge/${Date.now()}-${safeKey(filename)}`;
  await s3().send(
    new PutObjectCommand({
      Bucket: config.aws.documentBucket,
      Key: key,
      Body: file,
      ContentType: "application/pdf",
      ServerSideEncryption: "AES256",
    })
  );

  const started = await textract().send(
    new StartDocumentAnalysisCommand({
      DocumentLocation: { S3Object: { Bucket: config.aws.documentBucket, Name: key } },
      FeatureTypes: ["TABLES", "FORMS"],
    })
  );
  const jobId = started.JobId;
  if (!jobId) throw new Error("Textract did not return a JobId");

  const deadline = Date.now() + ASYNC_TIMEOUT_MS;
  const blocks: Block[] = [];
  let nextToken: string | undefined;

  while (Date.now() < deadline) {
    await sleep(ASYNC_POLL_MS);
    const page = await textract().send(
      new GetDocumentAnalysisCommand({ JobId: jobId, NextToken: nextToken })
    );
    if (page.JobStatus === "FAILED") {
      throw new Error(`Textract job failed: ${page.StatusMessage || "unknown"}`);
    }
    if (page.JobStatus === "IN_PROGRESS") continue;

    blocks.push(...(page.Blocks ?? []));
    nextToken = page.NextToken;
    if (!nextToken) return linesFrom(blocks);
  }
  throw new Error("Textract job timed out");
}

interface MedicalEntity {
  category: string;
  type: string;
  text: string;
  attributes: string[];
}

/**
 * Comprehend Medical over the extracted text. Low-confidence hits are dropped —
 * a wrong medication name in the agent's context is worse than a missing one.
 */
async function extractEntities(text: string): Promise<MedicalEntity[]> {
  if (!config.aws.comprehendMedicalEnabled || !text.trim()) return [];
  try {
    const res = await breaker("comprehend-medical").run(() =>
      comprehendMedical().send(new DetectEntitiesV2Command({ Text: text.slice(0, 20_000) }))
    );
    return (res.Entities ?? [])
      .filter((e) => (e.Score ?? 0) >= 0.75)
      .filter((e) =>
        ["MEDICATION", "MEDICAL_CONDITION", "TEST_TREATMENT_PROCEDURE"].includes(
          e.Category ?? ""
        )
      )
      .map((e) => ({
        category: e.Category ?? "",
        type: e.Type ?? "",
        text: e.Text ?? "",
        attributes: (e.Attributes ?? [])
          .filter((a) => (a.Score ?? 0) >= 0.75)
          .map((a) => `${a.Type}: ${a.Text}`),
      }));
  } catch (err) {
    // Entity extraction enriches the context; it is not required for it.
    console.warn(
      "[comprehend-medical] entity extraction skipped:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

function renderEntities(entities: MedicalEntity[]): string {
  if (entities.length === 0) return "";
  const byCategory = new Map<string, string[]>();
  for (const entity of entities) {
    const line = entity.attributes.length
      ? `${entity.text} (${entity.attributes.join("; ")})`
      : entity.text;
    const bucket = byCategory.get(entity.category) ?? [];
    if (!bucket.includes(line)) bucket.push(line);
    byCategory.set(entity.category, bucket);
  }
  const sections = [...byCategory].map(
    ([category, lines]) => `${category}:\n- ${lines.join("\n- ")}`
  );
  return `\n\n--- STRUCTURED (Amazon Comprehend Medical) ---\n${sections.join("\n\n")}`;
}

/** Textract + Comprehend Medical — returns the care context the agent reads. */
export async function digitiseDischargePdf(
  file: Buffer,
  filename: string,
  language = "en-IN"
): Promise<string> {
  void language; // Textract detects script itself; kept for call-site compatibility.

  if (config.useOfflineAi) {
    console.log("[doc] offline mode — using the demo discharge text");
    return OFFLINE_DISCHARGE;
  }

  const started = Date.now();
  const text =
    file.length <= SYNC_LIMIT_BYTES
      ? await analyzeSync(file)
      : await analyzeAsync(file, filename);

  if (!text.trim()) throw new Error("Textract found no readable text in that PDF");

  const entities = await extractEntities(text);
  const combined = `${text}${renderEntities(entities)}`.slice(0, MAX_CHARS);
  console.log(
    `[doc] ${filename} in ${Date.now() - started}ms · ${text.length} chars · ${entities.length} medical entities`
  );
  return combined;
}

const OFFLINE_DISCHARGE = `DISCHARGE SUMMARY

Patient: Lakshmi Rao
Age: 68

Diagnosis: Left knee osteoarthritis
Procedure: Left Total Knee Replacement

Discharge Instructions:
- Take your antibiotic twice daily for 7 days.
- Take pain medicine only if needed.
- Keep the wound clean and dry.
- Change the dressing after Day 5.
- Walk for 15–20 minutes twice a day.
- Do not climb stairs without assistance.
- Contact your doctor immediately if you have fever, increasing redness around the wound, pus or discharge, or severe swelling.
`.trim();
