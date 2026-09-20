import { dbConfigured, query } from "./pool.js";
import { schemaReady } from "./schema.js";

export interface TractionUser {
  id: string;
  email: string;
  name: string;
  created_at: string;
  last_seen_at: string;
  run_count: number;
}

export interface TractionSummary {
  users: number;
  completed_checkins: number;
  started_checkins: number;
}

function assertDb(): void {
  if (!dbConfigured() || !schemaReady()) {
    throw new Error(
      "Database unavailable — set DATABASE_URL to the Aurora Serverless v2 (PostgreSQL) endpoint"
    );
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function upsertUser(
  name: string,
  email: string
): Promise<{ id: string; name: string; email: string }> {
  assertDb();
  const cleanName = name.trim();
  const cleanEmail = normalizeEmail(email);
  if (!cleanName || !cleanEmail || !cleanEmail.includes("@")) {
    throw new Error("Valid name and email are required");
  }

  const result = await query<{
    id: string;
    name: string;
    email: string;
  }>(
    `
    INSERT INTO users (email, name)
    VALUES ($1, $2)
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      last_seen_at = NOW()
    RETURNING id, name, email
    `,
    [cleanEmail, cleanName]
  );
  const row = result.rows[0];
  return { id: row.id, name: row.name, email: row.email };
}

/** Link traction runs to an authenticated username/password user. */
export async function upsertUserFromAuth(user: {
  id: string;
  username: string;
  name: string;
  email: string | null;
}): Promise<{ id: string; name: string; email: string }> {
  assertDb();
  const tractionEmail =
    user.email?.trim() || `${user.username}@rakshak.local`;
  await query(
    `
    UPDATE users
    SET name = $2, last_seen_at = NOW()
    WHERE id = $1
    `,
    [user.id, user.name.trim()]
  );
  return { id: user.id, name: user.name.trim(), email: normalizeEmail(tractionEmail) };
}

export async function startRun(
  userId: string,
  name: string,
  email: string
): Promise<string> {
  assertDb();
  const cleanEmail = normalizeEmail(email);
  const cleanName = name.trim();

  // One open run per user — retries / double-clicks reuse it.
  const existing = await query<{ id: string }>(
    `
    SELECT id FROM checkin_runs
    WHERE user_id = $1 AND completed_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
    `,
    [userId]
  );
  if (existing.rows[0]) {
    await query(
      `
      UPDATE checkin_runs
      SET name = $2, email = $3, started_at = NOW()
      WHERE id = $1
      `,
      [existing.rows[0].id, cleanName, cleanEmail]
    );
    return existing.rows[0].id;
  }

  const result = await query<{ id: string }>(
    `
    INSERT INTO checkin_runs (user_id, email, name)
    VALUES ($1, $2, $3)
    RETURNING id
    `,
    [userId, cleanEmail, cleanName]
  );
  return result.rows[0].id;
}

export async function completeRun(
  runId: string,
  risk: string,
  careCheckinId: string
): Promise<void> {
  assertDb();
  await query(
    `
    UPDATE checkin_runs
    SET completed_at = NOW(),
        risk = $2,
        care_checkin_id = $3
    WHERE id = $1
    `,
    [runId, risk, careCheckinId]
  );
}

export async function countUsers(): Promise<number> {
  assertDb();
  const result = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM users`
  );
  return Number(result.rows[0]?.n ?? 0);
}

export async function getTraction(): Promise<TractionSummary> {
  assertDb();
  const users = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM users`
  );
  const completed = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM checkin_runs WHERE completed_at IS NOT NULL`
  );
  const started = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM checkin_runs`
  );
  return {
    users: Number(users.rows[0]?.n ?? 0),
    completed_checkins: Number(completed.rows[0]?.n ?? 0),
    started_checkins: Number(started.rows[0]?.n ?? 0),
  };
}

export async function listUsers(): Promise<TractionUser[]> {
  assertDb();
  const result = await query<{
    id: string;
    email: string;
    name: string;
    created_at: Date;
    last_seen_at: Date;
    run_count: string;
  }>(
    `
    SELECT
      u.id,
      u.email,
      u.name,
      u.created_at,
      u.last_seen_at,
      COUNT(r.id) FILTER (WHERE r.completed_at IS NOT NULL)::text AS run_count
    FROM users u
    LEFT JOIN checkin_runs r ON r.user_id = u.id
    GROUP BY u.id
    ORDER BY u.last_seen_at DESC
    `
  );
  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at.toISOString(),
    last_seen_at: row.last_seen_at.toISOString(),
    run_count: Number(row.run_count),
  }));
}
