import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const before = await pool.query(
  `SELECT username, email, name FROM users ORDER BY created_at`
);
console.log("before", before.rows);

const del = await pool.query(
  `DELETE FROM users WHERE username IS DISTINCT FROM 'naomi' RETURNING username, email, name`
);
console.log("deleted", del.rowCount, del.rows);

const after = await pool.query(`SELECT COUNT(*)::int AS n FROM users`);
console.log("remaining", after.rows[0].n);

await pool.end();
