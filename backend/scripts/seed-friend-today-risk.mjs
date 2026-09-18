/**
 * Upsert today's *live* check-ins so the doctor roster census shows a mix
 * of green / amber / red (simulated priors alone are ignored by the roster).
 *
 * Run: cd backend && npx tsx scripts/seed-friend-today-risk.mjs
 *
 * Default mix: 2 red, 3 amber, several green. Re-run replaces same-day live rows.
 */
import dotenv from "dotenv";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

/** @typedef {"green"|"amber"|"red"} RiskLevel */

/**
 * Explicit risk assignments for the census demo.
 * Symptoms / meds / notes match what drives classifyRisk + highestPriorityDetail.
 * @type {Record<string, { risk: RiskLevel, pain: number, fever: number, wound: number, meds: boolean, activity: number, note: string }>}
 */
const RISK_BY_USER = {
  // Red — fever + wound discharge (hard red infection pattern)
  harshendra: {
    risk: "red",
    pain: 2,
    fever: 1,
    wound: 2,
    meds: true,
    activity: 32,
    note: "Harshendra: fever today and wound seeping yellow fluid at the port. Walking little. Needs review today.",
  },
  ujwala: {
    risk: "red",
    pain: 2,
    fever: 1,
    wound: 3,
    meds: true,
    activity: 28,
    note: "Ujwala: wound discharge with low-grade fever after gallbladder surgery. Site red and warm. Escalate.",
  },

  // Amber — pain up, low activity, and/or missed meds
  prapti: {
    risk: "amber",
    pain: 3,
    fever: 0,
    wound: 1,
    meds: true,
    activity: 35,
    note: "Prapti: ankle pain back up to 3/3. Swelling worse after walking. Behind expected recovery.",
  },
  samata: {
    risk: "amber",
    pain: 2,
    fever: 0,
    wound: 1,
    meds: false,
    activity: 38,
    note: "Samata: missed antibiotic dose. Knee stiff and more swollen than yesterday. Recommend doctor review.",
  },
  mayur: {
    risk: "amber",
    pain: 2,
    fever: 0,
    wound: 0,
    meds: true,
    activity: 30,
    note: "Mayur: cast okay but pain 2/3 and barely using the hand. Walking/activity well below expected.",
  },

  // Green — on-track live check-ins so Today census has many greens
  nikita: {
    risk: "green",
    pain: 1,
    fever: 0,
    wound: 0,
    meds: true,
    activity: 62,
    note: "Nikita: jaw ache mild. Soft foods. Medicines taken. Recovery on track.",
  },
  manjunath: {
    risk: "green",
    pain: 1,
    fever: 0,
    wound: 0,
    meds: true,
    activity: 58,
    note: "Manjunath: throat better. Cold fluids helping. No bleeding. On track.",
  },
  parnika: {
    risk: "green",
    pain: 1,
    fever: 0,
    wound: 0,
    meds: true,
    activity: 55,
    note: "Parnika: recovery day okay. Medicines taken. Resting well.",
  },
  poorvika: {
    risk: "green",
    pain: 0,
    fever: 0,
    wound: 0,
    meds: true,
    activity: 65,
    note: "Poorvika: feeling better today. Short walks done. No fever.",
  },
  prasoon: {
    risk: "green",
    pain: 1,
    fever: 0,
    wound: 0,
    meds: true,
    activity: 60,
    note: "Prasoon: site comfortable. Meds taken. Mobility improving.",
  },
  prakhar: {
    risk: "green",
    pain: 1,
    fever: 0,
    wound: 1,
    meds: true,
    activity: 52,
    note: "Prakhar: mild ache only. Dressing clean. On track for this stage.",
  },
  manya: {
    risk: "green",
    pain: 0,
    fever: 0,
    wound: 0,
    meds: true,
    activity: 68,
    note: "Manya: good day. No fever. Walked as advised.",
  },
  prarthana: {
    risk: "green",
    pain: 1,
    fever: 0,
    wound: 0,
    meds: true,
    activity: 57,
    note: "Prarthana: recovery progressing. Meds taken. Resting.",
  },
  anushka: {
    risk: "green",
    pain: 1,
    fever: 0,
    wound: 0,
    meds: true,
    activity: 54,
    note: "Anushka: mild discomfort only. No red flags. Continue monitoring.",
  },
};

