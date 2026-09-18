import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTrend, computeBaseline } from "./baseline.js";
import { buildSeedHistory, CARE_PATIENT } from "./seed.js";
import type { CheckIn, DoctorView, PatientProfile } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const DATA_FILE = path.join(DATA_DIR, "care.json");

interface Persisted {
  patient: PatientProfile;
  history: CheckIn[];
}

/**
 * Flat-file store. A hackathon does not need Postgres, but the doctor view is
 * a real read model rebuilt from persisted check-ins, not a UI mock.
 */
class CareStore {
  private patient: PatientProfile = CARE_PATIENT;
  private history: CheckIn[] = [];
  private listeners = new Set<(view: DoctorView) => void>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as Persisted;
        this.patient = raw.patient ?? CARE_PATIENT;
        this.history = raw.history ?? [];
        const stale =
          !this.patient.procedure ||
          this.patient.id !== CARE_PATIENT.id ||
          this.patient.discharged_on !== CARE_PATIENT.discharged_on ||
          this.history.length !== buildSeedHistory().length ||
          this.history.some(
            (c) =>
              !("pain" in (c.symptoms ?? {})) ||
              "fatigue" in (c.symptoms as object)
          );
        if (stale) {
          console.log("[care] stale seed detected — reseeding post-op history");
          this.reseed();
          return;
        }
        if (this.history.length > 0) {
          console.log(`[care] loaded ${this.history.length} check-ins from disk`);
          return;
        }
      }
    } catch (err) {
      console.warn("[care] could not read care.json, reseeding:", err);
    }
    this.reseed();
  }

  private persist(): void {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify({ patient: this.patient, history: this.history }, null, 2)
      );
    } catch (err) {
      console.error("[care] persist failed:", err);
    }
  }

  /** Drop live check-ins and restore the seeded history. Used between demo runs. */
  reseed(): void {
    const priorSummary = this.patient.discharge_summary;
    const priorUploadedAt = this.patient.discharge_uploaded_at;
    this.patient = {
      ...CARE_PATIENT,
      discharge_summary: priorSummary,
      discharge_uploaded_at: priorUploadedAt,
    };
    this.history = buildSeedHistory();
    this.persist();
    console.log(`[care] seeded ${this.history.length} simulated days`);
    this.emit();
  }

  setDischargeSummary(text: string): PatientProfile {
    this.patient = {
      ...this.patient,
      discharge_summary: text.trim(),
      discharge_uploaded_at: new Date().toISOString(),
    };
    this.persist();
    this.emit();
    return this.patient;
  }

  getPatient(): PatientProfile {
    return this.patient;
  }

  getHistory(): CheckIn[] {
    return [...this.history].sort((a, b) =>
      a.completed_at.localeCompare(b.completed_at)
    );
  }

  /** Only the seeded/simulated days — what "before today" means. */
  getPriorHistory(): CheckIn[] {
    return this.getHistory().filter((c) => c.simulated);
  }

  appendCheckIn(checkIn: CheckIn): void {
    this.history = this.history.filter((c) => c.id !== checkIn.id);
    this.history.push(checkIn);
    this.persist();
    this.emit();
  }

  getDoctorView(): DoctorView {
    return buildDoctorView(this.patient, this.getHistory());
  }

  subscribe(fn: (view: DoctorView) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const view = this.getDoctorView();
    for (const fn of this.listeners) {
      try {
        fn(view);
      } catch (err) {
        console.error("[care] listener failed:", err);
      }
    }
  }
}

/** Build the doctor read model from any patient + history (demo or logged-in user). */
export function buildDoctorView(
  patient: PatientProfile,
  historyIn: CheckIn[]
): DoctorView {
  const history = [...historyIn].sort((a, b) =>
    a.completed_at.localeCompare(b.completed_at)
  );
  const baseline = computeBaseline(history, patient.discharged_on);
  const latest = history.length > 0 ? history[history.length - 1] : null;
  return {
    patient,
    baseline,
    latest,
    trend: buildTrend(history, baseline),
    history,
    adherence_pct: baseline.adherence_pct,
    streak_days: history.length,
  };
}

export const careStore = new CareStore();
