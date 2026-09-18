import multer from "multer";
import { Router } from "express";
import { careOrchestrator } from "../care/orchestrator.js";
import { doctorViewForPatientId, listMonitorCards } from "../care/monitor.js";
import { remindPatientForCheckIn } from "../care/notify.js";
import { careStore } from "../care/store.js";
import { getTts } from "../care/ttsCache.js";
import { digitiseDischargePdf } from "../services/documentDigitisation.js";
import { twilioNotifier } from "../services/twilio.js";
import { config } from "../config.js";

export const careRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.dischargeUploadMaxMb * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname)) {
      cb(null, true);
      return;
    }
    cb(new Error("Only PDF files are supported"));
  },
});

/** Short-lived TTS clip for Wear OS (avoids huge WebSocket frames). */
careRouter.get("/tts/:id", (req, res) => {
  const clip = getTts(req.params.id);
  if (!clip) {
    res.status(404).json({ error: "TTS clip expired or unknown" });
    return;
  }
  res.setHeader("Content-Type", clip.mime);
  res.setHeader("Cache-Control", "no-store");
  res.send(clip.buf);
});

careRouter.get("/doctor", (_req, res) => {
  res.json(careOrchestrator.getDoctorView());
});

/** All monitored patients — demo Lakshmi + logged-in profiles. */
careRouter.get("/patients", async (_req, res) => {
  try {
    res.json({ patients: await listMonitorCards() });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to list patients",
    });
  }
});

/** Open one patient's chart (same-day check-ins included in history). */
careRouter.get("/patients/:id", async (req, res) => {
  try {
    const view = await doctorViewForPatientId(req.params.id);
    if (!view) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }
    res.json(view);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load patient",
    });
  }
});

careRouter.get("/session", (_req, res) => {
  res.json(careOrchestrator.getSession());
});

/** Upload discharge summary PDF → Sarvam digitisation → stored on patient profile. */
careRouter.post("/discharge/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file?.buffer?.length) {
    res.status(400).json({ error: "PDF file required (field name: file)" });
    return;
  }
  const language =
    typeof req.body?.language === "string" ? req.body.language : "en-IN";
  try {
    const text = await digitiseDischargePdf(
      file.buffer,
      file.originalname || "discharge.pdf",
      language
    );
    const patient = careStore.setDischargeSummary(text);
    res.json({
      ok: true,
      chars: text.length,
      preview: text.slice(0, 500),
      patient: {
        id: patient.id,
        name: patient.name,
        discharge_uploaded_at: patient.discharge_uploaded_at,
        has_discharge_summary: Boolean(patient.discharge_summary),
      },
    });
  } catch (err) {
    console.error("[care] discharge upload failed:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "upload failed",
    });
  }
});

careRouter.post("/checkin/start", async (req, res) => {
  try {
    await careOrchestrator.startCheckIn({
      name: typeof req.body?.name === "string" ? req.body.name : undefined,
      email: typeof req.body?.email === "string" ? req.body.email : undefined,
    });
    res.json(careOrchestrator.getSession());
  } catch (err) {
    console.error(err);
    res.status(err instanceof Error && /Database/.test(err.message) ? 503 : 500).json({
      error: err instanceof Error ? err.message : "start failed",
    });
  }
});

careRouter.post("/checkin/text", async (req, res) => {
  const { text, language } = req.body as { text?: string; language?: string };
  if (!text?.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  await careOrchestrator.handlePatientText(text, language);
  res.json(careOrchestrator.getSession());
});

careRouter.post("/checkin/finish", async (_req, res) => {
  await careOrchestrator.finishNow();
  res.json(careOrchestrator.getSession());
});

/** Daily nudge to the patient. Fired manually in the demo, on a cron in real life. */
careRouter.post("/remind", async (_req, res) => {
  const ok = await remindPatientForCheckIn(careOrchestrator.getActivePatient());
  res.json({ ok });
});

careRouter.post("/reset", (_req, res) => {
  careOrchestrator.resetAll();
  res.json({ ok: true, view: careOrchestrator.getDoctorView() });
});

/** Ally SNS fallback — send Twilio WhatsApp/SMS when AWS SNS isn't configured. */
careRouter.post("/notify-demo", async (req, res) => {
  const message = String(req.body?.message ?? "").trim();
  const phone = config.contactPhones.family;
  if (!message) {
    res.status(400).json({ ok: false, channel: "log", error: "empty message" });
    return;
  }
  if (!phone || !twilioNotifier.ready) {
    console.log("[ally-notify-fallback]", message);
    res.json({
      ok: true,
      channel: "log",
      message,
      reason: phone ? "twilio not configured" : "no CONTACT_FAMILY_PHONE",
    });
    return;
  }
  try {
    const result = await twilioNotifier.sendWhatsAppAlert(phone, message);
    console.log(
      result.ok
        ? `[ally-notify] ${result.channel} sent`
        : `[ally-notify] ${result.channel} failed: ${result.error}`
    );
    res.json({
      ok: result.ok,
      channel: result.channel,
      sid: result.sid,
      message,
      error: result.error,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[ally-notify]", error);
    res.status(502).json({ ok: false, channel: "twilio", error, message });
  }
});
