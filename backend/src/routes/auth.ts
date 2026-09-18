import { Router } from "express";
import { dbConfigured } from "../db/pool.js";
import {
  getUserById,
  loginUser,
  registerUser,
  signToken,
  verifyToken,
} from "../db/auth.js";
import { schemaReady } from "../db/schema.js";
import { bearerToken } from "../middleware/auth.js";
import { countUsers } from "../db/users.js";

export const authRouter = Router();

function dbUnavailable(res: import("express").Response): boolean {
  if (!dbConfigured() || !schemaReady()) {
    res.status(503).json({
      error:
        "Database unavailable — set DATABASE_URL to your Supabase Postgres URI",
    });
    return true;
  }
  return false;
}

authRouter.post("/register", async (req, res) => {
  if (dbUnavailable(res)) return;
  const username = String(req.body?.username ?? "");
  const password = String(req.body?.password ?? "");
  const name = String(req.body?.name ?? "");
  const email =
    typeof req.body?.email === "string" ? req.body.email : undefined;
  try {
    const user = await registerUser({ username, password, name, email });
    const token = signToken(user);
    const userCount = await countUsers();
    res.json({ user, token, userCount });
  } catch (err) {
    console.error("[auth] register failed:", err);
    const message = err instanceof Error ? err.message : "register failed";
    const status = /duplicate|unique|already exists/i.test(message) ? 409 : 400;
    res.status(status).json({ error: message });
  }
});

authRouter.post("/login", async (req, res) => {
  if (dbUnavailable(res)) return;
  const username = String(req.body?.username ?? "");
  const password = String(req.body?.password ?? "");
  try {
    const user = await loginUser(username, password);
    const token = signToken(user);
    res.json({ user, token });
  } catch (err) {
    console.error("[auth] login failed:", err);
    res.status(401).json({
      error: err instanceof Error ? err.message : "login failed",
    });
  }
});

authRouter.get("/me", async (req, res) => {
  if (dbUnavailable(res)) return;
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload?.sub) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  try {
    const user = await getUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json({ user });
  } catch (err) {
    res.status(503).json({
      error: err instanceof Error ? err.message : "Auth unavailable",
    });
  }
});
