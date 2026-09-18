/**
 * Seed friend accounts + recovery profiles for shared logins.
 * Run: cd backend && npx tsx scripts/seed-friends.mjs
 * Prints username/password table; also writes backend/data/friends-logins.txt (gitignored).
 */
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL missing in .env");
  process.exit(1);
}

/** @type {{ name: string, username: string, email: string, password: string, age: number, location: string, procedure: string, conditions: string[], medications: string[], preferred_language: string, discharged_days_ago: number }[]} */
const FRIENDS = [
  {
    name: "Prapti",
    username: "prapti",
    email: "prapti.nayak@gmail.com",
    password: "sunrisechai",
    age: 21,
    location: "Koramangala, Bengaluru",
    procedure: "Right ankle sprain recovery (ORIF follow-up)",
    conditions: ["None"],
    medications: ["pain medicine if needed", "keep the ankle elevated", "walk short distances twice a day"],
    preferred_language: "en-IN",
    discharged_days_ago: 5,
  },
  {
    name: "Harshendra M",
    username: "harshendra",
    email: "harshendra.m@outlook.com",
    password: "nightowltea",
    age: 22,
    location: "Whitefield, Bengaluru",
    procedure: "Appendectomy",
    conditions: ["None"],
    medications: ["antibiotic twice daily for 5 days", "soft diet", "no heavy lifting for 2 weeks"],
    preferred_language: "en-IN",
    discharged_days_ago: 4,
  },
  {
    name: "Mayur",
    username: "mayur",
    email: "mayur.rao88@gmail.com",
    password: "mangosmoothie",
    age: 22,
    location: "Jayanagar, Bengaluru",
    procedure: "Left wrist fracture casting",
    conditions: ["None"],
    medications: ["pain medicine only if needed", "keep cast dry", "finger exercises as shown"],
    preferred_language: "hi-IN",
    discharged_days_ago: 6,
  },
  {
    name: "Manjunath",
    username: "manjunath",
    email: "manjunath.k@yahoo.com",
    password: "quietlibrary",
    age: 21,
    location: "Yelahanka, Bengaluru",
    procedure: "Tonsillectomy",
    conditions: ["Mild allergies"],
    medications: ["soft cold foods", "pain medicine as needed", "drink plenty of fluids"],
    preferred_language: "en-IN",
    discharged_days_ago: 3,
  },
  {
    name: "Ujwala KV",
    username: "ujwala",
    email: "ujwala.kv@gmail.com",
    password: "softbreeze",
    age: 21,
    location: "Mysuru",
    procedure: "Laparoscopic gallbladder surgery",
    conditions: ["None"],
    medications: ["antibiotic for 5 days", "walk slowly indoors", "avoid oily food for a week"],
    preferred_language: "en-IN",
    discharged_days_ago: 7,
  },
  {
    name: "Samata HS",
    username: "samata",
    email: "samata.hs@gmail.com",
    password: "rainydaywalk",
    age: 22,
    location: "Hubli",
    procedure: "Knee arthroscopy (right)",
    conditions: ["None"],
    medications: ["ice pack twice a day", "pain medicine if needed", "physio as scheduled"],
    preferred_language: "en-IN",
    discharged_days_ago: 5,
  },
  {
    name: "Nikita",
    username: "nikita",
    email: "nikita.shetty@gmail.com",
    password: "lavenderhoney",
    age: 21,
    location: "Mangaluru",
    procedure: "Wisdom tooth extraction",
    conditions: ["None"],
    medications: ["salt water rinse after day 1", "soft foods", "pain medicine if needed"],
    preferred_language: "en-IN",
    discharged_days_ago: 2,
  },
  {
    name: "Parnika",
    username: "parnika",
    email: "parnika.desai@gmail.com",
    password: "peachcobbler",
    age: 22,
    location: "Indiranagar, Bengaluru",
    procedure: "Shoulder dislocation reduction follow-up",
    conditions: ["None"],
    medications: ["arm sling as advised", "gentle pendulum exercises", "pain medicine if needed"],
    preferred_language: "en-IN",
    discharged_days_ago: 4,
  },
  {
    name: "Poorvika",
    username: "poorvika",
    email: "poorvika.r@gmail.com",
    password: "coconutwater",
    age: 21,
    location: "Electronic City, Bengaluru",
    procedure: "Laser eye surgery (LASIK) recovery",
    conditions: ["None"],
    medications: ["antibiotic eye drops", "avoid rubbing eyes", "wear sunglasses outdoors"],
    preferred_language: "hi-IN",
    discharged_days_ago: 6,
  },
  {
    name: "Prasoon",
    username: "prasoon",
    email: "prasoon.verma@gmail.com",
    password: "starmapnote",
    age: 22,
    location: "HSR Layout, Bengaluru",
    procedure: "Nasal septum surgery",
    conditions: ["Seasonal rhinitis"],
    medications: ["saline spray", "sleep with head elevated", "avoid blowing nose hard"],
    preferred_language: "en-IN",
    discharged_days_ago: 5,
  },
  {
    name: "Prakhar",
    username: "prakhar",
    email: "prakhar.singh@outlook.com",
    password: "greenteapot",
    age: 22,
    location: "Banashankari, Bengaluru",
    procedure: "Left ACL reconstruction (early recovery)",
    conditions: ["None"],
    medications: ["ice after physio", "pain medicine if needed", "crutches as advised"],
    preferred_language: "en-IN",
    discharged_days_ago: 8,
  },
  {
    name: "Manya",
    username: "manya",
    email: "manya.iyer@gmail.com",
    password: "moonlightjar",
    age: 21,
    location: "Malleshwaram, Bengaluru",
    procedure: "Thyroid nodule biopsy recovery",
    conditions: ["None"],
    medications: ["keep wound clean", "pain medicine if needed", "follow up with report"],
    preferred_language: "en-IN",
    discharged_days_ago: 3,
  },
  {
    name: "Prarthana",
    username: "prarthana",
    email: "prarthana.b@gmail.com",
    password: "quietgarden",
    age: 21,
    location: "Rajajinagar, Bengaluru",
    procedure: "Laparoscopic ovarian cyst removal",
    conditions: ["None"],
    medications: ["antibiotic course", "walk short distances", "avoid heavy bags"],
    preferred_language: "en-IN",
    discharged_days_ago: 5,
  },
  {
    name: "Supreetha",
    username: "supreetha",
    email: "supreetha.n@gmail.com",
    password: "butterscotch",
    age: 22,
    location: "Shimoga",
    procedure: "Fracture radius — cast care",
    conditions: ["None"],
    medications: ["keep cast dry", "finger movement exercises", "pain medicine if needed"],
    preferred_language: "en-IN",
    discharged_days_ago: 7,
  },
  {
    name: "Anushka",
    username: "anushka",
    email: "anushka.patil@gmail.com",
    password: "pinklemonade",
    age: 21,
    location: "Belagavi",
    procedure: "Ear drum repair follow-up",
    conditions: ["None"],
    medications: ["keep ear dry", "no swimming for 3 weeks", "finish antibiotic drops"],
    preferred_language: "en-IN",
    discharged_days_ago: 4,
  },
  {
    name: "Devesh Jha",
    username: "devesh",
    email: "devesh.jha@gmail.com",
    password: "blackboardchalk",
    age: 22,
    location: "Hebbal, Bengaluru",
    procedure: "Hernia repair (inguinal)",
    conditions: ["None"],
    medications: ["no heavy lifting for 4 weeks", "walk daily", "pain medicine if needed"],
    preferred_language: "hi-IN",
    discharged_days_ago: 6,
  },
  {
    name: "Aryan",
    username: "aryan",
    email: "aryan.mehta@gmail.com",
    password: "oceanbreeze",
    age: 21,
    location: "Marathahalli, Bengaluru",
    procedure: "ACL sprain conservative care",
    conditions: ["None"],
    medications: ["compression bandage", "ice pack", "physio thrice a week"],
    preferred_language: "en-IN",
    discharged_days_ago: 5,
  },
  {
    name: "Anirudh",
    username: "anirudh",
    email: "anirudh.kumar@yahoo.com",
    password: "coffeewithmilk",
    age: 22,
    location: "Basavanagudi, Bengaluru",
    procedure: "Pilonidal sinus excision",
    conditions: ["None"],
    medications: ["dressing change daily", "sit on cushion", "antibiotic course"],
    preferred_language: "en-IN",
    discharged_days_ago: 4,
  },
  {
    name: "Kamal",
    username: "kamal",
    email: "kamal.nair@gmail.com",
    password: "riverstone",
    age: 22,
    location: "Kochi (visiting Bengaluru)",
    procedure: "Knee meniscus debridement",
    conditions: ["None"],
    medications: ["elevate leg", "ice after walks", "physio as planned"],
    preferred_language: "en-IN",
    discharged_days_ago: 6,
  },
  {
    name: "Risshab",
    username: "risshab",
    email: "risshab.jain@gmail.com",
    password: "sunsetdrive",
    age: 21,
    location: "JP Nagar, Bengaluru",
    procedure: "Clavicle fracture sling care",
    conditions: ["None"],
    medications: ["wear sling as advised", "sleep propped up", "pain medicine if needed"],
    preferred_language: "en-IN",
    discharged_days_ago: 8,
  },
  {
    name: "Ribhav",
    username: "ribhav",
    email: "ribhav.gupta@outlook.com",
    password: "notebookpen",
    age: 21,
    location: "RT Nagar, Bengaluru",
    procedure: "Nasal fracture reduction follow-up",
    conditions: ["None"],
    medications: ["cold compress", "sleep with head elevated", "avoid contact sports"],
    preferred_language: "en-IN",
    discharged_days_ago: 3,
  },
  {
    name: "Rohan",
    username: "rohan",
    email: "rohan.das@gmail.com",
    password: "weekendplaylist",
    age: 22,
    location: "Sarjapur Road, Bengaluru",
    procedure: "Ankle ligament sprain",
    conditions: ["None"],
    medications: ["RICE protocol", "ankle brace while walking", "pain medicine if needed"],
    preferred_language: "en-IN",
    discharged_days_ago: 5,
  },
  {
    name: "Apoorva",
    username: "apoorva",
    email: "apoorva.s@gmail.com",
    password: "honeytoast",
    age: 21,
    location: "Udupi",
    procedure: "Impacted wisdom tooth removal (both sides)",
    conditions: ["None"],
    medications: ["soft cold foods", "salt rinse after day 1", "pain medicine if needed"],
    preferred_language: "en-IN",
    discharged_days_ago: 4,
  },
  {
    name: "Kiran",
    username: "kiran",
    email: "kiran.rao.live@gmail.com",
    password: "morningjog",
    age: 22,
    location: "Tumkur",
    procedure: "Hand tendon repair follow-up",
    conditions: ["None"],
    medications: ["hand therapy exercises", "keep dressing clean", "pain medicine if needed"],
    preferred_language: "en-IN",
    discharged_days_ago: 7,
  },
  {
    name: "Josephine",
    username: "josephine",
    email: "josephine.m@gmail.com",
    password: "sundaybaking",
    age: 21,
    location: "Frazer Town, Bengaluru",
    procedure: "Thyroidectomy (partial)",
    conditions: ["None"],
    medications: ["voice rest as advised", "calcium if prescribed", "keep wound dry"],
    preferred_language: "en-IN",
    discharged_days_ago: 6,
  },
  {
    name: "Vineeth",
    username: "vineeth",
    email: "vineeth.p@gmail.com",
    password: "campuscanteen",
    age: 22,
    location: "Kengeri, Bengaluru",
    procedure: "Sports hernia repair",
    conditions: ["None"],
    medications: ["no sprinting for 4 weeks", "walk daily", "pain medicine if needed"],
    preferred_language: "en-IN",
    discharged_days_ago: 5,
  },
  {
    name: "Aniket",
    username: "aniket",
    email: "aniket.sharma@gmail.com",
    password: "latebreakfast",
    age: 22,
    location: "Bellandur, Bengaluru",
    procedure: "Left knee arthroscopy",
    conditions: ["None"],
    medications: ["ice twice a day", "physio", "pain medicine if needed"],
    preferred_language: "hi-IN",
    discharged_days_ago: 4,
  },
];

