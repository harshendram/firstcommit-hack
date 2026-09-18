import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("NO_DATABASE_URL");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  const r = await pool.query("SELECT 1 AS ok");
  console.log("DB_OK", r.rows[0]);
  await pool.end();
} catch (err) {
  console.error("DB_FAIL", err instanceof Error ? err.message : err);
  await pool.end();
  process.exit(1);
}
