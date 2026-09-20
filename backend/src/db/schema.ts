import { dbConfigured, query } from "./pool.js";

let ready = false;

export async function ensureSchema(): Promise<void> {
  if (!dbConfigured()) {
    console.warn(
      "[db] DATABASE_URL unset — user traction (name+email) is disabled until Aurora is configured"
    );
    return;
  }
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL;`);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
    ON users (username)
    WHERE username IS NOT NULL;
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
    ON users (email)
    WHERE email IS NOT NULL;
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS checkin_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      risk TEXT,
      care_checkin_id TEXT
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS checkin_runs_user_id_idx ON checkin_runs(user_id);
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS patient_profiles (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      age INT,
      location TEXT NOT NULL DEFAULT '',
      procedure TEXT NOT NULL DEFAULT '',
      discharged_on TEXT,
      conditions TEXT[] NOT NULL DEFAULT '{}',
      medications TEXT[] NOT NULL DEFAULT '{}',
      preferred_language TEXT NOT NULL DEFAULT 'hi-IN',
      discharge_summary TEXT,
      history JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  ready = true;
  console.log("[db] Aurora schema ready (users, checkin_runs, patient_profiles)");
}

export function schemaReady(): boolean {
  return ready;
}
