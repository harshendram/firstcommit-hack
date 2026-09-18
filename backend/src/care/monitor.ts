import {
  getPatientProfile,
  listPatientProfiles,
  profileToCarePatient,
  type StoredPatientProfile,
} from "../db/profiles.js";
import { buildDoctorView, careStore } from "./store.js";
import type { CheckIn, DoctorView, RiskLevel } from "./types.js";

export interface PatientMonitorCard {
  id: string;
  name: string;
  age: number;
  procedure: string;
  demo: boolean;
  /** Live check-ins completed today (local calendar day via ISO date). */
  checkins_today: number;
  total_live_checkins: number;
  latest_risk: RiskLevel | null;
  latest_at: string | null;
  latest_notes: string | null;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function liveCheckIns(history: CheckIn[]): CheckIn[] {
  return history.filter((c) => !c.simulated);
}

function sortByCompleted(history: CheckIn[]): CheckIn[] {
  return [...history].sort((a, b) =>
    a.completed_at.localeCompare(b.completed_at)
  );
}

function cardFromHistory(
  id: string,
  name: string,
  age: number,
  procedure: string,
  demo: boolean,
  history: CheckIn[]
): PatientMonitorCard {
  const live = sortByCompleted(liveCheckIns(history));
  const today = todayKey();
  const todayLive = live.filter((c) => c.date === today || c.completed_at.startsWith(today));
  const latest = live.length > 0 ? live[live.length - 1]! : null;
  return {
    id,
    name,
    age,
    procedure,
    demo,
    checkins_today: todayLive.length,
    total_live_checkins: live.length,
    latest_risk: latest?.risk ?? null,
    latest_at: latest?.completed_at ?? null,
    latest_notes: latest?.notes ?? null,
  };
}

export async function listMonitorCards(): Promise<PatientMonitorCard[]> {
  const demo = careStore.getDoctorView();
  const cards: PatientMonitorCard[] = [
    cardFromHistory(
      demo.patient.id,
      demo.patient.name,
      demo.patient.age,
      demo.patient.procedure,
      true,
      demo.history
    ),
  ];

  let profiles: StoredPatientProfile[] = [];
  try {
    profiles = await listPatientProfiles();
  } catch (err) {
    console.warn("[care] listPatientProfiles failed:", err);
  }

  for (const p of profiles) {
    cards.push(
      cardFromHistory(
        `user-${p.user_id}`,
        p.name,
        p.age ?? 0,
        p.procedure || "Post-discharge recovery",
        false,
        p.history ?? []
      )
    );
  }

  // Active / most recent first among real patients; demo stays pinned first.
  const [demoCard, ...rest] = cards;
  rest.sort((a, b) => {
    if (b.checkins_today !== a.checkins_today) {
      return b.checkins_today - a.checkins_today;
    }
    return (b.latest_at ?? "").localeCompare(a.latest_at ?? "");
  });
  return demoCard ? [demoCard, ...rest] : rest;
}

export async function doctorViewForPatientId(
  patientId: string
): Promise<DoctorView | null> {
  if (!patientId || patientId === "lakshmi-rao" || patientId === "demo") {
    return careStore.getDoctorView();
  }
  if (!patientId.startsWith("user-")) return null;
  const userId = patientId.slice("user-".length);
  const stored = await getPatientProfile(userId);
  if (!stored) return null;
  return buildDoctorView(profileToCarePatient(stored), stored.history ?? []);
}
