/**
 * Add one prior check-in per friend, tailored to THEIR procedure
 * (not the same illness for everyone).
 *
 * Run: cd backend && npx tsx scripts/seed-friend-history.mjs
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

const USERNAMES = [
  "prapti",
  "harshendra",
  "mayur",
  "manjunath",
  "ujwala",
  "samata",
  "nikita",
  "parnika",
  "poorvika",
  "prasoon",
  "prakhar",
  "manya",
  "prarthana",
  "supreetha",
  "anushka",
  "devesh",
  "aryan",
  "anirudh",
  "kamal",
  "risshab",
  "ribhav",
  "rohan",
  "apoorva",
  "kiran",
  "josephine",
  "vineeth",
  "aniket",
];

function noteForProcedure(procedure, name) {
  const p = (procedure || "").toLowerCase();
  const first = name.split(" ")[0] || "Patient";

  if (/ankle|ligament/.test(p)) {
    return `${first}: ankle less swollen today. Short walk indoors. No fever.`;
  }
  if (/append/.test(p)) {
    return `${first}: belly sore but better. Soft diet okay. Antibiotic taken.`;
  }
  if (/wrist|radius|cast|fracture radius/.test(p)) {
    return `${first}: cast dry and comfortable. Fingers moving fine. Mild ache.`;
  }
  if (/tonsil/.test(p)) {
    return `${first}: throat still scratchy. Cold fluids help. No bleeding.`;
  }
  if (/gallbladder|gall bladder/.test(p)) {
    return `${first}: port sites fine. Avoided oily food. Walking slowly.`;
  }
  if (/knee|arthroscopy|meniscus|acl/.test(p)) {
    return `${first}: knee stiff in the morning. Ice after short physio. Improving.`;
  }
  if (/wisdom|tooth|dental/.test(p)) {
    return `${first}: jaw ache mild. Soft foods only. No heavy bleeding.`;
  }
  if (/shoulder|dislocation/.test(p)) {
    return `${first}: sling on as advised. Pendulum exercises done. Pain mild.`;
  }
  if (/lasik|eye/.test(p)) {
    return `${first}: vision clearer. Using drops on time. No rubbing eyes.`;
  }
  if (/nasal|nose|septum/.test(p)) {
    return `${first}: breathing a bit better. Sleeping with head elevated.`;
  }
  if (/thyroid/.test(p)) {
    return `${first}: neck wound clean. Voice a little tired. Resting well.`;
  }
  if (/ovarian|cyst/.test(p)) {
    return `${first}: abdominal discomfort mild. Short walks done. Antibiotics taken.`;
  }
  if (/ear|drum/.test(p)) {
    return `${first}: ear dry as advised. No swimming. Mild fullness only.`;
  }
  if (/hernia|pilonidal/.test(p)) {
    return `${first}: site tender but dry. No heavy lifting. Walked a little.`;
  }
  if (/clavicle|sling/.test(p)) {
    return `${first}: sling comfortable. Slept propped up. Pain manageable.`;
  }
  if (/hand|tendon/.test(p)) {
    return `${first}: did hand therapy exercises. Dressing clean. Mild stiffness.`;
  }
  return `${first}: recovery day went okay after ${procedure}. Medicines taken. Resting.`;
}

function priorCheckIn({ procedure, name, seed }) {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(9 + (seed % 6), 10 + (seed % 45), 0, 0);
  const date = d.toISOString().slice(0, 10);
  const p = (procedure || "").toLowerCase();

  // Symptom emphasis varies by procedure type
  let pain = 1;
  let wound = 0;
  let dizziness = 0;
  let activity = 50 + (seed % 20);

  if (/knee|acl|ankle|shoulder|hernia|fracture|cast|tendon|clavicle/.test(p)) {
    pain = 1 + (seed % 2);
    activity = 40 + (seed % 20);
  } else if (/append|gallbladder|ovarian|pilonidal/.test(p)) {
    pain = 1;
    wound = seed % 2;
    activity = 45 + (seed % 15);
  } else if (/tonsil|tooth|wisdom|nasal|ear|thyroid|lasik|eye/.test(p)) {
    pain = seed % 2;
    activity = 55 + (seed % 15);
  }

  const note = noteForProcedure(procedure, name);
  const amber = pain >= 2;
  return {
    id: randomUUID(),
    date,
    completed_at: d.toISOString(),
    symptoms: {
      pain,
      fever: 0,
      wound,
      breathlessness: 0,
      dizziness,
    },
    medication_taken: true,
    activity_index: activity,
    resting_hr: 70 + (seed % 14),
    risk: amber ? "amber" : "green",
    risk_score: amber ? 0.42 : 0.18,
    recommendation: amber
      ? "A little sore versus expected. Continue close monitoring."
      : "Recovery on track for this stage. Continue monitoring.",
    action: amber ? "recommend_doctor_review" : "continue_monitoring",
    reasoning: [note],
    notes: note,
    transcript: [],
    simulated: true,
  };
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

try {
  let i = 0;
  for (const username of USERNAMES) {
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
      console.warn(`SKIP ${username}`);
      continue;
    }

    const history = Array.isArray(row.history) ? row.history : [];
    const live = history.filter((c) => c && c.simulated === false);
    const prior = priorCheckIn({
      procedure: row.procedure,
      name: row.name,
      seed: i,
    });
    const next = [...live, prior].sort((a, b) =>
      String(a.completed_at).localeCompare(String(b.completed_at))
    );

    await pool.query(
      `UPDATE patient_profiles SET history = $2::jsonb, updated_at = NOW() WHERE user_id = $1`,
      [row.id, JSON.stringify(next)]
    );
    console.log(`OK ${username} · ${row.procedure.slice(0, 40)} · ${prior.risk}`);
    i += 1;
  }
  console.log(`Done · ${i} prior check-ins`);
} catch (err) {
  console.error("FAIL", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
