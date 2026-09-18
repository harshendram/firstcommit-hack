import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { dbConfigured, query } from "./pool.js";
import { schemaReady } from "./schema.js";

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  email: string | null;
}

export interface AuthTokenPayload {
  sub: string;
  username: string;
  name: string;
  email: string | null;
}

function assertDb(): void {
  if (!dbConfigured() || !schemaReady()) {
    throw new Error(
      "Database unavailable — set DATABASE_URL to your Supabase Postgres URI"
    );
  }
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function registerUser(input: {
  username: string;
  password: string;
  name: string;
  email?: string;
}): Promise<AuthUser> {
  assertDb();
  const username = normalizeUsername(input.username);
  const name = input.name.trim();
  const password = input.password;
  const email = input.email?.trim()
    ? normalizeEmail(input.email)
    : null;

  if (!username || username.length < 3) {
    throw new Error("Username must be at least 3 characters");
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new Error("Username may only use letters, numbers, . _ -");
  }
  if (!name || name.length < 2) {
    throw new Error("Name is required");
  }
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  if (email && !email.includes("@")) {
    throw new Error("Invalid email");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await query<{
    id: string;
    username: string;
    name: string;
    email: string | null;
  }>(
    `
    INSERT INTO users (username, password_hash, name, email)
    VALUES ($1, $2, $3, $4)
    RETURNING id, username, name, email
    `,
    [username, passwordHash, name, email]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
  };
}

export async function loginUser(
  username: string,
  password: string
): Promise<AuthUser> {
  assertDb();
  const clean = normalizeUsername(username);
  if (!clean || !password) {
    throw new Error("Username and password are required");
  }

  const result = await query<{
    id: string;
    username: string;
    name: string;
    email: string | null;
    password_hash: string | null;
  }>(
    `
    SELECT id, username, name, email, password_hash
    FROM users
    WHERE username = $1
    LIMIT 1
    `,
    [clean]
  );
  const row = result.rows[0];
  if (!row?.password_hash) {
    throw new Error("Invalid username or password");
  }

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    throw new Error("Invalid username or password");
  }

  await query(`UPDATE users SET last_seen_at = NOW() WHERE id = $1`, [row.id]);

  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
  };
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  assertDb();
  const result = await query<{
    id: string;
    username: string;
    name: string;
    email: string | null;
  }>(
    `
    SELECT id, username, name, email
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return row;
}

export function signToken(user: AuthUser): string {
  if (!config.authSecret) {
    throw new Error("AUTH_SECRET is not configured");
  }
  const payload: AuthTokenPayload = {
    sub: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
  };
  return jwt.sign(payload, config.authSecret, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthTokenPayload | null {
  if (!config.authSecret) return null;
  try {
    return jwt.verify(token, config.authSecret) as AuthTokenPayload;
  } catch {
    return null;
  }
}