function dischargedOn(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

const lines = [
  "Rakshak friend logins",
  "URL: https://rakshak-alpha-lake.vercel.app/checkin",
  "",
  "username | password | name | email",
  "---------|----------|------|------",
];

try {
  // Ensure schema bits exist (idempotent)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await pool.query(`
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

  for (const f of FRIENDS) {
    const hash = await bcrypt.hash(f.password, 10);
    const existing = await pool.query(
      `SELECT id FROM users WHERE username = $1 LIMIT 1`,
      [f.username]
    );

    let userId = existing.rows[0]?.id;
    if (userId) {
      await pool.query(
        `UPDATE users SET password_hash = $2, name = $3, email = $4, last_seen_at = NOW() WHERE id = $1`,
        [userId, hash, f.name, f.email]
      );
    } else {
      const userRes = await pool.query(
        `
        INSERT INTO users (username, password_hash, name, email)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        `,
        [f.username, hash, f.name, f.email]
      );
      userId = userRes.rows[0].id;
    }

    await pool.query(
      `
      INSERT INTO patient_profiles (
        user_id, name, age, location, procedure, discharged_on,
        conditions, medications, preferred_language
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (user_id) DO UPDATE SET
        name = EXCLUDED.name,
        age = EXCLUDED.age,
        location = EXCLUDED.location,
        procedure = EXCLUDED.procedure,
        discharged_on = EXCLUDED.discharged_on,
        conditions = EXCLUDED.conditions,
        medications = EXCLUDED.medications,
        preferred_language = EXCLUDED.preferred_language,
        updated_at = NOW()
      `,
      [
        userId,
        f.name,
        f.age,
        f.location,
        f.procedure,
        dischargedOn(f.discharged_days_ago),
        f.conditions,
        f.medications,
        f.preferred_language,
      ]
    );

    lines.push(`${f.username} | ${f.password} | ${f.name} | ${f.email}`);
    console.log(`OK ${f.username}`);
  }

  const outDir = path.resolve(__dirname, "../data");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "friends-logins.txt");
  fs.writeFileSync(outFile, lines.join("\n") + "\n", "utf8");
  console.log("\n" + lines.join("\n"));
  console.log(`\nWrote ${outFile}`);
} catch (err) {
  console.error("SEED_FAIL", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
