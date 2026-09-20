import multer from "multer";
import { Router } from "express";
import { config } from "../config.js";
import { dbConfigured } from "../db/pool.js";
import { schemaReady } from "../db/schema.js";
import {
  getPatientProfile,
  isProfileReady,
  setDischargeSummaryForUser,
  upsertPatientProfile,
} from "../db/profiles.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { digitiseDischargePdf } from "../services/documentDigitisation.js";

export const profilesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.dischargeUploadMaxMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === "application/pdf" ||
      /\.pdf$/i.test(file.originalname)
    ) {
      cb(null, true);
      return;
    }
    cb(new Error("Only PDF files are supported"));
  },
});

function splitList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function dbUnavailable(res: import("express").Response): boolean {
  if (!dbConfigured() || !schemaReady()) {
    res.status(503).json({
      error:
        "Database unavailable — set DATABASE_URL to the Aurora Serverless v2 (PostgreSQL) endpoint",
    });
    return true;
  }
  return false;
}

profilesRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  if (dbUnavailable(res)) return;
  try {
    const profile = await getPatientProfile(req.authUser!.id);
    res.json({
      profile,
      ready: isProfileReady(profile),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load profile",
    });
  }
});

/** Form-based patient setup (PDF optional separately). */
profilesRouter.put("/me", requireAuth, async (req: AuthedRequest, res) => {
  if (dbUnavailable(res)) return;
  try {
    const body = req.body ?? {};
    const profile = await upsertPatientProfile(req.authUser!.id, {
      name: String(body.name ?? req.authUser!.name ?? "").trim(),
      age: body.age != null && body.age !== "" ? Number(body.age) : null,
      location: typeof body.location === "string" ? body.location : "",
      procedure: typeof body.procedure === "string" ? body.procedure : "",
      discharged_on:
        typeof body.discharged_on === "string" ? body.discharged_on : null,
      conditions: splitList(body.conditions),
      medications: splitList(body.medications),
      preferred_language:
        typeof body.preferred_language === "string"
          ? body.preferred_language
          : "hi-IN",
      discharge_summary:
        typeof body.discharge_summary === "string"
          ? body.discharge_summary
          : undefined,
    });
    res.json({ profile, ready: isProfileReady(profile) });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to save profile",
    });
  }
});

/** Optional discharge PDF → Textract + Comprehend Medical → stored on THIS user's profile. */
profilesRouter.post(
  "/me/discharge",
  requireAuth,
  upload.single("file"),
  async (req: AuthedRequest, res) => {
    if (dbUnavailable(res)) return;
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
      const profile = await setDischargeSummaryForUser(
        req.authUser!.id,
        text,
        req.authUser!.name
      );
      res.json({
        ok: true,
        chars: text.length,
        preview: text.slice(0, 500),
        profile,
        ready: isProfileReady(profile),
      });
    } catch (err) {
      console.error("[profiles] discharge upload failed:", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "upload failed",
      });
    }
  }
);
