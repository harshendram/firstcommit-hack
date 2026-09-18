import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const direct = process.env.DATABASE_URL?.trim();
if (!direct) {
  console.error("NO_DATABASE_URL");
  process.exit(1);
}

const u = new URL(direct.replace(/^postgresql:/i, "http:"));
const password = decodeURIComponent(u.password);
const ref = "sojaliysmtlluuvimtkt";
const regions = [
  "aws-0-ap-south-1",
  "aws-1-ap-south-1",
  "aws-0-ap-southeast-1",
  "aws-0-us-east-1",
];

const candidates = [
  direct,
  ...regions.flatMap((region) => [
    `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${region}.pooler.supabase.com:6543/postgres`,
    `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${region}.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres:${encodeURIComponent(password)}@${region}.pooler.supabase.com:5432/postgres`,
  ]),
];

for (const url of candidates) {
  const label = url.replace(/:[^:@]+@/, ":***@");
  const pool = new pg.Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12_000,
  });
  try {
    await pool.query("SELECT 1 AS ok");
    console.log("WIN", label);
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.log("FAIL", label, "-", err instanceof Error ? err.message : err);
    await pool.end();
  }
}

process.exit(1);
