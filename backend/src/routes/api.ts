import { Router } from "express";
import { dbConfigured } from "../db/pool.js";
import { schemaReady } from "../db/schema.js";
import { getTraction } from "../db/users.js";
import { orchestrator } from "../services/orchestrator.js";
import type { TriggerType } from "../types.js";

const VALID_TRIGGERS: TriggerType[] = [
  "manual_tap",
  "voice_distress",
  "simulated_fall",
];

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "rakshak-orchestrator" });
});

apiRouter.get("/traction", async (_req, res) => {
  if (!dbConfigured() || !schemaReady()) {
    res.status(503).json({
      error:
        "Database unavailable — set DATABASE_URL to the Aurora Serverless v2 (PostgreSQL) endpoint",
      users: 0,
      completed_checkins: 0,
      started_checkins: 0,
    });
    return;
  }
  try {
    res.json(await getTraction());
  } catch (err) {
    console.error("[traction]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "traction failed",
    });
  }
});

apiRouter.get("/session", (_req, res) => {
  res.json(orchestrator.getSession());
});

apiRouter.post("/trigger", async (req, res) => {
  const trigger_type = req.body?.trigger_type as TriggerType;
  if (!VALID_TRIGGERS.includes(trigger_type)) {
    res.status(400).json({
      error: `trigger_type must be one of: ${VALID_TRIGGERS.join(", ")}`,
    });
    return;
  }
  try {
    const session = await orchestrator.handleTrigger(trigger_type);
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "trigger failed",
    });
  }
});

apiRouter.post("/patient/text", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) {
    res.status(400).json({ error: "text required" });
    return;
  }
  try {
    const session = await orchestrator.handlePatientText(
      text,
      req.body?.language
    );
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "patient text failed",
    });
  }
});

apiRouter.post("/confirm-arrival", async (_req, res) => {
  try {
    const session = await orchestrator.confirmArrival();
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "confirm failed",
    });
  }
});

apiRouter.post("/family/on-my-way", async (req, res) => {
  try {
    const role = (req.body?.contact_role as string | undefined) ?? "family";
    const session = await orchestrator.handleFamilyOnMyWay(
      role as "neighbour" | "security" | "family" | "emergency_services"
    );
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "on-my-way failed",
    });
  }
});

apiRouter.post("/family/arrived", async (_req, res) => {
  try {
    const session = await orchestrator.handleFamilyArrived();
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "arrived failed",
    });
  }
});

apiRouter.post("/reset", (_req, res) => {
  res.json(orchestrator.reset());
});
