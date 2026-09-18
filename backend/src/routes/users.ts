import { Router } from "express";
import { dbConfigured } from "../db/pool.js";
import { schemaReady } from "../db/schema.js";
import {
  countUsers,
  getTraction,
  listUsers,
  upsertUser,
} from "../db/users.js";

export const usersRouter = Router();

usersRouter.post("/register", async (req, res) => {
  if (!dbConfigured() || !schemaReady()) {
    res.status(503).json({
      error:
        "Database unavailable — set DATABASE_URL to your Supabase Postgres URI",
    });
    return;
  }
  const name = String(req.body?.name ?? "");
  const email = String(req.body?.email ?? "");
  try {
    const user = await upsertUser(name, email);
    const userCount = await countUsers();
    res.json({ ...user, userCount });
  } catch (err) {
    console.error("[users] register failed:", err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "register failed",
    });
  }
});

usersRouter.get("/", async (_req, res) => {
  if (!dbConfigured() || !schemaReady()) {
    res.status(503).json({
      error:
        "Database unavailable — set DATABASE_URL to your Supabase Postgres URI",
    });
    return;
  }
  try {
    res.json({ users: await listUsers() });
  } catch (err) {
    console.error("[users] list failed:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "list failed",
    });
  }
});
