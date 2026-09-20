import { dbConfigured, query } from "./pool.js";
import { schemaReady } from "./schema.js";
import type { CheckIn, PatientProfile } from "../care/types.js";

export interface StoredPatientProfile {
  user_id: string;
  name: string;
  age: number | null;
  location: string;
  procedure: string;
  discharged_on: string | null;
  conditions: string[];
  medications: string[];
  preferred_language: string;
  discharge_summary: string | null;
  history: CheckIn[];
  updated_at: string;
}

function assertDb(): void {
  if (!dbConfigured() || !schemaReady()) {
    throw new Error(
      "Database unavailable — set DATABASE_URL to the Aurora Serverless v2 (PostgreSQL) endpoint"
    );
  }
}

export function profileToCarePatient(p: StoredPatientProfile): PatientProfile {
  return {
    id: `user-${p.user_id}`,
    name: p.name,
    age: p.age ?? 0,
    location: p.location || "Home",
    procedure: p.procedure || "Post-discharge recovery",
    discharged_on:
      p.discharged_on || new Date().toISOString().slice(0, 10),
    conditions: p.conditions ?? [],
    medications: p.medications ?? [],
    preferred_language: p.preferred_language || "hi-IN",
    discharge_summary: p.discharge_summary ?? undefined,
  };
}

/** Enough to start a check-in: name + (form clinical fields OR discharge text). */
export function isProfileReady(p: StoredPatientProfile | null): boolean {
  if (!p?.name?.trim()) return false;
  const hasForm =
    Boolean(p.procedure?.trim()) ||
    (p.medications?.length ?? 0) > 0 ||
    (p.conditions?.length ?? 0) > 0;
  const hasDoc = Boolean(p.discharge_summary?.trim());
  return hasForm || hasDoc;
}

function mapRow(row: {
  user_id: string;
  name: string;
  age: number | null;
  location: string;
  procedure: string;
  discharged_on: string | null;
  conditions: string[] | null;
  medications: string[] | null;
  preferred_language: string;
  discharge_summary: string | null;
  history: unknown;
  updated_at: Date;
}): StoredPatientProfile {
  return {
    user_id: row.user_id,
    name: row.name,
    age: row.age,
    location: row.location ?? "",
    procedure: row.procedure ?? "",
    discharged_on: row.discharged_on,
    conditions: row.conditions ?? [],
    medications: row.medications ?? [],
    preferred_language: row.preferred_language || "hi-IN",
    discharge_summary: row.discharge_summary,
    history: Array.isArray(row.history) ? (row.history as CheckIn[]) : [],
    updated_at: row.updated_at.toISOString(),
  };
}

