import type { NextFunction, Request, Response } from "express";
import { getUserById, verifyToken } from "../db/auth.js";

export interface AuthedRequest extends Request {
  authUser?: {
    id: string;
    username: string;
    name: string;
    email: string | null;
  };
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
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
    req.authUser = user;
    next();
  } catch (err) {
    console.error("[auth] requireAuth failed:", err);
    res.status(503).json({
      error: err instanceof Error ? err.message : "Auth unavailable",
    });
  }
}

export async function optionalAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    next();
    return;
  }
  const payload = verifyToken(token);
  if (!payload?.sub) {
    next();
    return;
  }
  try {
    const user = await getUserById(payload.sub);
    if (user) req.authUser = user;
  } catch {
    /* ignore — optional */
  }
  next();
}
