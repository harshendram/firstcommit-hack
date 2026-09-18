import AdmZip from "adm-zip";
import { config } from "../config.js";

const BASE = "https://api.sarvam.ai";

function headers(): HeadersInit {
  return {
    "api-subscription-key": config.sarvamApiKey,
    "Content-Type": "application/json",
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function safeFilename(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  return base.toLowerCase().endsWith(".pdf") ? base : `${base || "discharge"}.pdf`;
}

function firstFileUrl(
  urls: Record<string, { file_url?: string } | undefined> | undefined
): string | undefined {
  if (!urls) return undefined;
  for (const details of Object.values(urls)) {
    if (details?.file_url) return details.file_url;
  }
  return undefined;
}

function extractMarkdownFromZip(buf: Buffer): string {
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  const md = entries.find((e) => /\.md$/i.test(e.entryName) && !e.isDirectory);
  if (md) return md.getData().toString("utf8").trim();
  const txt = entries.find((e) => /\.txt$/i.test(e.entryName) && !e.isDirectory);
  if (txt) return txt.getData().toString("utf8").trim();
  const json = entries.find((e) => /\.json$/i.test(e.entryName) && !e.isDirectory);
  if (json) {
    try {
      const parsed = JSON.parse(json.getData().toString("utf8")) as unknown;
      return JSON.stringify(parsed, null, 2).slice(0, 12_000);
    } catch {
      /* fall through */
    }
  }
  throw new Error("No readable text found in digitisation output");
}

/** Sarvam Document Digitisation — async job flow, returns markdown text. */
export async function digitiseDischargePdf(
  file: Buffer,
  filename: string,
  language = "en-IN"
): Promise<string> {
  if (config.useMockAi || !config.sarvamApiKey) {
    console.log("[doc] mock digitisation — using demo discharge text");
    return MOCK_DISCHARGE;
  }

  const started = Date.now();
  const uploadName = safeFilename(filename);

  // 1) Create job (returns job_id only — no upload_url)
  const createRes = await fetch(`${BASE}/doc-digitization/job/v1`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      job_parameters: { language, output_format: "md" },
    }),
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Sarvam job create failed (${createRes.status}): ${body}`);
  }
  const created = (await createRes.json()) as { job_id?: string };
  const jobId = created.job_id;
  if (!jobId) {
    throw new Error(
      `Sarvam job create missing job_id: ${JSON.stringify(created)}`
    );
  }

  // 2) Get presigned upload URL
  const uploadLinksRes = await fetch(
    `${BASE}/doc-digitization/job/v1/upload-files`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ job_id: jobId, files: [uploadName] }),
    }
  );
  if (!uploadLinksRes.ok) {
    const body = await uploadLinksRes.text();
    throw new Error(
      `Sarvam upload links failed (${uploadLinksRes.status}): ${body}`
    );
  }
  const uploadLinks = (await uploadLinksRes.json()) as {
    upload_urls?: Record<string, { file_url?: string }>;
  };
  const uploadUrl =
    uploadLinks.upload_urls?.[uploadName]?.file_url ??
    firstFileUrl(uploadLinks.upload_urls);
  if (!uploadUrl) {
    throw new Error(
      `Sarvam upload links missing file_url: ${JSON.stringify(uploadLinks)}`
    );
  }

  // 3) PUT file to Azure presigned URL (requires x-ms-blob-type)
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    body: new Uint8Array(file),
    headers: {
      "Content-Type": "application/pdf",
      "x-ms-blob-type": "BlockBlob",
    },
  });
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => "");
    throw new Error(
      `Sarvam file upload failed (${uploadRes.status}): ${body.slice(0, 300)}`
    );
  }

  // 4) Start job
  const startRes = await fetch(
    `${BASE}/doc-digitization/job/v1/${jobId}/start`,
    { method: "POST", headers: headers() }
  );
  if (!startRes.ok) {
    const body = await startRes.text();
    throw new Error(`Sarvam job start failed (${startRes.status}): ${body}`);
  }

  // 5) Poll status
  const deadline = Date.now() + 120_000;
  let state = "Running";
  while (Date.now() < deadline) {
    await sleep(2000);
    const statusRes = await fetch(
      `${BASE}/doc-digitization/job/v1/${jobId}/status`,
      { headers: { "api-subscription-key": config.sarvamApiKey } }
    );
    if (!statusRes.ok) continue;
    const status = (await statusRes.json()) as {
      job_state?: string;
      error_message?: string;
    };
    state = status.job_state ?? state;
    if (state === "Completed" || state === "PartiallyCompleted") break;
    if (state === "Failed") {
      throw new Error(
        `Sarvam document digitisation failed: ${status.error_message || "unknown"}`
      );
    }
  }
  if (state !== "Completed" && state !== "PartiallyCompleted") {
    throw new Error("Document digitisation timed out");
  }

  // 6) Get download URLs (POST), then fetch the ZIP
  const downloadLinksRes = await fetch(
    `${BASE}/doc-digitization/job/v1/${jobId}/download-files`,
    { method: "POST", headers: headers() }
  );
  if (!downloadLinksRes.ok) {
    const body = await downloadLinksRes.text();
    throw new Error(
      `Sarvam download links failed (${downloadLinksRes.status}): ${body}`
    );
  }
  const downloadLinks = (await downloadLinksRes.json()) as {
    download_urls?: Record<string, { file_url?: string }>;
  };
  const downloadUrl = firstFileUrl(downloadLinks.download_urls);
  if (!downloadUrl) {
    throw new Error(
      `Sarvam download links missing file_url: ${JSON.stringify(downloadLinks)}`
    );
  }

  const zipRes = await fetch(downloadUrl);
  if (!zipRes.ok) {
    throw new Error(`Sarvam output download failed (${zipRes.status})`);
  }
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  const text = extractMarkdownFromZip(zipBuf).slice(0, 12_000);
  console.log(
    `[doc] digitised ${filename} in ${Date.now() - started}ms · ${text.length} chars`
  );
  return text;
}

const MOCK_DISCHARGE = `DISCHARGE SUMMARY

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