export async function getPatientProfile(
  userId: string
): Promise<StoredPatientProfile | null> {
  assertDb();
  const result = await query<{
    user_id: string;
    name: string;
    age: number | null;
    location: string;
    procedure: string;
    discharged_on: string | null;
    conditions: string[] | null;
    medications: string[] | null;
    preferred_language: string;
    discharge_summary: string | null;
    history: unknown;
    updated_at: Date;
  }>(
    `
    SELECT user_id, name, age, location, procedure, discharged_on,
           conditions, medications, preferred_language, discharge_summary,
           history, updated_at
    FROM patient_profiles
    WHERE user_id = $1
    LIMIT 1
    `,
    [userId]
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function upsertPatientProfile(
  userId: string,
  input: {
    name: string;
    age?: number | null;
    location?: string;
    procedure?: string;
    discharged_on?: string | null;
    conditions?: string[];
    medications?: string[];
    preferred_language?: string;
    discharge_summary?: string | null;
  }
): Promise<StoredPatientProfile> {
  assertDb();
  const name = input.name.trim();
  if (!name) throw new Error("Patient name is required");

  const result = await query<{
    user_id: string;
    name: string;
    age: number | null;
    location: string;
    procedure: string;
    discharged_on: string | null;
    conditions: string[] | null;
    medications: string[] | null;
    preferred_language: string;
    discharge_summary: string | null;
    history: unknown;
    updated_at: Date;
  }>(
    `
    INSERT INTO patient_profiles (
      user_id, name, age, location, procedure, discharged_on,
      conditions, medications, preferred_language, discharge_summary
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (user_id) DO UPDATE SET
      name = EXCLUDED.name,
      age = COALESCE(EXCLUDED.age, patient_profiles.age),
      location = COALESCE(NULLIF(EXCLUDED.location, ''), patient_profiles.location),
      procedure = COALESCE(NULLIF(EXCLUDED.procedure, ''), patient_profiles.procedure),
      discharged_on = COALESCE(EXCLUDED.discharged_on, patient_profiles.discharged_on),
      conditions = CASE
        WHEN cardinality(EXCLUDED.conditions) > 0 THEN EXCLUDED.conditions
        ELSE patient_profiles.conditions
      END,
      medications = CASE
        WHEN cardinality(EXCLUDED.medications) > 0 THEN EXCLUDED.medications
        ELSE patient_profiles.medications
      END,
      preferred_language = COALESCE(NULLIF(EXCLUDED.preferred_language, ''), patient_profiles.preferred_language),
      discharge_summary = COALESCE(EXCLUDED.discharge_summary, patient_profiles.discharge_summary),
      updated_at = NOW()
    RETURNING user_id, name, age, location, procedure, discharged_on,
              conditions, medications, preferred_language, discharge_summary,
              history, updated_at
    `,
    [
      userId,
      name,
      input.age ?? null,
      input.location?.trim() ?? "",
      input.procedure?.trim() ?? "",
      input.discharged_on?.trim() || null,
      input.conditions ?? [],
      input.medications ?? [],
      input.preferred_language?.trim() || "hi-IN",
      input.discharge_summary?.trim() || null,
    ]
  );
  return mapRow(result.rows[0]);
}

export async function setDischargeSummaryForUser(
  userId: string,
  summary: string,
  nameFallback: string
): Promise<StoredPatientProfile> {
  assertDb();
  const existing = await getPatientProfile(userId);
  if (existing) {
    const result = await query<{
      user_id: string;
      name: string;
      age: number | null;
      location: string;
      procedure: string;
      discharged_on: string | null;
      conditions: string[] | null;
      medications: string[] | null;
      preferred_language: string;
      discharge_summary: string | null;
      history: unknown;
      updated_at: Date;
    }>(
      `
      UPDATE patient_profiles
      SET discharge_summary = $2, updated_at = NOW()
      WHERE user_id = $1
      RETURNING user_id, name, age, location, procedure, discharged_on,
                conditions, medications, preferred_language, discharge_summary,
                history, updated_at
      `,
      [userId, summary.trim()]
    );
    return mapRow(result.rows[0]);
  }
  return upsertPatientProfile(userId, {
    name: nameFallback,
    discharge_summary: summary.trim(),
  });
}

export async function listPatientProfiles(): Promise<StoredPatientProfile[]> {
  if (!dbConfigured() || !schemaReady()) return [];
  const result = await query<{
    user_id: string;
    name: string;
    age: number | null;
    location: string;
    procedure: string;
    discharged_on: string | null;
    conditions: string[] | null;
    medications: string[] | null;
    preferred_language: string;
    discharge_summary: string | null;
    history: unknown;
    updated_at: Date;
  }>(
    `
    SELECT user_id, name, age, location, procedure, discharged_on,
           conditions, medications, preferred_language, discharge_summary,
           history, updated_at
    FROM patient_profiles
    ORDER BY updated_at DESC
    `
  );
  return result.rows.map(mapRow);
}

export async function appendUserCheckIn(
  userId: string,
  checkIn: CheckIn
): Promise<void> {
  assertDb();
  await query(
    `
    UPDATE patient_profiles
    SET history = COALESCE(history, '[]'::jsonb) || $2::jsonb,
        updated_at = NOW()
    WHERE user_id = $1
    `,
    [userId, JSON.stringify([checkIn])]
  );
}