function metaFor(risk) {
  if (risk === "red") {
    return {
      risk_score: 5.6,
      action: "escalate",
      recommendation:
        "Review today — possible surgical site infection. Readmission risk if missed.",
    };
  }
  if (risk === "amber") {
    return {
      risk_score: 2.8,
      action: "recommend_doctor_review",
      recommendation:
        "Review within 48 hours — recovery is tracking behind expected for this day.",
    };
  }
  return {
    risk_score: 0.2,
    action: "continue_monitoring",
    recommendation: "Recovery on track. Continue daily monitoring.",
  };
}

function todayLiveCheckIn(spec, seed) {
  // Use UTC calendar day so `date` matches monitor.ts todayKey() (ISO UTC).
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  now.setUTCHours(8 + (seed % 5), 5 + (seed % 50), 10 + (seed % 40), 0);
  const meta = metaFor(spec.risk);
  const reasoning = [spec.note];
  if (spec.risk === "red" && spec.fever >= 1 && spec.wound >= 2) {
    reasoning.unshift(
      "Red flag: fever with wound discharge — possible surgical site infection"
    );
  }
  if (spec.risk === "amber" && !spec.meds) {
    reasoning.push("Antibiotic dose missed today");
  }
  return {
    id: randomUUID(),
    date,
    completed_at: now.toISOString(),
    symptoms: {
      pain: spec.pain,
      fever: spec.fever,
      wound: spec.wound,
      breathlessness: 0,
      dizziness: 0,
    },
    medication_taken: spec.meds,
    activity_index: spec.activity,
    resting_hr: 72 + (seed % 16),
    risk: spec.risk,
    risk_score: meta.risk_score,
    recommendation: meta.recommendation,
    action: meta.action,
    reasoning,
    notes: spec.note,
    transcript: [],
    simulated: false,
  };
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

const today = new Date().toISOString().slice(0, 10);
const counts = { green: 0, amber: 0, red: 0, skip: 0 };

try {
  let i = 0;
  for (const [username, spec] of Object.entries(RISK_BY_USER)) {
    const u = await pool.query(
      `SELECT u.id, u.name, p.procedure, p.history
       FROM users u
       LEFT JOIN patient_profiles p ON p.user_id = u.id
       WHERE u.username = $1
       LIMIT 1`,
      [username]
    );
    const row = u.rows[0];
    if (!row?.id || !row.procedure) {
      console.warn(`SKIP ${username} (no profile)`);
      counts.skip += 1;
      continue;
    }

    const history = Array.isArray(row.history) ? row.history : [];
    // Keep simulated priors only — replace any prior live seed so re-runs stay
    // aligned with monitor.ts todayKey() (UTC calendar day).
    const preserved = history.filter((c) => c && c.simulated === true);

    const live = todayLiveCheckIn(spec, i);
    const next = [...preserved, live].sort((a, b) =>
      String(a.completed_at).localeCompare(String(b.completed_at))
    );

    await pool.query(
      `UPDATE patient_profiles SET history = $2::jsonb, updated_at = NOW() WHERE user_id = $1`,
      [row.id, JSON.stringify(next)]
    );
    console.log(
      `OK ${username} · ${spec.risk.toUpperCase()} · ${row.procedure.slice(0, 42)}`
    );
    counts[spec.risk] += 1;
    i += 1;
  }
  console.log(
    `Done · red=${counts.red} amber=${counts.amber} green=${counts.green} skip=${counts.skip} · date=${today}`
  );
} catch (err) {
  console.error("FAIL", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
